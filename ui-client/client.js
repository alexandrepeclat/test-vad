import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';

const state = {
    selectedDays: [],
    loadedTargets: [],
    scriptFiles: [],
    scriptActionQueue: [],
    scriptQueueRunning: false,
    activeBackendRunId: null,
    pendingTagIds: new Set(),
    runningTagIds: new Set(),
    currentLogStream: null,
    scriptStateStream: null,
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
const scriptFileListEl = document.getElementById('scriptFileList');
const scriptQueueInfoEl = document.getElementById('scriptQueueInfo');

const BASE_TIMELINE_WIDTH = 1400;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const OVERLAY_PREFS_KEY = 'vadViewer.overlayPrefs.v1';
const SCRIPT_QUEUE_STATE_KEY = 'vadViewer.scriptQueue.v1';
const SCRIPT_TAGS = [
    { key: 'wav', label: 'wav' },
    { key: 'mp3', label: 'mp3', script: 'run-wavtomp3.ps1' },
    { key: 'metadata', label: 'meta', script: 'run-meta-json.ps1' },
    { key: 'pyannote', label: 'vadp', script: 'run-vad-pyannote.ps1' },
    { key: 'silero', label: 'vads', script: 'run-vad-silero.ps1' },
    { key: 'spectrogram', label: 'spectro', script: 'run-build-spectrogram.ps1' },
    { key: 'peaks', label: 'peaks', script: 'run-build-peaks.ps1' }
];

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

function parseIsoDay(dayIso) {
    const m = String(dayIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
    return new Date(Date.UTC(y, mo - 1, d));
}

function toIsoDay(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addDaysIso(dayIso, dayDelta) {
    const base = parseIsoDay(dayIso);
    if (!base) return '';
    base.setUTCDate(base.getUTCDate() + dayDelta);
    return toIsoDay(base);
}

function formatIsoDayShort(dayIso) {
    const m = String(dayIso || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!m) return String(dayIso || '');
    return `${m[2]}.${m[1]}`;
}

function getWeekStartIso(dayIso) {
    const d = parseIsoDay(dayIso);
    if (!d) return '';
    const dow = d.getUTCDay();
    const mondayOffset = (dow + 6) % 7;
    d.setUTCDate(d.getUTCDate() - mondayOffset);
    return toIsoDay(d);
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

function normalizeQueueEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const fileKey = typeof entry.fileKey === 'string' ? entry.fileKey.trim() : '';
    const tagKey = typeof entry.tagKey === 'string' ? entry.tagKey.trim() : '';
    if (!fileKey || !tagKey) return null;
    return { fileKey, tagKey };
}

function persistScriptQueueState() {
    try {
        const entries = (state.scriptActionQueue || [])
            .map((entry) => normalizeQueueEntry(entry))
            .filter(Boolean);
        localStorage.setItem(SCRIPT_QUEUE_STATE_KEY, JSON.stringify(entries));
    } catch {
        // Ignore localStorage write failures.
    }
}

function restoreScriptQueueState() {
    try {
        const raw = localStorage.getItem(SCRIPT_QUEUE_STATE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const restored = parsed
            .map((entry) => normalizeQueueEntry(entry))
            .filter(Boolean);

        state.scriptActionQueue = restored;
        state.pendingTagIds.clear();
        restored.forEach((entry) => {
            const tagId = getQueueEntryTagId(entry);
            if (tagId) {
                state.pendingTagIds.add(tagId);
            }
        });

        updateScriptQueueInfo();
        renderScriptFileList(state.scriptFiles || []);
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

    const uniqueDays = Array.from(new Set((Array.isArray(days) ? days : [])
        .map((day) => String(day || '').trim())
        .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    )).sort((a, b) => a.localeCompare(b, 'en'));

    const byWeek = new Map();
    uniqueDays.forEach((day) => {
        const weekStart = getWeekStartIso(day);
        if (!weekStart) return;
        if (!byWeek.has(weekStart)) {
            byWeek.set(weekStart, new Set());
        }
        byWeek.get(weekStart).add(day);
    });

    Array.from(byWeek.keys()).sort((a, b) => a.localeCompare(b, 'en')).forEach((weekStart) => {
        const weekDays = byWeek.get(weekStart) || new Set();

        const weekRow = document.createElement('li');
        weekRow.className = 'day-week-row';

        const weekGrid = document.createElement('ul');
        weekGrid.className = 'day-week-grid';

        for (let i = 0; i < 7; i += 1) {
            const dayIso = addDaysIso(weekStart, i);
            const cell = document.createElement('li');
            cell.className = 'day-week-cell';

            if (!dayIso || !weekDays.has(dayIso)) {
                cell.classList.add('is-empty');
                weekGrid.appendChild(cell);
                continue;
            }

            const weekday = getWeekdayFr(dayIso);
            const shortWeekday = weekday ? weekday.slice(0, 3) : '--';
            const label = document.createElement('label');
            label.title = dayIso;

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = dayIso;
            input.checked = true;

            const span = document.createElement('span');
            span.textContent = `${formatIsoDayShort(dayIso)} ${shortWeekday}`;

            label.appendChild(input);
            label.appendChild(span);
            cell.appendChild(label);
            weekGrid.appendChild(cell);
        }

        weekRow.appendChild(weekGrid);
        dayListEl.appendChild(weekRow);
    });

    graphsEl.innerHTML = '<div class="small">Tous les jours sont précochés. Clique sur "Charger les jours" pour afficher les fichiers.</div>';
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

function updateScriptQueueInfo() {
    const pending = state.scriptActionQueue.length;
    const running = state.runningTagIds.size > 0 || !!state.activeBackendRunId;
    if (!scriptQueueInfoEl) return;
    scriptQueueInfoEl.textContent = running
        ? `Queue: ${pending} en attente | run en cours`
        : `Queue: ${pending} en attente`;
}

function getScriptFileName(detail) {
    const fullName = detail.displayFile || detail.audioFile || detail.processingFile || detail.baseName || '';
    const fileName = String(fullName).split('/').pop();
    return fileName || 'Fichier inconnu';
}

function getScriptTarget(detail, tagKey) {
    if (tagKey === 'mp3') {
        return detail.exists.wav ? detail.wavFile : null;
    }

    if (tagKey === 'wav') {
        return null;
    }

    return detail.processingFile || detail.audioFile || null;
}

function getScriptTagState(detail, tagDef) {
    const present = !!detail?.exists?.[tagDef.key];
    const target = getScriptTarget(detail, tagDef.key) || null;
    const fileKey = getScriptKey(detail);
    const tagId = getTagId(fileKey, tagDef.key);

    if (state.runningTagIds.has(tagId)) {
        return {
            status: 'processing',
            present,
            clickable: false,
            target,
            force: present,
            tagId
        };
    }

    if (state.pendingTagIds.has(tagId)) {
        return {
            status: 'queued',
            present,
            clickable: false,
            target,
            force: present,
            tagId
        };
    }

    if (tagDef.key === 'wav') {
        return {
            status: present ? 'available' : 'missing',
            present,
            clickable: false,
            target: null,
            force: false,
            tagId
        };
    }

    if (tagDef.key === 'mp3' && !detail?.exists?.wav) {
        return {
            status: 'available',
            present,
            clickable: false,
            target: null,
            force: false,
            tagId
        };
    }

    return {
        status: present ? 'available' : 'missing',
        present,
        clickable: !!tagDef.script && !!target,
        target,
        force: present,
        tagId
    };
}

function getRunnableTaskSpec(detail, tagDef) {
    if (!detail || !tagDef?.script || tagDef.key === 'wav') {
        return null;
    }

    const present = !!detail?.exists?.[tagDef.key];
    const target = getScriptTarget(detail, tagDef.key) || null;
    if (!target) {
        return null;
    }

    return {
        script: tagDef.script,
        target,
        force: present,
        startMessage: `${tagDef.label} | ${getScriptFileName(detail)}`
    };
}

function getTagKeyForScript(scriptName) {
    const def = SCRIPT_TAGS.find((tag) => tag.script === scriptName);
    return def?.key || null;
}

function getTagId(fileKey, tagKey) {
    if (!fileKey || !tagKey) return null;
    return `${fileKey}::${tagKey}`;
}

function getDetailByInputPath(inputPath) {
    if (!inputPath) return null;
    return (state.scriptFiles || []).find((detail) => (
        detail.processingFile === inputPath
        || detail.audioFile === inputPath
        || detail.wavFile === inputPath
        || detail.mp3File === inputPath
    )) || null;
}

function resolveTagIdFromTask(scriptName, inputPath) {
    const tagKey = getTagKeyForScript(scriptName);
    if (!tagKey) return null;

    const detail = getDetailByInputPath(inputPath);
    if (!detail) {
        const stem = String(inputPath || '').replace(/\.(mp3|wav)$/i, '');
        return getTagId(stem, tagKey);
    }

    return getTagId(getScriptKey(detail), tagKey);
}

function getScriptKey(detail) {
    const candidate = detail.processingFile || detail.audioFile || detail.displayFile || detail.baseName || '';
    return String(candidate).replace(/\.(mp3|wav)$/i, '');
}

function findScriptFileByKey(fileKey) {
    return (state.scriptFiles || []).find((detail) => getScriptKey(detail) === fileKey) || null;
}

function getTagDefByKey(tagKey) {
    return SCRIPT_TAGS.find((tag) => tag.key === tagKey) || null;
}

function createQueueEntry(fileKey, tagKey) {
    if (!fileKey || !tagKey) return null;
    return { fileKey, tagKey };
}

function getQueueEntryTagId(entry) {
    if (!entry) return null;
    return getTagId(entry.fileKey, entry.tagKey);
}

function queueEntryFromBackendTask(task) {
    const script = typeof task?.script === 'string' ? task.script : '';
    const target = typeof task?.target === 'string' ? task.target : '';
    const tagKey = getTagKeyForScript(script);
    const fileKey = String(target).replace(/\.(mp3|wav)$/i, '');
    if (!tagKey || !fileKey) return null;
    return { fileKey, tagKey };
}

function normalizeBackendQueueEntry(entry) {
    const fileKey = typeof entry?.fileKey === 'string' ? entry.fileKey.trim() : '';
    const tagKey = typeof entry?.tagKey === 'string' ? entry.tagKey.trim() : '';
    if (!fileKey || !tagKey) return null;
    return { fileKey, tagKey };
}

function syncQueueFromBackendRun(run) {
    const pendingEntries = Array.isArray(run?.pendingEntries) ? run.pendingEntries : [];
    const pendingTasks = Array.isArray(run?.pendingTasks) ? run.pendingTasks : [];
    const sourceEntries = pendingEntries.length > 0
        ? pendingEntries.map((entry) => normalizeBackendQueueEntry(entry)).filter(Boolean)
        : pendingTasks.map((task) => queueEntryFromBackendTask(task)).filter(Boolean);
    const nextEntries = [];
    const nextTagIds = new Set();

    sourceEntries.forEach((entry) => {
        const tagId = getQueueEntryTagId(entry);
        if (!tagId || nextTagIds.has(tagId)) return;
        nextTagIds.add(tagId);
        nextEntries.push(entry);
    });

    state.scriptActionQueue = nextEntries;
    state.pendingTagIds = nextTagIds;
    persistScriptQueueState();
    updateScriptQueueInfo();
    renderScriptFileList(state.scriptFiles || []);
}

function buildTaskFromQueueEntry(entry) {
    const tagDef = getTagDefByKey(entry?.tagKey);
    if (!tagDef?.script) {
        return null;
    }

    const detail = findScriptFileByKey(entry.fileKey);
    if (!detail) {
        return null;
    }

    return getRunnableTaskSpec(detail, tagDef);
}

function setRunningTagByTask(scriptName, inputPath) {
    const tagId = resolveTagIdFromTask(scriptName, inputPath);
    if (tagId) {
        state.pendingTagIds.delete(tagId);
        state.runningTagIds.add(tagId);
    }
    updateScriptQueueInfo();
    renderScriptFileList(state.scriptFiles || []);
}

function resetRunningScripts() {
    state.runningTagIds.clear();
    updateScriptQueueInfo();
    renderScriptFileList(state.scriptFiles || []);
}

function setOnlyRunningTask(currentTask) {
    state.runningTagIds.clear();
    if (currentTask) {
        const tagId = resolveTagIdFromTask(currentTask.script, currentTask.inputPath);
        if (tagId) {
            state.runningTagIds.add(tagId);
        }
    }
    updateScriptQueueInfo();
    renderScriptFileList(state.scriptFiles || []);
}

function setOnlyRunningEntry(currentEntry) {
    state.runningTagIds.clear();
    const normalized = normalizeBackendQueueEntry(currentEntry);
    if (normalized) {
        const tagId = getQueueEntryTagId(normalized);
        if (tagId) {
            state.runningTagIds.add(tagId);
        }
    }
    updateScriptQueueInfo();
    renderScriptFileList(state.scriptFiles || []);
}

function applyScriptLogEntry(entry) {
    if (!entry || typeof entry !== 'object') return;

    if (entry.type === 'run-start') {
        state.activeBackendRunId = entry.runId || state.activeBackendRunId;
        updateScriptQueueInfo();
        return;
    }

    if (entry.type === 'task-start') {
        setRunningTagByTask(entry.script, entry.inputPath);
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
        const endedTagId = resolveTagIdFromTask(entry.script, entry.inputPath);
        if (endedTagId) {
            state.runningTagIds.delete(endedTagId);
            updateScriptQueueInfo();
            // Don't render with stale scriptFiles here — refreshAfterScriptRun will
            // fetch fresh data and render, avoiding a false orange (missing) flash.
        }
        const label = entry.ok ? 'OK' : 'FAILED';
        appendScriptOutput(`< ${entry.script} | ${label} | ${entry.durationMs}ms`);
        refreshAfterScriptRun().catch(() => {
            // On fetch error, still re-render with whatever state we have.
            renderScriptFileList(state.scriptFiles || []);
        });
        return;
    }

    if (entry.type === 'run-end') {
        state.activeBackendRunId = null;
        resetRunningScripts();
        updateScriptQueueInfo();
        if (entry.summary) {
            appendScriptOutput(`summary: total=${entry.summary.total} ok=${entry.summary.success} failed=${entry.summary.failed}`);
        }
        refreshAfterScriptRun().catch(() => {
            // Best effort refresh after the run completes.
        });
    }

    if (entry.type === 'control') {
        appendScriptOutput(`control: ${entry.action}`);
    }
}

function applyBackendStateSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (!payload.hasActiveRun || !payload.activeRunId) {
        state.activeBackendRunId = null;
        resetRunningScripts();
        state.scriptActionQueue = [];
        state.pendingTagIds.clear();
        persistScriptQueueState();
        updateScriptQueueInfo();
        renderScriptFileList(state.scriptFiles || []);
        return;
    }

    state.activeBackendRunId = payload.activeRunId;
    syncQueueFromBackendRun(payload.run || null);
    if (payload.run?.currentEntry) {
        setOnlyRunningEntry(payload.run.currentEntry);
    } else {
        setOnlyRunningTask(payload.run?.currentTask || null);
    }
    updateScriptQueueInfo();
}

function connectScriptStateStream() {
    if (!window.EventSource || state.scriptStateStream) {
        return;
    }

    const es = new EventSource('/api/scripts/stream');
    state.scriptStateStream = es;

    es.addEventListener('snapshot', (event) => {
        try {
            const payload = JSON.parse(event.data || '{}');
            applyBackendStateSnapshot(payload);
        } catch {
            // Ignore malformed snapshot payloads.
        }
    });

    es.addEventListener('state', (event) => {
        try {
            const entry = JSON.parse(event.data || '{}');
            const isCurrentRunLogEntry = state.currentLogStream && entry?.runId && state.currentLogStream.runId === entry.runId;
            if (isCurrentRunLogEntry) {
                if (entry?.type === 'task-end' || entry?.type === 'run-end') {
                    refreshAfterScriptRun().catch(() => {
                        renderScriptFileList(state.scriptFiles || []);
                    });
                }

                if (entry?.type === 'run-start' || entry?.type === 'task-start' || entry?.type === 'task-end' || entry?.type === 'run-end') {
                    syncBackendRunState().catch(() => {
                        // Ignore transient sync failures.
                    });
                }
                return;
            }

            applyScriptLogEntry(entry);

            if (entry?.type === 'run-start' || entry?.type === 'task-start' || entry?.type === 'task-end' || entry?.type === 'run-end') {
                syncBackendRunState().catch(() => {
                    // Ignore transient sync failures.
                });
            }
        } catch {
            // Ignore malformed state payloads.
        }
    });

    es.onerror = () => {
        // Browser EventSource handles reconnection automatically.
    };
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
        if (state.currentLogStream && state.currentLogStream.runId === runId) {
            state.currentLogStream = null;
        }
    };

    if (state.currentLogStream && typeof state.currentLogStream.close === 'function') {
        state.currentLogStream.close();
    }

    const es = new EventSource(`/api/scripts/logs?runId=${encodeURIComponent(runId)}`);
    state.currentLogStream = {
        runId,
        close: finalize
    };

    es.addEventListener('ready', () => {
        resolveReady(true);
    });

    es.addEventListener('log', (event) => {
        try {
            const entry = JSON.parse(event.data || '{}');
            applyScriptLogEntry(entry);
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
        runId,
        close: finalize
    };
}

async function runScriptTasks(tasks, { startMessage = 'Execution scripts en cours...', force = false } = {}) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        scriptOutputEl.textContent = 'Aucune tâche à lancer.';
        return null;
    }

    scriptOutputEl.textContent = startMessage;

    const runId = createRunId();
    state.activeBackendRunId = runId;
    updateScriptQueueInfo();
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
            tasks: tasks.map((task) => ({
                script: task.script,
                target: task.target,
                force: typeof task.force === 'boolean' ? task.force : force,
                fileKey: String(task.target || '').replace(/\.(mp3|wav)$/i, ''),
                tagKey: getTagKeyForScript(task.script)
            })),
            force,
            continueOnError: true
        })
    });

    const payload = await res.json();

    if (res.status === 409 && payload?.activeRunId) {
        state.activeBackendRunId = payload.activeRunId;
        const conflictErr = new Error('Un script est déjà en cours sur le backend.');
        conflictErr.code = 'ACTIVE_RUN';
        conflictErr.activeRunId = payload.activeRunId;
        throw conflictErr;
    }

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

    if (!scriptOutputEl.textContent || scriptOutputEl.textContent.trim() === startMessage) {
        scriptOutputEl.textContent = lines.join('\n') || JSON.stringify(payload, null, 2);
    } else {
        appendScriptOutput('--- final ---');
        lines.forEach((line) => appendScriptOutput(line));
    }

    if (!res.ok) {
        throw new Error(payload.error || 'Erreur execution scripts');
    }

    return payload;
}

async function appendTasksToBackendQueue(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return { ok: true, appended: 0 };
    }

    const res = await fetch('/api/scripts/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tasks: tasks.map((task) => ({
                script: task.script,
                target: task.target,
                force: !!task.force,
                fileKey: String(task.target || '').replace(/\.(mp3|wav)$/i, ''),
                tagKey: getTagKeyForScript(task.script)
            }))
        })
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(payload.error || 'Impossible d\'ajouter des tâches à la queue backend.');
        if (res.status === 409) {
            err.code = 'NO_ACTIVE_RUN';
        }
        throw err;
    }

    if (payload?.run) {
        syncQueueFromBackendRun(payload.run);
    }

    return payload;
}

async function refreshAfterScriptRun() {
    await loadScriptFileList();
    if (state.selectedDays.length > 0) {
        await loadSelectedDays();
    }
}

function enqueueTagQueueEntries(entries = []) {
    const accepted = [];

    (entries || []).forEach((entry) => {
        const tagId = getQueueEntryTagId(entry);
        if (!tagId) return;
        if (state.pendingTagIds.has(tagId) || state.runningTagIds.has(tagId)) {
            return;
        }
        accepted.push(entry);
        state.pendingTagIds.add(tagId);
    });

    if (accepted.length === 0) {
        renderScriptFileList(state.scriptFiles || []);
        return;
    }

    state.scriptActionQueue.push(...accepted);
    persistScriptQueueState();
    updateScriptQueueInfo();
    renderScriptFileList(state.scriptFiles || []);
    processScriptActionQueue().catch((err) => {
        console.error(err);
        scriptOutputEl.textContent = err.message || 'Erreur execution scripts.';
    });
}

async function processScriptActionQueue() {
    // Fast path: if the queue runner is already active but a backend run is in
    // progress, directly append any newly-queued tasks to the backend instead of
    // waiting for the runner to unblock (it blocks on the HTTP response from
    // /api/scripts/run for the duration of the entire run).
    if (state.scriptQueueRunning) {
        if (state.activeBackendRunId && state.scriptActionQueue.length > 0) {
            const toAppend = state.scriptActionQueue.splice(0);
            persistScriptQueueState();
            try {
                await loadScriptFileList();
                const tasks = toAppend
                    .map((e) => buildTaskFromQueueEntry(e))
                    .filter(Boolean)
                    .map((t) => ({ script: t.script, target: t.target, force: !!t.force }));
                if (tasks.length > 0) {
                    await appendTasksToBackendQueue(tasks);
                    // syncQueueFromBackendRun inside appendTasksToBackendQueue has
                    // already updated pendingTagIds from the backend snapshot.
                    // Do NOT clear them here or the tags will lose their color.
                }
            } catch (err) {
                console.error(err);
                state.scriptActionQueue = toAppend.concat(state.scriptActionQueue);
            } finally {
                persistScriptQueueState();
                renderScriptFileList(state.scriptFiles || []);
            }
        }
        return;
    }
    state.scriptQueueRunning = true;
    updateScriptQueueInfo();

    while (state.scriptActionQueue.length > 0) {
        const currentBatch = state.scriptActionQueue.splice(0, state.scriptActionQueue.length);
        persistScriptQueueState();
        const batchTagIds = currentBatch
            .map((entry) => getQueueEntryTagId(entry))
            .filter(Boolean);
        updateScriptQueueInfo();
        let submitted = false;
        let usedAppendPath = false;
        try {
            await loadScriptFileList();
            const tasks = currentBatch
                .map((entry) => buildTaskFromQueueEntry(entry))
                .filter(Boolean)
                .map((task) => ({
                    script: task.script,
                    target: task.target,
                    force: !!task.force
                }));

            if (tasks.length === 0) {
                submitted = true;
                continue;
            }

            if (state.activeBackendRunId) {
                await appendTasksToBackendQueue(tasks);
                usedAppendPath = true;
                // appendTasksToBackendQueue called syncQueueFromBackendRun which
                // set scriptActionQueue to the backend's pendingEntries. Clear it
                // so the while loop doesn't keep re-processing backend-owned tasks.
                state.scriptActionQueue = [];
            } else {
                await runScriptTasks(tasks, {
                    startMessage: `Execution de ${tasks.length} tâche(s)...`
                });
            }
            submitted = true;
        } catch (err) {
            if (err?.code === 'ACTIVE_RUN') {
                // Backend run exists: keep tasks and try append path on next loop.
                state.activeBackendRunId = err.activeRunId || state.activeBackendRunId;
            }
            console.error(err);
            if (err?.code !== 'ACTIVE_RUN') {
                scriptOutputEl.textContent = err.message || 'Erreur execution scripts.';
            }
            state.scriptActionQueue = currentBatch.concat(state.scriptActionQueue);
            persistScriptQueueState();
            await syncBackendRunState().catch(() => {
                // Ignore transient sync failures.
            });
            break;
        } finally {
            if (submitted && !usedAppendPath) {
                // For the append path pendingTagIds are already correctly set by
                // syncQueueFromBackendRun inside appendTasksToBackendQueue.
                // Only clean up for the new-run path.
                batchTagIds.forEach((tagId) => state.pendingTagIds.delete(tagId));
            }
            persistScriptQueueState();
            renderScriptFileList(state.scriptFiles || []);
        }
    }

    state.scriptQueueRunning = false;
    updateScriptQueueInfo();
}

function clearScriptActionQueue() {
    state.scriptActionQueue.forEach((entry) => {
        const tagId = getQueueEntryTagId(entry);
        if (tagId) {
            state.pendingTagIds.delete(tagId);
        }
    });
    state.scriptActionQueue = [];
    persistScriptQueueState();
    updateScriptQueueInfo();
    renderScriptFileList(state.scriptFiles || []);
}

async function sendScriptControl(action) {
    const res = await fetch('/api/scripts/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(payload.error || `Impossible d'envoyer ${action}`);
    }

    return payload;
}

async function syncBackendRunState() {
    const res = await fetch('/api/scripts/state');
    if (!res.ok) return;

    const payload = await res.json();
    if (!payload?.hasActiveRun || !payload?.activeRunId) {
        state.activeBackendRunId = null;
        if (!state.currentLogStream) {
            resetRunningScripts();
        }
        updateScriptQueueInfo();
        return;
    }

    state.activeBackendRunId = payload.activeRunId;
    syncQueueFromBackendRun(payload.run || null);
    updateScriptQueueInfo();

    if (payload.run?.currentEntry) {
        setOnlyRunningEntry(payload.run.currentEntry);
    } else {
        const currentTask = payload.run?.currentTask || null;
        setOnlyRunningTask(currentTask);
    }
}

async function runSingleTag(detail, tagDef) {
    const fileKey = getScriptKey(detail);
    const entry = createQueueEntry(fileKey, tagDef.key);
    enqueueTagQueueEntries([entry]);
}

function buildMissingQueueEntriesForTag(files, tagDef) {
    if (!tagDef?.script) return [];

    const entries = [];
    const seen = new Set();

    (files || []).forEach((detail) => {
        const tagState = getScriptTagState(detail, tagDef);
        if (tagState.status !== 'missing' || !tagState.clickable) {
            return;
        }

        const fileKey = getScriptKey(detail);
        const key = getTagId(fileKey, tagDef.key);
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        entries.push(createQueueEntry(fileKey, tagDef.key));
    });

    return entries;
}

function buildForceQueueEntriesForTag(files, tagDef) {
    if (!tagDef?.script) return [];

    const entries = [];
    const seen = new Set();

    (files || []).forEach((detail) => {
        const tagState = getScriptTagState(detail, tagDef);
        const taskSpec = getRunnableTaskSpec(detail, tagDef);
        if (tagState.status !== 'available' || !taskSpec) {
            return;
        }

        const fileKey = getScriptKey(detail);
        const key = getTagId(fileKey, tagDef.key);
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        entries.push(createQueueEntry(fileKey, tagDef.key));
    });

    return entries;
}

function getColumnState(files, tagDef) {
    const states = (files || []).map((detail) => getScriptTagState(detail, tagDef));
    const total = states.length;
    const availableCount = states.filter((tagState) => tagState.status === 'available').length;
    const activeCount = states.filter((tagState) => tagState.status === 'queued' || tagState.status === 'processing').length;
    return {
        total,
        availableCount,
        activeCount,
        missingCount: Math.max(0, total - availableCount),
        allPresent: total > 0 && availableCount === total,
        partiallyAvailable: availableCount > 0 && availableCount < total,
        allActive: tagDef.script && total > 0 && activeCount === total
    };
}

async function runMissingForTag(tagDef) {
    if (!tagDef?.script) return;

    await loadScriptFileList();
    const entries = buildMissingQueueEntriesForTag(state.scriptFiles || [], tagDef);
    if (entries.length === 0) {
        scriptOutputEl.textContent = `Aucune donnée manquante pour ${tagDef.label}.`;
        return;
    }

    enqueueTagQueueEntries(entries);
}

async function runForceForTag(tagDef) {
    if (!tagDef?.script) return;

    await loadScriptFileList();
    const entries = buildForceQueueEntriesForTag(state.scriptFiles || [], tagDef);
    if (entries.length === 0) {
        scriptOutputEl.textContent = `Aucun fichier disponible à régénérer pour ${tagDef.label}.`;
        return;
    }

    const confirmed = window.confirm(`Tous les fichiers ont déjà ${tagDef.label}. Relancer ${entries.length} fichier(s) avec --force ?`);
    if (!confirmed) {
        return;
    }

    enqueueTagQueueEntries(entries);
}

function buildMissingQueueEntries(files) {
    const entries = [];
    SCRIPT_TAGS.forEach((tagDef) => {
        entries.push(...buildMissingQueueEntriesForTag(files, tagDef));
    });

    return entries;
}

function renderScriptFileList(files) {
    scriptFileListEl.innerHTML = '';

    if (!Array.isArray(files) || files.length === 0) {
        scriptFileListEl.innerHTML = '<div class="small">Aucun fichier audio trouvé.</div>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'script-file-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const nameHead = document.createElement('th');
    nameHead.className = 'script-head-first';
    nameHead.textContent = 'fichier';
    headRow.appendChild(nameHead);

    SCRIPT_TAGS.forEach((tagDef) => {
        const stateByCol = getColumnState(files, tagDef);
        const th = document.createElement('th');
        th.className = 'script-file-tag-cell';

        const headTag = document.createElement('button');
        headTag.type = 'button';
        headTag.className = 'script-tag';
        headTag.textContent = tagDef.label;

        if (stateByCol.allActive) {
            headTag.classList.add('is-processing');
        } else if (stateByCol.allPresent) {
            headTag.classList.add('is-available');
        } else if (stateByCol.partiallyAvailable) {
            headTag.classList.add('is-partial');
        } else {
            headTag.classList.add('is-missing');
        }

        if (tagDef.script) {
            if (stateByCol.allActive) {
                headTag.disabled = true;
                headTag.title = `Une tâche ${tagDef.label} existe déjà pour chaque fichier.`;
            } else {
                headTag.title = stateByCol.missingCount > 0
                    ? `Lancer ${tagDef.label} sur ${stateByCol.missingCount} fichier(s) manquant(s).`
                    : `Tous les fichiers ont déjà ${tagDef.label}. Cliquer pour relancer en --force (avec confirmation).`;
                headTag.onclick = () => {
                    const action = stateByCol.allPresent ? runForceForTag(tagDef) : runMissingForTag(tagDef);
                    action.catch((err) => {
                        console.error(err);
                        scriptOutputEl.textContent = err.message || 'Erreur execution scripts.';
                    });
                };
            }
        } else {
            headTag.disabled = true;
            headTag.title = 'Le wav est informatif uniquement.';
        }

        th.appendChild(headTag);
        headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    files.forEach((detail) => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.className = 'script-file-name-cell';

        const nameEl = document.createElement('div');
        nameEl.className = 'script-file-name';
        nameEl.textContent = getScriptFileName(detail);
        nameCell.appendChild(nameEl);
        row.appendChild(nameCell);

        SCRIPT_TAGS.forEach((tagDef) => {
            const tagState = getScriptTagState(detail, tagDef);
            const tagCell = document.createElement('td');
            tagCell.className = 'script-file-tag-cell';
            const tagEl = document.createElement('button');
            tagEl.type = 'button';
            tagEl.className = 'script-tag';
            tagEl.textContent = tagDef.label;

            if (tagState.status === 'available') {
                tagEl.classList.add('is-available');
            } else if (tagState.status === 'missing') {
                tagEl.classList.add('is-missing');
            } else if (tagState.status === 'queued') {
                tagEl.classList.add('is-queued');
            } else if (tagState.status === 'processing') {
                tagEl.classList.add('is-processing');
            }

            if (tagState.clickable) {
                tagEl.classList.add('is-clickable');
                tagEl.title = tagState.present
                    ? 'Cliquer pour régénérer ce fichier avec --force.'
                    : 'Cliquer pour générer ce fichier.';
                tagEl.onclick = () => {
                    runSingleTag(detail, tagDef);
                };
            } else {
                tagEl.disabled = true;
                if (tagDef.key === 'wav') {
                    tagEl.title = 'Le wav est informatif uniquement.';
                } else if (tagDef.key === 'mp3' && !detail?.exists?.wav) {
                    tagEl.title = 'MP3 non lançable sans wav source.';
                } else if (tagState.status === 'queued') {
                    tagEl.title = 'Script en attente pour ce tag.';
                } else if (tagState.status === 'processing') {
                    tagEl.title = 'Script en cours pour ce tag.';
                }
            }

            tagCell.appendChild(tagEl);
            row.appendChild(tagCell);
        });

        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    scriptFileListEl.appendChild(table);
}

async function loadScriptFileList() {
    const res = await fetch('/api/script-files');
    if (!res.ok) {
        throw new Error('Failed to load script files');
    }

    const files = await res.json();
    state.scriptFiles = Array.isArray(files) ? files : [];
    renderScriptFileList(state.scriptFiles);
}

async function generateMissingData() {
    await loadScriptFileList();
    const entries = buildMissingQueueEntries(state.scriptFiles || []);
    if (entries.length === 0) {
        scriptOutputEl.textContent = 'Aucune donnée manquante à générer.';
        return;
    }

    enqueueTagQueueEntries(entries);
}

async function restoreActiveRunFromBackend() {
    try {
        scriptOutputEl.textContent = 'Vérification des scripts backend en cours...';
        await syncBackendRunState();
        if (state.activeBackendRunId) {
            scriptOutputEl.textContent = 'Run backend en cours, rattachement des logs...';
        } else if (state.scriptActionQueue.length > 0) {
            scriptOutputEl.textContent = `Reprise de la queue locale (${state.scriptActionQueue.length} tâche(s))...`;
            processScriptActionQueue().catch((err) => {
                console.error(err);
                scriptOutputEl.textContent = err.message || 'Erreur execution scripts.';
            });
        }
    } catch {
        // Best effort only: UI remains usable even if state restore fails.
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
    Promise.all([
        loadScriptFileList(),
        state.selectedDays.length > 0 ? loadSelectedDays() : Promise.resolve()
    ]).catch(console.error);
};

document.getElementById('generateMissingBtn').onclick = () => {
    generateMissingData();
};

document.getElementById('stopAllScriptsBtn').onclick = () => {
    clearScriptActionQueue();
    sendScriptControl('stop')
        .then(() => {
            appendScriptOutput('STOP demandé: run courant interrompu et queue vidée.');
        })
        .catch((err) => {
            scriptOutputEl.textContent = err.message || 'Impossible de stopper le run.';
        });
};

document.getElementById('skipTaskBtn').onclick = () => {
    sendScriptControl('skip')
        .then(() => {
            appendScriptOutput('SKIP demandé: tâche courante interrompue.');
        })
        .catch((err) => {
            scriptOutputEl.textContent = err.message || 'Impossible de skip la tâche courante.';
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

restoreScriptQueueState();
connectScriptStateStream();

loadScriptFileList().catch((err) => {
    console.error(err);
    scriptFileListEl.innerHTML = '<div class="small error">Impossible de charger la liste des fichiers.</div>';
});

restoreActiveRunFromBackend();

restoreOverlayPrefs();
applyZoom();
updateScriptQueueInfo();
