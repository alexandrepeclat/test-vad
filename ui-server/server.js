import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CLIENT_DIR = path.join(ROOT, 'ui-client');
const scriptLogClients = new Map();

const SCRIPT_ALLOWLIST = new Set([
    'run-meta-json.ps1',
    'run-vad-pyannote.ps1',
    'run-vad-silero.ps1',
    'run-build-spectrogram.ps1',
    'run-build-peaks.ps1'
]);

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

function broadcastScriptLog(runId, payload) {
    if (!runId) return;
    const set = scriptLogClients.get(runId);
    if (!set || set.size === 0) return;
    set.forEach((res) => sseWrite(res, 'log', payload));
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

        if (!current || (ext === '.mp3' && current.ext !== '.mp3')) {
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
    const processingRel = findPreferredAudioCandidate(audioRelPath, 'wav');
    const clientRel = findPreferredAudioCandidate(audioRelPath, 'mp3');
    const processingAbs = safeResolve(DATA_DIR, processingRel);
    const clientAbs = safeResolve(DATA_DIR, clientRel);
    const baseRel = processingRel.replace(/\.(mp3|wav)$/i, '');

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
        baseName: path.basename(baseRel),
        audioPath: `/data/${toPosix(clientRel)}`,
        processingAudioPath: `/data/${toPosix(processingRel)}`,
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
    if (scriptName === 'run-meta-json.ps1') return `${stem}_metadata.json`;
    if (scriptName === 'run-vad-pyannote.ps1') return `${stem}_pyannote.json`;
    if (scriptName === 'run-vad-silero.ps1') return `${stem}_silero.json`;
    if (scriptName === 'run-build-spectrogram.ps1') return `${stem}_spectrogram.png`;
    if (scriptName === 'run-build-peaks.ps1') return `${stem}_peaks.json`;
    return null;
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

        const startedAt = Date.now();
        const child = spawn('powershell.exe', args, { cwd: ROOT });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
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
            resolve({
                script: scriptName,
                inputPath: displayInputPath,
                outputPath: displayOutputPath,
                ok: code === 0,
                code,
                durationMs: Date.now() - startedAt,
                stdout,
                stderr
            });
        });
    });
}

function sanitizeTarget(value) {
    if (typeof value !== 'string') return null;
    const normalized = toPosix(value).replace(/^\/+/, '').trim();
    if (!normalized) return null;

    const resolved = safeResolve(DATA_DIR, normalized);
    if (!resolved || !fs.existsSync(resolved)) return null;

    return findPreferredAudioCandidate(normalized, 'wav');
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
        const runId = sanitizeRunId(parsedUrl.searchParams.get('runId'));
        if (!runId) {
            return sendJson(res, 400, { error: 'Invalid or missing runId' });
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
        });
        res.write(': connected\n\n');

        addScriptLogClient(runId, res);
        sseWrite(res, 'ready', { runId });

        req.on('close', () => {
            removeScriptLogClient(runId, res);
        });
        return;
    }

    if (pathname === '/api/scripts/run' && req.method === 'POST') {
        (async () => {
            let runId = null;
            try {
                const body = await readBody(req);
                const parsed = JSON.parse(body || '{}');
                runId = sanitizeRunId(parsed.runId);

                const scripts = Array.isArray(parsed.scripts)
                    ? parsed.scripts
                    : typeof parsed.script === 'string'
                        ? [parsed.script]
                        : [];
                const force = parsed.force === true;
                const continueOnError = parsed.continueOnError !== false;

                if (scripts.length === 0) {
                    return sendJson(res, 400, { error: 'No scripts requested' });
                }

                const invalidScripts = scripts.filter((s) => !SCRIPT_ALLOWLIST.has(s));
                if (invalidScripts.length > 0) {
                    return sendJson(res, 400, {
                        error: 'Some scripts are not allowed',
                        invalid: invalidScripts,
                        allowed: Array.from(SCRIPT_ALLOWLIST)
                    });
                }

                const requestedTargets = Array.isArray(parsed.targets)
                    ? parsed.targets
                    : typeof parsed.target === 'string'
                        ? [parsed.target]
                        : [];

                const targets = requestedTargets
                    .map((t) => sanitizeTarget(t))
                    .filter(Boolean);

                if (requestedTargets.length > 0 && targets.length === 0) {
                    return sendJson(res, 400, { error: 'No valid targets found' });
                }

                const executionTargets = targets.length > 0 ? targets : [null];
                const results = [];
                let stopped = false;

                broadcastScriptLog(runId, {
                    type: 'run-start',
                    runId,
                    scripts,
                    targets,
                    force,
                    continueOnError
                });

                for (const script of scripts) {
                    for (const target of executionTargets) {
                        if (!target) {
                            results.push({
                                script,
                                inputPath: null,
                                outputPath: null,
                                skipped: true,
                                reason: 'Missing target',
                                ok: false,
                                code: -1,
                                durationMs: 0,
                                stdout: '',
                                stderr: 'Target is required for this script contract'
                            });
                            broadcastScriptLog(runId, {
                                type: 'result',
                                script,
                                inputPath: null,
                                outputPath: null,
                                skipped: true,
                                ok: false,
                                reason: 'Missing target'
                            });
                            if (!continueOnError) {
                                stopped = true;
                                break;
                            }
                            continue;
                        }

                        const outputRel = buildOutputForScript(script, target);
                        if (!outputRel) {
                            results.push({
                                script,
                                inputPath: target,
                                outputPath: null,
                                skipped: true,
                                reason: 'Unknown output mapping',
                                ok: false,
                                code: -1,
                                durationMs: 0,
                                stdout: '',
                                stderr: 'Output mapping is not defined for this script'
                            });
                            broadcastScriptLog(runId, {
                                type: 'result',
                                script,
                                inputPath: target,
                                outputPath: null,
                                skipped: true,
                                ok: false,
                                reason: 'Unknown output mapping'
                            });
                            if (!continueOnError) {
                                stopped = true;
                                break;
                            }
                            continue;
                        }

                        const outputAbs = safeResolve(DATA_DIR, outputRel);
                        const shouldSkip = (!force && outputAbs && fs.existsSync(outputAbs));
                        if (shouldSkip) {
                            results.push({
                                script,
                                inputPath: target,
                                outputPath: outputRel,
                                skipped: true,
                                reason: 'Output already exists',
                                ok: true,
                                code: 0,
                                durationMs: 0,
                                stdout: 'Skipped: output already exists',
                                stderr: ''
                            });
                            broadcastScriptLog(runId, {
                                type: 'result',
                                script,
                                inputPath: target,
                                outputPath: outputRel,
                                skipped: true,
                                ok: true,
                                reason: 'Output already exists'
                            });
                            continue;
                        }

                        const inputAbs = safeResolve(DATA_DIR, target);
                        if (!inputAbs || !fs.existsSync(inputAbs)) {
                            results.push({
                                script,
                                inputPath: target,
                                outputPath: outputRel,
                                skipped: true,
                                reason: 'Input does not exist',
                                ok: false,
                                code: -1,
                                durationMs: 0,
                                stdout: '',
                                stderr: 'Input path does not exist'
                            });
                            broadcastScriptLog(runId, {
                                type: 'result',
                                script,
                                inputPath: target,
                                outputPath: outputRel,
                                skipped: true,
                                ok: false,
                                reason: 'Input does not exist'
                            });
                            if (!continueOnError) {
                                stopped = true;
                                break;
                            }
                            continue;
                        }

                        broadcastScriptLog(runId, {
                            type: 'task-start',
                            script,
                            inputPath: target,
                            outputPath: outputRel
                        });

                        const result = await runScript(
                            script,
                            inputAbs,
                            outputAbs,
                            target,
                            outputRel,
                            (chunkInfo) => {
                                broadcastScriptLog(runId, {
                                    type: 'chunk',
                                    ...chunkInfo
                                });
                            }
                        );
                        results.push(result);
                        broadcastScriptLog(runId, {
                            type: 'task-end',
                            script,
                            inputPath: result.inputPath,
                            outputPath: result.outputPath,
                            ok: result.ok,
                            code: result.code,
                            durationMs: result.durationMs
                        });

                        if (!result.ok && !continueOnError) {
                            stopped = true;
                            break;
                        }
                    }
                    if (stopped) break;
                }

                const ok = results.every((r) => r.ok);
                const summary = {
                    total: results.length,
                    success: results.filter((r) => r.ok).length,
                    failed: results.filter((r) => !r.ok).length,
                    stoppedEarly: stopped
                };

                broadcastScriptLog(runId, {
                    type: 'run-end',
                    ok,
                    summary
                });

                closeScriptLogStream(runId, { ok, summary });

                return sendJson(res, ok ? 200 : 500, {
                    ok,
                    runId,
                    force,
                    targets,
                    scripts,
                    summary,
                    results
                });
            } catch {
                closeScriptLogStream(runId, { ok: false, error: 'Failed to run scripts' });
                return sendJson(res, 500, { error: 'Failed to run scripts' });
            }
        })();
        return;
    }

    if (pathname === '/api/scripts/run') {
        return sendJson(res, 405, { error: 'Method not allowed' });
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
