import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';

const state = {
    selectedDays: [],
    loadedTargets: [],
    segmentCards: new Map(),
    observer: null,
    alignedWindow: {
        minTodMs: null,
        maxTodMs: null,
        spanMs: null
    }
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dayListEl = document.getElementById('dayList');
const graphsEl = document.getElementById('graphs');
const pyToggleEl = document.getElementById('pyToggle');
const silToggleEl = document.getElementById('silToggle');
const waveToggleEl = document.getElementById('waveToggle');
const spectroToggleEl = document.getElementById('spectroToggle');
const zoomInfoEl = document.getElementById('zoomInfo');
const scriptOutputEl = document.getElementById('scriptOutput');
const forceScriptToggleEl = document.getElementById('forceScriptToggle');

const BASE_TIMELINE_WIDTH = 1400;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const OVERLAY_PREFS_KEY = 'vadViewer.overlayPrefs.v1';

state.zoom = 1;
state.dayScrollEls = [];
state.dayTrackEls = [];
state.syncingScroll = false;

function applyZoom() {
    const width = Math.round(BASE_TIMELINE_WIDTH * state.zoom);
    state.dayTrackEls.forEach((el) => {
        el.style.width = `${width}px`;
    });
    zoomInfoEl.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(nextZoom, anchorClientX = null) {
    const prevZoom = state.zoom;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    if (Math.abs(clamped - prevZoom) < 0.0001) return;

    const refScroller = state.dayScrollEls[0] || null;
    const prevWidth = BASE_TIMELINE_WIDTH * prevZoom;
    const prevScrollLeft = refScroller ? refScroller.scrollLeft : 0;
    const anchorX = anchorClientX === null || !refScroller
        ? (refScroller ? (refScroller.clientWidth / 2) : 0)
        : (anchorClientX - refScroller.getBoundingClientRect().left);
    const anchorRatio = (prevScrollLeft + anchorX) / Math.max(1, prevWidth);

    state.zoom = clamped;
    applyZoom();

    const nextWidth = BASE_TIMELINE_WIDTH * clamped;
    const desiredScrollLeft = (anchorRatio * nextWidth) - anchorX;
    const clampedScrollLeft = Math.max(0, desiredScrollLeft);
    state.dayScrollEls.forEach((el) => {
        el.scrollLeft = clampedScrollLeft;
    });
}

function syncDayScrolls(sourceEl) {
    if (state.syncingScroll) return;
    state.syncingScroll = true;

    const left = sourceEl.scrollLeft;
    state.dayScrollEls.forEach((el) => {
        if (el !== sourceEl) {
            el.scrollLeft = left;
        }
    });

    state.syncingScroll = false;
}

function wireDayScrollSync(dayScrollEls) {
    state.dayScrollEls = dayScrollEls;

    dayScrollEls.forEach((el) => {
        el.addEventListener('scroll', () => {
            syncDayScrolls(el);
        });

        el.addEventListener('wheel', (event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();

            const delta = -event.deltaY;
            const factor = delta > 0 ? 1.1 : 0.9;
            setZoom(state.zoom * factor, event.clientX);
        }, { passive: false });
    });
}

function formatDuration(sec) {
    if (!Number.isFinite(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatDateTime(ms) {
    if (!Number.isFinite(ms)) return 'N/A';
    return new Date(ms).toLocaleString();
}

function formatTimeOnly(ms) {
    if (!Number.isFinite(ms)) return '--:--:--';
    return new Date(ms).toLocaleTimeString();
}

function formatTod(ms) {
    if (!Number.isFinite(ms)) return '--:--';
    const h = Math.floor(ms / (60 * 60 * 1000));
    const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function getWeekdayFr(dayIso) {
    try {
        const d = new Date(`${dayIso}T00:00:00`);
        if (Number.isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(d);
    } catch {
        return '';
    }
}

function saveOverlayPrefs() {
    const prefs = {
        py: !!pyToggleEl.checked,
        sil: !!silToggleEl.checked,
        wave: !!waveToggleEl.checked,
        spectro: !!spectroToggleEl.checked
    };
    localStorage.setItem(OVERLAY_PREFS_KEY, JSON.stringify(prefs));
}

function restoreOverlayPrefs() {
    try {
        const raw = localStorage.getItem(OVERLAY_PREFS_KEY);
        if (!raw) return;
        const prefs = JSON.parse(raw);
        if (typeof prefs.py === 'boolean') pyToggleEl.checked = prefs.py;
        if (typeof prefs.sil === 'boolean') silToggleEl.checked = prefs.sil;
        if (typeof prefs.wave === 'boolean') waveToggleEl.checked = prefs.wave;
        if (typeof prefs.spectro === 'boolean') spectroToggleEl.checked = prefs.spectro;
    } catch {
        // Ignore malformed localStorage payloads.
    }
}

function waitImageLoaded(imgEl) {
    return new Promise((resolve) => {
        if (!imgEl || !imgEl.getAttribute('src')) {
            resolve();
            return;
        }
        if (imgEl.complete) {
            resolve();
            return;
        }
        const onDone = () => {
            imgEl.removeEventListener('load', onDone);
            imgEl.removeEventListener('error', onDone);
            resolve();
        };
        imgEl.addEventListener('load', onDone, { once: true });
        imgEl.addEventListener('error', onDone, { once: true });
    });
}

function getTimeOfDayMs(ms) {
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    return (
        date.getHours() * 60 * 60 * 1000
        + date.getMinutes() * 60 * 1000
        + date.getSeconds() * 1000
        + date.getMilliseconds()
    );
}

function drawCurve(ctx, canvas, t, p, color) {
    if (!Array.isArray(t) || !Array.isArray(p) || t.length === 0 || p.length === 0) return;
    const maxT = t[t.length - 1] || 1;

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);

    for (let i = 0; i < t.length; i += 1) {
        const x = (t[i] / maxT) * canvas.width;
        const y = canvas.height - (Math.max(0, Math.min(1, p[i] ?? 0)) * canvas.height);
        ctx.lineTo(x, y);
    }

    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.beginPath();

    for (let i = 0; i < t.length; i += 1) {
        const x = (t[i] / maxT) * canvas.width;
        const y = canvas.height - (Math.max(0, Math.min(1, p[i] ?? 0)) * canvas.height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.stroke();
}

function resizeCanvas(card) {
    const rect = card.waveEl.getBoundingClientRect();
    card.canvas.width = Math.max(1, Math.floor(rect.width));
    card.canvas.height = Math.max(1, Math.floor(rect.height));
}

function drawSegmentCard(card) {
    const ctx = card.ctx;
    ctx.clearRect(0, 0, card.canvas.width, card.canvas.height);

    if (pyToggleEl.checked && card.pyData) {
        drawCurve(ctx, card.canvas, card.pyData.t, card.pyData.p, '#cc1a36');
    }
    if (silToggleEl.checked && card.silData) {
        drawCurve(ctx, card.canvas, card.silData.t, card.silData.p, '#1764c0');
    }
}

function setSegmentStatus(card, message, isError = false) {
    if (!card.statusEl) return;
    card.statusEl.textContent = message;
    card.statusEl.classList.toggle('error', !!isError);
    ensureLaneHeight(card.laneEl);
}

function formatAbsoluteFromStart(startMs, seconds) {
    if (!Number.isFinite(startMs) || !Number.isFinite(seconds)) return '';
    const abs = new Date(startMs + (seconds * 1000));
    return abs.toLocaleTimeString();
}

function setAbsoluteTimeIndicator(card, seconds, show = true) {
    if (!card.absTimeEl) return;
    const value = formatAbsoluteFromStart(card.detail.startMs, seconds);
    if (!value) {
        card.absTimeEl.textContent = '';
        card.absTimeEl.classList.remove('visible');
        return;
    }

    card.absTimeEl.textContent = value;
    card.absTimeEl.classList.toggle('visible', !!show);
}

function computeAlignedWindow(dayGroups) {
    let minTodMs = Number.POSITIVE_INFINITY;
    let maxTodMs = Number.NEGATIVE_INFINITY;

    (dayGroups || []).forEach((group) => {
        (group.files || []).forEach((file) => {
            const startTod = getTimeOfDayMs(file.startMs);
            if (Number.isFinite(startTod)) {
                minTodMs = Math.min(minTodMs, startTod);
            }

            let endTod = getTimeOfDayMs(file.endMs);
            if (Number.isFinite(file.startMs) && Number.isFinite(file.endMs) && file.endMs < file.startMs) {
                // If file crosses midnight, keep it in one segment and clip towards day end.
                endTod = DAY_MS;
            }
            if (Number.isFinite(endTod)) {
                maxTodMs = Math.max(maxTodMs, endTod);
            }
        });
    });

    if (!Number.isFinite(minTodMs) || !Number.isFinite(maxTodMs) || maxTodMs <= minTodMs) {
        return null;
    }

    return {
        minTodMs,
        maxTodMs,
        spanMs: maxTodMs - minTodMs
    };
}

function toPercent(ms, window) {
    if (!window) return 0;
    return ((ms - window.minTodMs) / window.spanMs) * 100;
}

function buildTimelineHeader(window) {
    const header = document.createElement('div');
    header.className = 'day-timeline-header';

    if (!window) {
        header.textContent = 'Axe absolu indisponible (metadata incomplètes).';
        return header;
    }

    const HOUR_MS = 60 * 60 * 1000;
    const HALF_HOUR_MS = 30 * 60 * 1000;

    const firstTick = Math.floor(window.minTodMs / HOUR_MS) * HOUR_MS;
    const lastTick = Math.ceil(window.maxTodMs / HOUR_MS) * HOUR_MS;

    for (let tickMs = firstTick; tickMs <= lastTick; tickMs += HALF_HOUR_MS) {
        const ratio = (tickMs - window.minTodMs) / window.spanMs;
        if (ratio < -0.0001 || ratio > 1.0001) continue;

        const tick = document.createElement('div');
        tick.className = 'timeline-tick';
        tick.style.left = `${ratio * 100}%`;
        header.appendChild(tick);

        if (tickMs % HOUR_MS === 0) {
            const label = document.createElement('div');
            label.className = 'timeline-label';
            label.style.left = `${ratio * 100}%`;
            label.textContent = formatTod(tickMs);
            header.appendChild(label);
        }
    }

    return header;
}

function getSingleLane(files) {
    return [files.slice().sort((a, b) => (a.startMs ?? Number.MAX_SAFE_INTEGER) - (b.startMs ?? Number.MAX_SAFE_INTEGER))];
}

function applyLayerVisibility(card) {
    card.waveEl.style.opacity = waveToggleEl.checked ? '0.4' : '0';
    card.spectroEl.style.opacity = spectroToggleEl.checked ? '0.95' : '0';
}

function ensureLaneHeight(laneEl) {
    if (!laneEl) return;

    const segments = Array.from(laneEl.querySelectorAll('.segment'));
    if (segments.length === 0) {
        laneEl.style.minHeight = '176px';
        return;
    }

    let maxBottom = 0;
    segments.forEach((seg) => {
        const top = seg.offsetTop || 0;
        const h = seg.offsetHeight || 0;
        maxBottom = Math.max(maxBottom, top + h);
    });

    laneEl.style.minHeight = `${Math.max(176, maxBottom + 8)}px`;
}

function pauseOtherPlayers(activeCard) {
    state.segmentCards.forEach((card) => {
        if (card === activeCard) return;
        if (card.ws && card.ws.isPlaying()) {
            card.ws.pause();
        }
    });
}

function buildSegment(detail, segmentId, window, laneEl) {
    const segmentEl = document.createElement('article');
    segmentEl.className = 'segment file-card';
    segmentEl.dataset.segmentId = segmentId;

    const waveId = `wave-${segmentId}`;
    const fileName = (detail.audioFile || '').split('/').pop() || detail.audioFile;
    const startLabel = formatTimeOnly(detail.startMs);
    const endLabel = formatTimeOnly(detail.endMs);

    segmentEl.innerHTML = `
        <div class="file-head">
            <div class="file-title">${fileName}</div>
            <div class="file-times small">
                <span>${startLabel}</span>
                <span class="file-time-center" data-abs-time></span>
                <span>${endLabel}</span>
            </div>
        </div>
        <div class="wave-wrap">
            <img class="spectro-layer" alt="Spectrogram" src="${detail.exists.spectrogram ? detail.spectrogramPath : ''}" />
            <div class="waveform" id="${waveId}"></div>
            <canvas class="vadgraph" data-vad-canvas></canvas>
        </div>
        <div class="controls">
            <button data-action="play" class="player-btn" title="Play">▶</button>
            <button data-action="pause" class="player-btn" title="Pause">⏸</button>
            <button data-action="stop" class="player-btn" title="Stop">⏹</button>
            <span class="small" data-time>0:00 / --:--</span>
        </div>
    `;

    const startTod = getTimeOfDayMs(detail.startMs);
    let endTod = getTimeOfDayMs(detail.endMs);
    if (Number.isFinite(detail.startMs) && Number.isFinite(detail.endMs) && detail.endMs < detail.startMs) {
        endTod = DAY_MS;
    }

    if (window && Number.isFinite(startTod) && Number.isFinite(endTod)) {
        const left = Math.max(0, Math.min(100, toPercent(startTod, window)));
        const right = Math.max(0, Math.min(100, toPercent(endTod, window)));
        const width = Math.max(3, right - left);
        segmentEl.style.left = `${left}%`;
        segmentEl.style.width = `${width}%`;
    } else {
        segmentEl.style.left = '0%';
        segmentEl.style.width = '22%';
    }

    const waveEl = segmentEl.querySelector(`#${waveId}`);
    const canvas = segmentEl.querySelector('[data-vad-canvas]');
    const timeEl = segmentEl.querySelector('[data-time]');
    const absTimeEl = segmentEl.querySelector('[data-abs-time]');
    const spectroEl = segmentEl.querySelector('.spectro-layer');

    const card = {
        id: segmentId,
        detail,
        laneEl,
        rootEl: segmentEl,
        waveEl,
        canvas,
        ctx: canvas.getContext('2d'),
        timeEl,
        absTimeEl,
        spectroEl,
        ws: null,
        initialized: false,
        pyData: null,
        silData: null
    };

    segmentEl.querySelector('[data-action="play"]').onclick = () => {
        if (!card.ws) return;
        pauseOtherPlayers(card);
        card.ws.play();
    };
    segmentEl.querySelector('[data-action="pause"]').onclick = () => card.ws?.pause();
    segmentEl.querySelector('[data-action="stop"]').onclick = () => {
        card.ws?.pause();
        card.ws?.setTime(0);
    };

    if (!detail.exists.spectrogram) {
        spectroEl.alt = 'Spectrogram indisponible';
        spectroEl.removeAttribute('src');
    }

    applyLayerVisibility(card);

    return card;
}

async function fetchJsonIfExists(url, exists) {
    if (!exists) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
}

async function initSegmentCard(card) {
    if (card.initialized) return;
    card.initialized = true;

    resizeCanvas(card);

    const missing = Object.entries(card.detail.exists)
        .filter(([_, ok]) => !ok)
        .map(([name]) => name);

    if (missing.length > 0) {
        setSegmentStatus(card, `Assets manquants: ${missing.join(', ')}`);
    } else {
        setSegmentStatus(card, 'Chargement...');
    }

    try {
        const [pyData, silData] = await Promise.all([
            fetchJsonIfExists(card.detail.pyannotePath, card.detail.exists.pyannote),
            fetchJsonIfExists(card.detail.sileroPath, card.detail.exists.silero)
        ]);

        await waitImageLoaded(card.spectroEl);

        card.pyData = pyData;
        card.silData = silData;
        drawSegmentCard(card);

        const peaksData = await fetchJsonIfExists(card.detail.peaksPath, card.detail.exists.peaks);

        card.ws = WaveSurfer.create({
            container: card.waveEl,
            waveColor: '#8b93a7',
            progressColor: '#202738',
            height: 120,
            fillParent: true,
            minPxPerSec: 0,
            interact: true,
            partialRender: true,
            backend: 'WebAudio'
        });

        card.ws.on('ready', () => {
            const duration = card.ws.getDuration();
            card.timeEl.textContent = `0:00 / ${formatDuration(duration)}`;
            resizeCanvas(card);
            drawSegmentCard(card);
            setAbsoluteTimeIndicator(card, 0, false);
        });

        card.ws.on('timeupdate', () => {
            const current = card.ws.getCurrentTime();
            const duration = card.ws.getDuration();
            card.timeEl.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
            setAbsoluteTimeIndicator(card, current, true);
        });

        card.ws.on('play', () => {
            pauseOtherPlayers(card);
        });

        card.ws.on('interaction', () => {
            const current = card.ws.getCurrentTime();
            setAbsoluteTimeIndicator(card, current, true);
        });

        card.ws.on('seeking', (current) => {
            setAbsoluteTimeIndicator(card, current, true);
        });

        const peaks = Array.isArray(peaksData?.peaks) ? peaksData.peaks : undefined;
        card.ws.load(card.detail.audioPath, peaks);
    } catch (err) {
        console.error(err);
        setSegmentStatus(card, 'Erreur chargement données segment', true);
    }
}

function destroyAllSegments() {
    state.segmentCards.forEach((card) => {
        card.ws?.destroy();
    });
    state.segmentCards.clear();

    if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
    }

    state.dayScrollEls = [];
    state.dayTrackEls = [];
    graphsEl.innerHTML = '';
}

function setupLazyInit(cards) {
    state.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const card = state.segmentCards.get(entry.target.dataset.segmentId);
            if (card) {
                initSegmentCard(card);
            }
        });
    }, {
        root: null,
        threshold: 0.15
    });

    cards.forEach((card) => state.observer.observe(card.rootEl));
}

function buildDayCard(dayGroup, dayIndex, window) {
    const wrapper = document.createElement('section');
    wrapper.className = 'day-card';

    const title = document.createElement('div');
    title.className = 'day-title';
    const weekday = getWeekdayFr(dayGroup.day);
    title.textContent = weekday ? `${dayGroup.day} (${weekday})` : dayGroup.day;

    const subtitle = document.createElement('div');
    subtitle.className = 'day-subtitle';
    subtitle.textContent = `Plage horaire alignee: ${formatTod(window?.minTodMs)} -> ${formatTod(window?.maxTodMs)}`;

    const head = document.createElement('div');
    head.className = 'day-head';
    head.appendChild(title);
    head.appendChild(subtitle);
    wrapper.appendChild(head);

    const scrollerEl = document.createElement('div');
    scrollerEl.className = 'day-scroll';

    const trackEl = document.createElement('div');
    trackEl.className = 'day-track';
    trackEl.style.width = `${Math.round(BASE_TIMELINE_WIDTH * state.zoom)}px`;

    trackEl.appendChild(buildTimelineHeader(window));

    const lanes = getSingleLane(dayGroup.files);
    const cards = [];

    lanes.forEach((laneFiles, laneIndex) => {
        const laneEl = document.createElement('div');
        laneEl.className = 'lane';

        laneFiles.forEach((detail, segmentIndex) => {
            const segmentId = `${dayIndex}-${laneIndex}-${segmentIndex}`;
            const card = buildSegment(detail, segmentId, window, laneEl);
            laneEl.appendChild(card.rootEl);
            state.segmentCards.set(card.id, card);
            cards.push(card);
        });

        requestAnimationFrame(() => ensureLaneHeight(laneEl));

        trackEl.appendChild(laneEl);
    });

    scrollerEl.appendChild(trackEl);
    wrapper.appendChild(scrollerEl);

    return { wrapper, cards, scrollerEl, trackEl };
}

async function loadSelectedDays() {
    const selected = Array.from(dayListEl.querySelectorAll('input[type="checkbox"]:checked'))
        .map((el) => el.value)
        .sort((a, b) => a.localeCompare(b, 'en'));

    state.selectedDays = selected;
    destroyAllSegments();

    if (selected.length === 0) {
        graphsEl.innerHTML = '<div class="small">Sélectionne un ou plusieurs jours.</div>';
        state.loadedTargets = [];
        return;
    }

    const query = selected.map((d) => `days=${encodeURIComponent(d)}`).join('&');
    const res = await fetch(`/api/day-details?${query}`);
    if (!res.ok) {
        throw new Error('Failed to load day details');
    }

    const payload = await res.json();
    const window = computeAlignedWindow(payload.days || []);
    state.alignedWindow = window || {
        minTodMs: null,
        maxTodMs: null,
        spanMs: null
    };
    const allCards = [];
    const dayScrollEls = [];
    const dayTrackEls = [];
    state.loadedTargets = [];

    (payload.days || []).forEach((dayGroup, idx) => {
        const { wrapper, cards, scrollerEl, trackEl } = buildDayCard(dayGroup, idx, window);
        graphsEl.appendChild(wrapper);
        allCards.push(...cards);
        dayScrollEls.push(scrollerEl);
        dayTrackEls.push(trackEl);
        state.loadedTargets.push(...dayGroup.files.map((f) => f.processingFile || f.audioFile));
    });

    state.dayTrackEls = dayTrackEls;
    applyZoom();
    wireDayScrollSync(dayScrollEls);

    setupLazyInit(allCards);
    allCards.slice(0, 4).forEach((card) => initSegmentCard(card));

    if (allCards.length === 0) {
        graphsEl.innerHTML = '<div class="small">Aucun fichier charge pour les jours selectionnes.</div>';
    }
}

async function loadDayList() {
    const res = await fetch('/api/days');
    if (!res.ok) {
        throw new Error('Failed to load day list');
    }

    const days = await res.json();
    dayListEl.innerHTML = '';

    days.forEach((day) => {
        const li = document.createElement('li');
        li.innerHTML = `<label><input type="checkbox" value="${day}" checked> ${day}</label>`;
        dayListEl.appendChild(li);
    });

    if (days.length > 0) {
        await loadSelectedDays();
    }
}

function getSelectedScripts() {
    return Array.from(document.querySelectorAll('.script-check:checked')).map((el) => el.value);
}

function createRunId() {
    const rnd = Math.random().toString(36).slice(2, 10);
    return `run-${Date.now()}-${rnd}`;
}

function appendScriptOutput(line) {
    const prev = scriptOutputEl.textContent || '';
    scriptOutputEl.textContent = prev ? `${prev}\n${line}` : line;
    scriptOutputEl.scrollTop = scriptOutputEl.scrollHeight;
}

function connectScriptLogStream(runId) {
    if (!window.EventSource) {
        return {
            ready: Promise.resolve(false),
            done: Promise.resolve(),
            close: () => {}
        };
    }

    let resolveReady;
    let resolveDone;
    const ready = new Promise((resolve) => {
        resolveReady = resolve;
    });
    const done = new Promise((resolve) => {
        resolveDone = resolve;
    });

    let isDone = false;
    const finalize = () => {
        if (isDone) return;
        isDone = true;
        resolveDone();
        es.close();
    };

    const es = new EventSource(`/api/scripts/logs?runId=${encodeURIComponent(runId)}`);

    es.addEventListener('ready', () => {
        resolveReady(true);
    });

    es.addEventListener('log', (event) => {
        try {
            const entry = JSON.parse(event.data || '{}');

            if (entry.type === 'task-start') {
                appendScriptOutput(`> ${entry.script} | ${entry.inputPath || '(none)'} -> ${entry.outputPath || '(none)'}`);
                return;
            }

            if (entry.type === 'chunk') {
                const prefix = entry.stream === 'stderr' ? '[err]' : '[out]';
                const lines = String(entry.text || '').split(/\r?\n/).filter(Boolean);
                lines.forEach((line) => appendScriptOutput(`${prefix} ${line}`));
                return;
            }

            if (entry.type === 'result') {
                const label = entry.skipped ? 'SKIPPED' : (entry.ok ? 'OK' : 'FAILED');
                appendScriptOutput(`${entry.script} | ${entry.inputPath || '(none)'} | ${label}${entry.reason ? ` | ${entry.reason}` : ''}`);
                return;
            }

            if (entry.type === 'task-end') {
                const label = entry.ok ? 'OK' : 'FAILED';
                appendScriptOutput(`< ${entry.script} | ${label} | ${entry.durationMs}ms`);
                return;
            }

            if (entry.type === 'run-end' && entry.summary) {
                appendScriptOutput(`summary: total=${entry.summary.total} ok=${entry.summary.success} failed=${entry.summary.failed}`);
            }
        } catch {
            // Ignore malformed SSE payloads.
        }
    });

    es.addEventListener('end', () => {
        finalize();
    });

    es.onerror = () => {
        if (!isDone) {
            resolveReady(false);
        }
    };

    return {
        ready,
        done,
        close: finalize
    };
}

async function runScriptsOnLoadedTargets() {
    const scripts = getSelectedScripts();
    if (scripts.length === 0) {
        scriptOutputEl.textContent = 'Selectionne au moins un script.';
        return;
    }
    if (state.loadedTargets.length === 0) {
        scriptOutputEl.textContent = 'Charge d\'abord un ou plusieurs jours.';
        return;
    }

    scriptOutputEl.textContent = 'Execution scripts en cours...';

    const runId = createRunId();
    const logStream = connectScriptLogStream(runId);
    await Promise.race([
        logStream.ready,
        new Promise((resolve) => setTimeout(() => resolve(false), 1200))
    ]);

    const res = await fetch('/api/scripts/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            runId,
            scripts,
            targets: state.loadedTargets,
            force: forceScriptToggleEl.checked,
            continueOnError: true
        })
    });

    const payload = await res.json();

    await Promise.race([
        logStream.done,
        new Promise((resolve) => setTimeout(resolve, 1200))
    ]);
    logStream.close();

    const lines = [];
    if (payload.summary) {
        lines.push(`summary: total=${payload.summary.total} ok=${payload.summary.success} failed=${payload.summary.failed}`);
    }

    (payload.results || []).forEach((r) => {
        const targetLabel = r.inputPath || '(none)';
        const stateLabel = r.skipped ? 'SKIPPED' : (r.ok ? 'OK' : 'FAILED');
        lines.push(`${r.script} | ${targetLabel} | ${stateLabel} | ${r.durationMs}ms`);
        if (r.outputPath) {
            lines.push(`-> ${r.outputPath}`);
        }
        if (r.stderr && r.stderr.trim()) {
            lines.push(r.stderr.trim());
        }
    });

    if (!scriptOutputEl.textContent || scriptOutputEl.textContent.trim() === 'Execution scripts en cours...') {
        scriptOutputEl.textContent = lines.join('\n') || JSON.stringify(payload, null, 2);
    } else {
        appendScriptOutput('--- final ---');
        lines.forEach((line) => appendScriptOutput(line));
    }

    if (state.selectedDays.length > 0) {
        await loadSelectedDays();
    }
}

document.getElementById('selectAllDaysBtn').onclick = () => {
    dayListEl.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.checked = true;
    });
};

document.getElementById('clearDaysBtn').onclick = () => {
    dayListEl.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.checked = false;
    });
};

document.getElementById('loadDaysBtn').onclick = () => {
    loadSelectedDays().catch((err) => {
        console.error(err);
        graphsEl.innerHTML = '<div class="small error">Impossible de charger les jours.</div>';
    });
};

document.getElementById('refreshAssetsBtn').onclick = () => {
    if (state.selectedDays.length > 0) {
        loadSelectedDays().catch(console.error);
    }
};

document.getElementById('runScriptsBtn').onclick = () => {
    runScriptsOnLoadedTargets().catch((err) => {
        console.error(err);
        scriptOutputEl.textContent = 'Erreur execution scripts.';
    });
};

document.getElementById('invertBtn').onclick = () => {
    pyToggleEl.checked = !pyToggleEl.checked;
    silToggleEl.checked = !silToggleEl.checked;
    state.segmentCards.forEach((card) => drawSegmentCard(card));
};

pyToggleEl.onchange = () => {
    saveOverlayPrefs();
    state.segmentCards.forEach((card) => drawSegmentCard(card));
};

silToggleEl.onchange = () => {
    saveOverlayPrefs();
    state.segmentCards.forEach((card) => drawSegmentCard(card));
};

waveToggleEl.onchange = () => {
    saveOverlayPrefs();
    state.segmentCards.forEach((card) => applyLayerVisibility(card));
};

spectroToggleEl.onchange = () => {
    saveOverlayPrefs();
    state.segmentCards.forEach((card) => applyLayerVisibility(card));
};

forceScriptToggleEl.onchange = () => {
    const checks = Array.from(document.querySelectorAll('.script-check'));
    if (forceScriptToggleEl.checked) {
        checks.forEach((el) => {
            el.checked = false;
        });
    } else {
        checks.forEach((el) => {
            el.checked = true;
        });
    }
};

window.addEventListener('resize', () => {
    state.segmentCards.forEach((card) => {
        if (!card.initialized) return;
        resizeCanvas(card);
        drawSegmentCard(card);
        ensureLaneHeight(card.laneEl);
    });
});

document.getElementById('zoomInBtn').onclick = () => setZoom(state.zoom * 1.1);
document.getElementById('zoomOutBtn').onclick = () => setZoom(state.zoom / 1.1);
document.getElementById('zoomResetBtn').onclick = () => setZoom(1);

loadDayList().catch((err) => {
    console.error(err);
    dayListEl.innerHTML = '<li>Erreur lors du chargement des jours.</li>';
});

restoreOverlayPrefs();
applyZoom();
