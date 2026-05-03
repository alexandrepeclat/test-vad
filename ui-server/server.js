import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CLIENT_DIR = path.join(ROOT, 'ui-client');
const scriptLogClients = new Map();
const scriptStateClients = new Set();
const scriptRunStates = new Map();
const SCRIPT_LOG_BACKLOG_LIMIT = 1500;
const SCRIPT_RUN_STATE_LIMIT = 12;
let activeScriptRunId = null;
let activeScriptChild = null;
let activeScriptChildAbortReason = null;
const activeRunControl = {
    stopRequested: false,
    skipRequested: false
};

// TASK_FACTORY is the sole authority mapping taskKey → script + whether it needs a file target.
const TASK_FACTORY = {
    mp3:         { script: 'run-wavtomp3.ps1',           needsFile: true  },
    metadata:    { script: 'run-meta-json.ps1',          needsFile: true  },
    pyannote:    { script: 'run-vad-pyannote.ps1',       needsFile: true  },
    silero:      { script: 'run-vad-silero.ps1',         needsFile: true  },
    spectrogram: { script: 'run-build-spectrogram.ps1',  needsFile: true  },
    peaks:       { script: 'run-build-peaks.ps1',        needsFile: true  },
    copyfromsd:  { script: 'run-sd-copy.ps1',            needsFile: false }
};

// Server-owned task queue. Each entry: { taskKey, fileKey (or null), taskId }
let taskQueue = [];

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.png': 'image/png'
};

function toPosix(p) {
    return p.replace(/\\/g, '/');
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function terminateChildProcessTree(child, abortReason) {
    if (!child || typeof child.pid !== 'number') return;
    activeScriptChildAbortReason = abortReason;
    const pid = child.pid;

    try {
        // On Windows, kill the whole process tree and wait for completion.
        const killResult = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
            windowsHide: true,
            encoding: 'utf-8'
        });
        if (killResult.status !== 0) {
            console.warn(`[script:control] taskkill failed for pid=${pid}:`, killResult.stderr || killResult.stdout || killResult.error || 'unknown');
        }
    } catch {
        // Ignore taskkill launch failure and fallback below.
    }

    try {
        const stopResult = spawnSync('powershell.exe', [
            '-NoProfile',
            '-Command',
            `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`
        ], {
            windowsHide: true,
            encoding: 'utf-8'
        });
        if (stopResult.status !== 0) {
            console.warn(`[script:control] Stop-Process failed for pid=${pid}:`, stopResult.stderr || stopResult.stdout || stopResult.error || 'unknown');
        }
    } catch {
        // Ignore fallback failures.
    }

    try {
        child.kill('SIGKILL');
    } catch {
        // Ignore if already terminated.
    }

    setTimeout(() => {
        if (!child.killed) {
            try {
                spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
                    windowsHide: true,
                    encoding: 'utf-8'
                });
            } catch {
                // Ignore retry failures.
            }
        }
    }, 300);
}

function sanitizeRunId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(trimmed)) return null;
    return trimmed;
}

function sseWrite(res, eventName, payload) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createRunId() {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureScriptRunState(runId) {
    if (!scriptRunStates.has(runId)) {
        scriptRunStates.set(runId, {
            runId,
            status: 'idle',
            startedAt: null,
            endedAt: null,
            scripts: [],
            targets: [],
            force: false,
            continueOnError: true,
            currentTask: null,
            pendingTasks: [],
            currentEntry: null,
            pendingEntries: [],
            summary: null,
            events: []
        });
    }
    return scriptRunStates.get(runId);
}

function pruneScriptRunStates() {
    if (scriptRunStates.size <= SCRIPT_RUN_STATE_LIMIT) return;
    const removable = Array.from(scriptRunStates.values())
        .filter((state) => state.status !== 'running' && state.runId !== activeScriptRunId)
        .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));

    while (scriptRunStates.size > SCRIPT_RUN_STATE_LIMIT && removable.length > 0) {
        const oldest = removable.shift();
        scriptRunStates.delete(oldest.runId);
    }
}

function appendScriptRunEvent(runId, payload) {
    if (!runId) return;
    const state = ensureScriptRunState(runId);
    state.events.push({
        at: Date.now(),
        payload
    });
    if (state.events.length > SCRIPT_LOG_BACKLOG_LIMIT) {
        state.events.splice(0, state.events.length - SCRIPT_LOG_BACKLOG_LIMIT);
    }
}

function getRunSnapshot(runId) {
    const state = scriptRunStates.get(runId);
    if (!state) return null;
    return {
        runId: state.runId,
        status: state.status,
        startedAt: state.startedAt,
        endedAt: state.endedAt,
        scripts: state.scripts,
        targets: state.targets,
        force: state.force,
        continueOnError: state.continueOnError,
        currentTask: state.currentTask,
        currentEntry: state.currentEntry,
        pendingEntries: state.pendingEntries,
        summary: state.summary,
        events: state.events
    };
}

function addScriptLogClient(runId, res) {
    if (!scriptLogClients.has(runId)) {
        scriptLogClients.set(runId, new Set());
    }
    scriptLogClients.get(runId).add(res);
}

function removeScriptLogClient(runId, res) {
    const set = scriptLogClients.get(runId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
        scriptLogClients.delete(runId);
    }
}

function addScriptStateClient(res) {
    scriptStateClients.add(res);
}

function removeScriptStateClient(res) {
    scriptStateClients.delete(res);
}

function broadcastScriptState(payload) {
    if (!payload || scriptStateClients.size === 0) return;
    scriptStateClients.forEach((res) => sseWrite(res, 'state', payload));
}

function broadcastScriptStateSnapshot(reason = 'update') {
    const payload = {
        reason,
        ...buildScriptStateSnapshotPayload()
    };
    scriptStateClients.forEach((res) => sseWrite(res, 'snapshot', payload));
}

function buildScriptStateSnapshotPayload() {
    if (!activeScriptRunId) {
        return {
            hasActiveRun: false,
            activeRunId: null,
            run: null,
            queue: taskQueue.slice()
        };
    }

    const snapshot = getRunSnapshot(activeScriptRunId);
    return {
        hasActiveRun: true,
        activeRunId: activeScriptRunId,
        run: snapshot
            ? {
                runId: snapshot.runId,
                status: snapshot.status,
                startedAt: snapshot.startedAt,
                endedAt: snapshot.endedAt,
                scripts: snapshot.scripts,
                targets: snapshot.targets,
                force: snapshot.force,
                continueOnError: snapshot.continueOnError,
                currentTask: snapshot.currentTask,
                currentEntry: snapshot.currentEntry,
                pendingEntries: snapshot.pendingEntries,
                summary: snapshot.summary
            }
            : null,
        queue: taskQueue.slice()
    };
}

function broadcastScriptLog(runId, payload) {
    if (!runId) return;
    const enrichedPayload = payload && typeof payload === 'object' && payload.runId == null
        ? { ...payload, runId }
        : payload;

    appendScriptRunEvent(runId, enrichedPayload);

    if (enrichedPayload?.type && enrichedPayload.type !== 'chunk') {
        broadcastScriptState(enrichedPayload);
        if (
            enrichedPayload.type === 'run-start'
            || enrichedPayload.type === 'task-start'
            || enrichedPayload.type === 'task-end'
            || enrichedPayload.type === 'run-end'
            || enrichedPayload.type === 'control'
        ) {
            broadcastScriptStateSnapshot(enrichedPayload.type);
        }
    }

    const set = scriptLogClients.get(runId);
    if (!set || set.size === 0) return;
    set.forEach((res) => sseWrite(res, 'log', enrichedPayload));
}

function closeScriptLogStream(runId, payload = {}) {
    if (!runId) return;
    const set = scriptLogClients.get(runId);
    if (!set || set.size === 0) return;
    set.forEach((res) => {
        sseWrite(res, 'end', payload);
        res.end();
    });
    scriptLogClients.delete(runId);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function isInside(parentDir, targetPath) {
    const rel = path.relative(parentDir, targetPath);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function safeResolve(baseDir, relPath) {
    const resolved = path.resolve(baseDir, relPath);
    if (resolved === baseDir || isInside(baseDir, resolved)) {
        return resolved;
    }
    return null;
}

function readJsonFile(absPath) {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const sanitized = raw.replace(/^\uFEFF/, '');
    return JSON.parse(sanitized);
}

function walk(dir, base = '', extensions = null) {
    let results = [];

    const list = fs.readdirSync(dir);

    for (const file of list) {
        const filePath = path.join(dir, file);
        const relPath = path.join(base, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            results = results.concat(walk(filePath, relPath, extensions));
            continue;
        }

        if (!extensions || extensions.length === 0) {
            results.push(relPath.replace(/\\/g, '/'));
            continue;
        }

        const ext = path.extname(file).toLowerCase();
        if (extensions.includes(ext)) {
            results.push(relPath.replace(/\\/g, '/'));
        }
    }

    return results;
}

function getSelectableAudioFiles() {
    const audioFiles = walk(DATA_DIR, '', ['.mp3', '.wav']);
    const byStem = new Map();

    for (const rel of audioFiles) {
        const ext = path.extname(rel).toLowerCase();
        const stem = rel.slice(0, -ext.length);
        const current = byStem.get(stem);

        if (!current || (ext === '.wav' && current.ext !== '.wav')) {
            byStem.set(stem, { rel, ext });
        }
    }

    return Array.from(byStem.values())
        .map((entry) => entry.rel)
        .sort((a, b) => a.localeCompare(b, 'en'));
}

function findPreferredAudioCandidate(audioRelPath, prefer = 'mp3') {
    const normalized = toPosix(audioRelPath || '').replace(/^\/+/, '');
    const ext = path.extname(normalized).toLowerCase();
    const stem = ext ? normalized.slice(0, -ext.length) : normalized;

    const mp3 = `${stem}.mp3`;
    const wav = `${stem}.wav`;

    const mp3Abs = safeResolve(DATA_DIR, mp3);
    const wavAbs = safeResolve(DATA_DIR, wav);

    if (prefer === 'wav') {
        if (wavAbs && fs.existsSync(wavAbs)) return wav;
        if (mp3Abs && fs.existsSync(mp3Abs)) return mp3;
    } else {
        if (mp3Abs && fs.existsSync(mp3Abs)) return mp3;
        if (wavAbs && fs.existsSync(wavAbs)) return wav;
    }

    const originalAbs = safeResolve(DATA_DIR, normalized);
    if (originalAbs && fs.existsSync(originalAbs)) return normalized;

    return normalized;
}

function extractMetadataFields(meta) {
    const duration = typeof meta?.duration === 'number'
        ? meta.duration
        : Number(meta?.duration ?? NaN);

    const startDate = typeof meta?.startDate === 'string' ? meta.startDate : null;
    const startMs = startDate ? Date.parse(startDate) : NaN;
    const endMs = Number.isFinite(startMs) && Number.isFinite(duration)
        ? startMs + (duration * 1000)
        : NaN;

    let day = null;
    if (startDate) {
        const m = startDate.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) day = m[1];
    }

    return {
        startDate,
        duration: Number.isFinite(duration) ? duration : null,
        startMs: Number.isFinite(startMs) ? startMs : null,
        endMs: Number.isFinite(endMs) ? endMs : null,
        day
    };
}

function buildFileDetails(audioRelPath) {
    const normalized = toPosix(audioRelPath || '').replace(/^\/+/, '');
    const ext = path.extname(normalized).toLowerCase();
    const stem = ext ? normalized.slice(0, -ext.length) : normalized;
    const wavRel = `${stem}.wav`;
    const mp3Rel = `${stem}.mp3`;
    const wavAbs = safeResolve(DATA_DIR, wavRel);
    const mp3Abs = safeResolve(DATA_DIR, mp3Rel);
    const hasWav = !!(wavAbs && fs.existsSync(wavAbs));
    const hasMp3 = !!(mp3Abs && fs.existsSync(mp3Abs));
    const processingRel = hasWav ? wavRel : (hasMp3 ? mp3Rel : findPreferredAudioCandidate(audioRelPath, 'wav'));
    const clientRel = hasMp3 ? mp3Rel : (hasWav ? wavRel : findPreferredAudioCandidate(audioRelPath, 'mp3'));
    const processingAbs = safeResolve(DATA_DIR, processingRel);
    const clientAbs = safeResolve(DATA_DIR, clientRel);
    const baseRel = (hasWav ? wavRel : processingRel).replace(/\.(mp3|wav)$/i, '');

    const candidates = {
        metadata: `${baseRel}_metadata.json`,
        pyannote: `${baseRel}_pyannote.json`,
        silero: `${baseRel}_silero.json`,
        peaks: `${baseRel}_peaks.json`,
        spectrogram: `${baseRel}_spectrogram.png`
    };

    const exists = {
        audio: !!(clientAbs && fs.existsSync(clientAbs)),
        processingAudio: !!(processingAbs && fs.existsSync(processingAbs)),
        wav: hasWav,
        mp3: hasMp3,
        metadata: false,
        pyannote: false,
        silero: false,
        peaks: false,
        spectrogram: false
    };

    let startDate = null;
    let duration = null;
    let startMs = null;
    let endMs = null;
    let day = null;

    for (const [key, relPath] of Object.entries(candidates)) {
        const abs = safeResolve(DATA_DIR, relPath);
        const present = !!(abs && fs.existsSync(abs));
        exists[key] = present;

        if (key === 'metadata' && present) {
            try {
                const parsed = readJsonFile(abs);
                const meta = extractMetadataFields(parsed);
                startDate = meta.startDate;
                duration = meta.duration;
                startMs = meta.startMs;
                endMs = meta.endMs;
                day = meta.day;
            } catch {
                startDate = null;
                duration = null;
                startMs = null;
                endMs = null;
                day = null;
            }
        }
    }

    return {
        requestedFile: audioRelPath,
        audioFile: clientRel,
        processingFile: processingRel,
        wavFile: wavRel,
        mp3File: mp3Rel,
        displayFile: processingRel || clientRel,
        baseName: path.basename(baseRel),
        audioPath: `/data/${toPosix(clientRel)}`,
        processingAudioPath: `/data/${toPosix(processingRel)}`,
        wavPath: `/data/${toPosix(wavRel)}`,
        mp3Path: `/data/${toPosix(mp3Rel)}`,
        metadataPath: `/data/${toPosix(candidates.metadata)}`,
        pyannotePath: `/data/${toPosix(candidates.pyannote)}`,
        sileroPath: `/data/${toPosix(candidates.silero)}`,
        peaksPath: `/data/${toPosix(candidates.peaks)}`,
        spectrogramPath: `/data/${toPosix(candidates.spectrogram)}`,
        exists,
        startDate,
        duration,
        startMs,
        endMs,
        day
    };
}

function getScriptFileInventory() {
    return getSelectableAudioFiles()
        .map((relPath) => buildFileDetails(relPath))
        .sort((a, b) => (a.displayFile || a.processingFile || a.audioFile || '').localeCompare(
            b.displayFile || b.processingFile || b.audioFile || '',
            'en'
        ));
}

function getMetadataRecords() {
    const metadataFiles = walk(DATA_DIR, '', ['.json'])
        .filter((rel) => rel.endsWith('_metadata.json'));

    const records = [];

    for (const relPath of metadataFiles) {
        const abs = safeResolve(DATA_DIR, relPath);
        if (!abs || !fs.existsSync(abs)) continue;

        try {
            const parsed = readJsonFile(abs);
            const meta = extractMetadataFields(parsed);
            if (!meta.day) continue;

            const baseRel = relPath.replace(/_metadata\.json$/i, '');
            const candidateAudio = findPreferredAudioCandidate(baseRel, 'mp3');

            records.push({
                day: meta.day,
                baseRel,
                candidateAudio,
                startMs: meta.startMs,
                endMs: meta.endMs,
                startDate: meta.startDate,
                duration: meta.duration
            });
        } catch {
            // Ignore malformed metadata files so list endpoint remains resilient.
        }
    }

    return records;
}

function getDayInventory() {
    const byDay = new Map();
    const records = getMetadataRecords();

    for (const record of records) {
        if (!byDay.has(record.day)) {
            byDay.set(record.day, []);
        }
        byDay.get(record.day).push(record);
    }

    const days = Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b, 'en'));
    return { days, byDay, records };
}

function parseDays(searchParams) {
    return searchParams
        .getAll('days')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function buildDayDetails(days) {
    const inventory = getDayInventory();
    const uniqueDays = Array.from(new Set(days));

    const groups = uniqueDays.map((day) => {
        const files = (inventory.byDay.get(day) || [])
            .map((record) => buildFileDetails(record.candidateAudio || record.baseRel))
            .slice()
            .sort((a, b) => (a.startMs ?? Number.MAX_SAFE_INTEGER) - (b.startMs ?? Number.MAX_SAFE_INTEGER));
        return { day, files };
    });

    const allFiles = groups.flatMap((g) => g.files);
    const starts = allFiles.map((f) => f.startMs).filter((v) => Number.isFinite(v));
    const ends = allFiles.map((f) => f.endMs).filter((v) => Number.isFinite(v));

    const minStartMs = starts.length ? Math.min(...starts) : null;
    const maxEndMs = ends.length ? Math.max(...ends) : null;

    return {
        days: groups,
        global: {
            minStartMs,
            maxEndMs
        }
    };
}

function buildOutputForScript(scriptName, targetRelPath) {
    const stem = targetRelPath.replace(/\.(mp3|wav)$/i, '');
    if (scriptName === 'run-wavtomp3.ps1') return `${stem}.mp3`;
    if (scriptName === 'run-meta-json.ps1') return `${stem}_metadata.json`;
    if (scriptName === 'run-vad-pyannote.ps1') return `${stem}_pyannote.json`;
    if (scriptName === 'run-vad-silero.ps1') return `${stem}_silero.json`;
    if (scriptName === 'run-build-spectrogram.ps1') return `${stem}_spectrogram.png`;
    if (scriptName === 'run-build-peaks.ps1') return `${stem}_peaks.json`;
    return null;
}

function makeTaskId(taskKey, fileKey) {
    if (!taskKey) return null;
    return fileKey ? `${taskKey}::${fileKey}` : taskKey;
}

function runScript(scriptName, inputPath, outputPath, displayInputPath = inputPath, displayOutputPath = outputPath, onChunk = null) {
    return new Promise((resolve) => {
        const scriptPath = path.join(ROOT, scriptName);
        const args = [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath,
            '-InputPath',
            inputPath,
            '-OutputPath',
            outputPath
        ];

        const commandLine = ['powershell.exe', ...args.map((arg) => {
            if (/\s/.test(arg)) {
                return `"${arg.replace(/"/g, '\\"')}"`;
            }
            return arg;
        })].join(' ');

        console.log(`[script:start] ${scriptName} | ${displayInputPath} -> ${displayOutputPath}`);
        console.log(`[script:cmd] ${commandLine}`);

        const startedAt = Date.now();
        const child = spawn('powershell.exe', args, { cwd: ROOT });
        activeScriptChild = child;
        activeScriptChildAbortReason = null;

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(`[script:stdout:${scriptName}] ${text}`);
            if (onChunk) {
                onChunk({
                    stream: 'stdout',
                    text,
                    script: scriptName,
                    inputPath: displayInputPath,
                    outputPath: displayOutputPath
                });
            }
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(`[script:stderr:${scriptName}] ${text}`);
            if (onChunk) {
                onChunk({
                    stream: 'stderr',
                    text,
                    script: scriptName,
                    inputPath: displayInputPath,
                    outputPath: displayOutputPath
                });
            }
        });

        child.on('close', (code) => {
            if (activeScriptChild === child) {
                activeScriptChild = null;
            }
            const abortedBy = activeScriptChildAbortReason;
            activeScriptChildAbortReason = null;
            console.log(`[script:end] ${scriptName} | code=${code} | durationMs=${Date.now() - startedAt}`);
            resolve({
                script: scriptName,
                inputPath: displayInputPath,
                outputPath: displayOutputPath,
                ok: code === 0,
                code,
                durationMs: Date.now() - startedAt,
                stdout,
                stderr,
                abortedBy
            });
        });
    });
}

function sanitizeTarget(value) {
    if (typeof value !== 'string') return null;
    const normalized = toPosix(value).replace(/^\/+/, '').trim();
    if (!normalized) return null;

    // Safety check: path must be within DATA_DIR
    if (!safeResolve(DATA_DIR, normalized)) return null;

    // Resolve to the best available audio candidate (handles extension-less stems)
    const candidate = findPreferredAudioCandidate(normalized, 'wav');
    const candidateAbs = safeResolve(DATA_DIR, candidate);
    if (!candidateAbs || !fs.existsSync(candidateAbs)) return null;

    return candidate;
}

// ── Run a script that needs no InputPath/OutputPath (e.g. run-sd-copy.ps1) ──
function runNoFileTask(scriptName, onChunk = null) {
    return new Promise((resolve) => {
        const scriptPath = path.join(ROOT, scriptName);
        const args = [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath
        ];
        console.log(`[script:start] ${scriptName} (no-file)`);
        const startedAt = Date.now();
        const child = spawn('powershell.exe', args, { cwd: ROOT });
        activeScriptChild = child;
        activeScriptChildAbortReason = null;

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(`[script:stdout:${scriptName}] ${text}`);
            if (onChunk) onChunk({ stream: 'stdout', text, script: scriptName });
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(`[script:stderr:${scriptName}] ${text}`);
            if (onChunk) onChunk({ stream: 'stderr', text, script: scriptName });
        });

        child.on('close', (code) => {
            if (activeScriptChild === child) activeScriptChild = null;
            const abortedBy = activeScriptChildAbortReason;
            activeScriptChildAbortReason = null;
            console.log(`[script:end] ${scriptName} | code=${code} | durationMs=${Date.now() - startedAt}`);
            resolve({ script: scriptName, ok: code === 0, code, durationMs: Date.now() - startedAt, stdout, stderr, abortedBy });
        });
    });
}

// ── Server-side task queue helpers ───────────────────────────────────────────

function broadcastQueueChanged() {
    const payload = { type: 'queue-changed', queue: taskQueue.slice() };
    scriptStateClients.forEach((res) => sseWrite(res, 'queue-changed', payload));
}

function enqueueTask(taskKey, fileKey) {
    const taskId = makeTaskId(taskKey, fileKey || null);
    if (!taskId) return null;
    // Deduplicate: skip if already in queue or currently running
    const alreadyQueued = taskQueue.some((e) => e.taskId === taskId);
    if (alreadyQueued) return null;
    const entry = { taskKey, fileKey: fileKey || null, taskId };
    taskQueue.push(entry);
    broadcastQueueChanged();
    return entry;
}

function dequeueTask(taskId) {
    const before = taskQueue.length;
    taskQueue = taskQueue.filter((e) => e.taskId !== taskId);
    if (taskQueue.length !== before) {
        broadcastQueueChanged();
    }
}

function maybeStartNextFromQueue() {
    if (activeScriptRunId || taskQueue.length === 0) return;
    const entries = taskQueue.splice(0);
    broadcastQueueChanged();
    executeQueueEntries(entries).catch((err) => {
        console.error('[queue] executeQueueEntries error:', err);
    });
}

async function executeQueueEntries(entries) {
    const runId = createRunId();
    activeScriptRunId = runId;
    activeRunControl.stopRequested = false;
    activeRunControl.skipRequested = false;
    activeScriptChild = null;
    activeScriptChildAbortReason = null;

    const runState = ensureScriptRunState(runId);
    runState.status = 'running';
    runState.startedAt = Date.now();
    runState.endedAt = null;
    runState.force = false;
    runState.continueOnError = true;
    runState.currentTask = null;
    runState.currentEntry = null;
    runState.pendingEntries = entries.map((e) => ({ taskKey: e.taskKey, fileKey: e.fileKey, taskId: e.taskId }));
    runState.pendingTasks = [];
    runState.summary = null;
    runState.events = [];

    broadcastScriptLog(runId, { type: 'run-start', runId, taskCount: entries.length });

    const results = [];
    let stopped = false;

    for (const entry of entries) {
        if (activeRunControl.stopRequested) {
            stopped = true;
            break;
        }

        const { taskKey, fileKey } = entry;
        const factory = TASK_FACTORY[taskKey];
        if (!factory) {
            results.push({ taskKey, ok: false, skipped: true, reason: 'Unknown taskKey' });
            continue;
        }

        runState.currentEntry = { taskKey, fileKey: fileKey || null, taskId: entry.taskId };
        runState.pendingEntries = runState.pendingEntries.filter((e) => e.taskId !== entry.taskId);
        broadcastScriptStateSnapshot('task-start');

        if (!factory.needsFile) {
            // Global task (e.g. copyfromsd)
            broadcastScriptLog(runId, { type: 'task-start', taskKey, inputPath: null, outputPath: null });
            const result = await runNoFileTask(factory.script, (chunkInfo) => {
                broadcastScriptLog(runId, { type: 'chunk', ...chunkInfo });
            });
            results.push({ taskKey, ...result });
            broadcastScriptLog(runId, { type: 'task-end', taskKey, ok: result.ok, code: result.code, durationMs: result.durationMs });
        } else {
            // File-based task
            const target = sanitizeTarget(fileKey);
            if (!target) {
                results.push({ taskKey, fileKey, ok: false, skipped: true, reason: 'Invalid or missing target file' });
                broadcastScriptLog(runId, { type: 'result', taskKey, inputPath: fileKey, ok: false, skipped: true, reason: 'Invalid target' });
                continue;
            }

            const outputRel = buildOutputForScript(factory.script, target);
            const outputAbs = outputRel ? safeResolve(DATA_DIR, outputRel) : null;
            const inputAbs = safeResolve(DATA_DIR, target);

            broadcastScriptLog(runId, { type: 'task-start', taskKey, script: factory.script, inputPath: target, outputPath: outputRel });

            const result = await runScript(
                factory.script,
                inputAbs,
                outputAbs,
                target,
                outputRel,
                (chunkInfo) => broadcastScriptLog(runId, { type: 'chunk', ...chunkInfo })
            );

            results.push({ taskKey, fileKey, ...result });

            if (result.abortedBy === 'stop') {
                broadcastScriptLog(runId, { type: 'task-end', taskKey, ok: false, code: result.code, durationMs: result.durationMs });
                stopped = true;
                break;
            }
            broadcastScriptLog(runId, { type: 'task-end', taskKey, ok: result.ok, code: result.code, durationMs: result.durationMs });
            activeRunControl.skipRequested = false;
        }
    }

    const total = results.length;
    const success = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok && !r.skipped).length;
    const summary = { total, success, failed, stopped };
    runState.status = 'done';
    runState.endedAt = Date.now();
    runState.summary = summary;
    runState.currentTask = null;
    runState.currentEntry = null;
    runState.pendingEntries = [];
    activeScriptRunId = null;

    broadcastScriptLog(runId, { type: 'run-end', runId, summary });
    broadcastScriptStateSnapshot('run-end');
    pruneScriptRunStates();
    maybeStartNextFromQueue();
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = parsedUrl.pathname;

    if (pathname === '/api/files') {
        try {
            const files = getSelectableAudioFiles();
            return sendJson(res, 200, files);
        } catch {
            return sendJson(res, 500, { error: 'Error reading files' });
        }
    }

    if (pathname === '/api/file-details') {
        try {
            const rawFiles = parsedUrl.searchParams.getAll('files');
            const requested = rawFiles
                .flatMap((value) => value.split(','))
                .map((value) => toPosix(value.trim()).replace(/^\/+/, ''))
                .filter(Boolean);

            const details = requested.map((file) => buildFileDetails(file));
            return sendJson(res, 200, details);
        } catch {
            return sendJson(res, 500, { error: 'Error resolving file details' });
        }
    }

    if (pathname === '/api/script-files') {
        try {
            return sendJson(res, 200, getScriptFileInventory());
        } catch {
            return sendJson(res, 500, { error: 'Error loading script files' });
        }
    }

    if (pathname === '/api/days') {
        try {
            const inventory = getDayInventory();
            return sendJson(res, 200, inventory.days);
        } catch {
            return sendJson(res, 500, { error: 'Error loading days' });
        }
    }

    if (pathname === '/api/day-details') {
        try {
            const days = parseDays(parsedUrl.searchParams);
            if (days.length === 0) {
                return sendJson(res, 400, { error: 'No days requested' });
            }
            const payload = buildDayDetails(days);
            return sendJson(res, 200, payload);
        } catch {
            return sendJson(res, 500, { error: 'Error loading day details' });
        }
    }

    if (pathname === '/api/scripts/logs' && req.method === 'GET') {
        const requestedRunId = sanitizeRunId(parsedUrl.searchParams.get('runId'));
        const runId = requestedRunId || activeScriptRunId;
        if (!runId) {
            return sendJson(res, 400, { error: 'Invalid or missing runId' });
        }

        const runState = scriptRunStates.get(runId);
        if (!runState) {
            return sendJson(res, 404, { error: 'Run not found' });
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
        });
        res.write(': connected\n\n');

        addScriptLogClient(runId, res);
        sseWrite(res, 'ready', { runId });
        runState.events.forEach((entry) => sseWrite(res, 'log', entry.payload));

        if (runState.status !== 'running') {
            sseWrite(res, 'end', {
                ok: !!runState.summary && runState.summary.failed === 0,
                summary: runState.summary || null
            });
            res.end();
            removeScriptLogClient(runId, res);
            return;
        }

        req.on('close', () => {
            removeScriptLogClient(runId, res);
        });
        return;
    }

    if (pathname === '/api/scripts/state' && req.method === 'GET') {
        return sendJson(res, 200, buildScriptStateSnapshotPayload());
    }

    if (pathname === '/api/scripts/stream' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
        });
        res.write(': connected\n\n');

        addScriptStateClient(res);
        sseWrite(res, 'ready', { ok: true });
        sseWrite(res, 'snapshot', {
            reason: 'connect',
            ...buildScriptStateSnapshotPayload()
        });

        req.on('close', () => {
            removeScriptStateClient(res);
        });
        return;
    }

    if (pathname === '/api/scripts/control' && req.method === 'POST') {
        (async () => {
            try {
                const body = await readBody(req);
                const parsed = JSON.parse(body || '{}');
                const action = typeof parsed.action === 'string' ? parsed.action.trim().toLowerCase() : '';

                if (!activeScriptRunId) {
                    return sendJson(res, 409, { error: 'No active script run' });
                }

                if (action !== 'stop' && action !== 'skip') {
                    return sendJson(res, 400, { error: 'Invalid control action', allowed: ['stop', 'skip'] });
                }

                if (action === 'stop') {
                    activeRunControl.stopRequested = true;
                    activeRunControl.skipRequested = false;
                } else {
                    activeRunControl.skipRequested = !!activeScriptChild;
                }

                broadcastScriptLog(activeScriptRunId, {
                    type: 'control',
                    action,
                    runId: activeScriptRunId
                });

                if (activeScriptChild && !activeScriptChild.killed) {
                    terminateChildProcessTree(activeScriptChild, action);
                }

                return sendJson(res, 200, {
                    ok: true,
                    action,
                    runId: activeScriptRunId
                });
            } catch {
                return sendJson(res, 500, { error: 'Failed to control script run' });
            }
        })();
        return;
    }

    // ── Server-owned task queue endpoints ──────────────────────────────────

    if (pathname === '/api/queue' && req.method === 'GET') {
        const activeEntry = activeScriptRunId
            ? scriptRunStates.get(activeScriptRunId)?.currentEntry || null
            : null;
        return sendJson(res, 200, {
            queue: taskQueue.slice(),
            activeRunId: activeScriptRunId || null,
            activeEntry
        });
    }

    if (pathname === '/api/queue/enqueue' && req.method === 'POST') {
        (async () => {
            try {
                const body = await readBody(req);
                const parsed = JSON.parse(body || '{}');
                const taskKey = typeof parsed.taskKey === 'string' ? parsed.taskKey.trim() : null;
                const fileKey = typeof parsed.fileKey === 'string' ? parsed.fileKey.trim() || null : null;

                if (!taskKey || !TASK_FACTORY[taskKey]) {
                    return sendJson(res, 400, { error: 'Invalid taskKey', allowed: Object.keys(TASK_FACTORY) });
                }

                const factory = TASK_FACTORY[taskKey];
                if (factory.needsFile && !fileKey) {
                    return sendJson(res, 400, { error: 'fileKey is required for this task' });
                }

                if (factory.needsFile) {
                    const target = sanitizeTarget(fileKey);
                    if (!target) {
                        return sendJson(res, 400, { error: 'File target not found', fileKey });
                    }
                }

                const entry = enqueueTask(taskKey, fileKey);
                maybeStartNextFromQueue();

                return sendJson(res, 200, {
                    ok: true,
                    queued: !!entry,
                    taskId: makeTaskId(taskKey, fileKey),
                    queue: taskQueue.slice()
                });
            } catch {
                return sendJson(res, 500, { error: 'Failed to enqueue task' });
            }
        })();
        return;
    }

    if (pathname === '/api/queue/enqueue-batch' && req.method === 'POST') {
        (async () => {
            try {
                const body = await readBody(req);
                const parsed = JSON.parse(body || '{}');
                const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

                if (tasks.length === 0) {
                    return sendJson(res, 400, { error: 'tasks array is required' });
                }

                const errors = [];
                const queued = [];

                for (const item of tasks) {
                    const taskKey = typeof item.taskKey === 'string' ? item.taskKey.trim() : null;
                    const fileKey = typeof item.fileKey === 'string' ? item.fileKey.trim() || null : null;

                    if (!taskKey || !TASK_FACTORY[taskKey]) {
                        errors.push({ taskKey, fileKey, error: 'Invalid taskKey' });
                        continue;
                    }

                    const factory = TASK_FACTORY[taskKey];
                    if (factory.needsFile && !fileKey) {
                        errors.push({ taskKey, fileKey, error: 'fileKey is required for this task' });
                        continue;
                    }

                    if (factory.needsFile) {
                        const target = sanitizeTarget(fileKey);
                        if (!target) {
                            errors.push({ taskKey, fileKey, error: 'File target not found' });
                            continue;
                        }
                    }

                    const entry = enqueueTask(taskKey, fileKey);
                    queued.push({ taskKey, fileKey, taskId: makeTaskId(taskKey, fileKey), added: !!entry });
                }

                // Start the run once, after all tasks are queued.
                maybeStartNextFromQueue();

                return sendJson(res, 200, {
                    ok: true,
                    queued,
                    errors,
                    queue: taskQueue.slice()
                });
            } catch {
                return sendJson(res, 500, { error: 'Failed to enqueue batch' });
            }
        })();
        return;
    }

    if (pathname.startsWith('/api/queue/') && req.method === 'DELETE') {
        const taskId = decodeURIComponent(pathname.slice('/api/queue/'.length));
        if (!taskId) {
            return sendJson(res, 400, { error: 'Missing taskId' });
        }
        dequeueTask(taskId);
        return sendJson(res, 200, { ok: true, queue: taskQueue.slice() });
    }

    if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Unknown API route' });
    }

    if (pathname.startsWith('/data/')) {
        const relPath = toPosix(decodeURIComponent(pathname.slice('/data/'.length))).replace(/^\/+/, '');
        const filePath = safeResolve(DATA_DIR, relPath);

        if (!filePath) {
            res.writeHead(403);
            return res.end('Forbidden');
        }

        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                res.writeHead(404);
                return res.end('Not a file');
            }

            const ext = path.extname(filePath);
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            return fs.createReadStream(filePath).pipe(res);
        } catch {
            res.writeHead(404);
            return res.end('Not found');
        }
    }

    // Static file serving

    if (pathname === '/') {
        pathname = '/index.html';
    }

    const relClientPath = toPosix(decodeURIComponent(pathname)).replace(/^\/+/, '');
    const filePath = safeResolve(CLIENT_DIR, relClientPath);

    if (!filePath) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    try {
        const stat = fs.statSync(filePath);

        if (!stat.isFile()) {
            res.writeHead(404);
            return res.end('Not found');
        }

        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        return fs.createReadStream(filePath).pipe(res);
    } catch {
        res.writeHead(404);
        return res.end('Not found');
    }
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
    console.log('ROOT   :', ROOT);
    console.log('DATA   :', DATA_DIR);
    console.log('CLIENT :', CLIENT_DIR);
});
