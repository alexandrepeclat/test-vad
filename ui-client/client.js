import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js'
import Timeline from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/timeline.esm.js'

const wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#999',
    progressColor: '#333',
    height: 120,
    fillParent: true,     // 👈 remplit toute la largeur
    minPxPerSec: 0,       // 👈 désactive le scaling basé sur durée
    interact: true,
    partialRender: true,
    backend: 'WebAudio',

    plugins: [
        Timeline.create({
            container: '#wave-timeline'
        })
    ]
});

let data = {
    py: null,
    sil: null
};

const timeDisplay = document.getElementById('timeDisplay');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// durée totale
wavesurfer.on('ready', () => {
    const duration = wavesurfer.getDuration();
    timeDisplay.textContent = `0:00 / ${formatTime(duration)}`;
    resizeCanvas();
    draw();
});

// temps courant
wavesurfer.on('timeupdate', () => {
    const current = wavesurfer.getCurrentTime();
    const duration = wavesurfer.getDuration();
    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
});

wavesurfer.on('interaction', () => {
    if (!wavesurfer.isPlaying()) {
        wavesurfer.play();
    }
});

playBtn.onclick = () => {
    wavesurfer.play();
};

pauseBtn.onclick = () => {
    wavesurfer.pause();
};

stopBtn.onclick = () => {
    wavesurfer.pause();
    wavesurfer.setTime(0);
};



let currentFile = null;

// -------------------------
// FILE LIST
// -------------------------
async function loadFileList() {
    const res = await fetch('/api/files');
    const files = await res.json();
    const list = document.getElementById('fileList');
    list.innerHTML = '';
    files.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        li.onclick = () => loadFile(f);
        list.appendChild(li);
    });
}

// -------------------------
// LOAD DATA
// -------------------------
async function loadFile(file) {
    currentFile = file;
    const base = file.replace(/\.(mp3|wav)$/, '');
    const audio = `/data/${file}`;
    const pyUrl = `/data/${base}_pyannote.json`;
    const silUrl = `/data/${base}_silero.json`;
    const spectroUrl = `/data/${base}_spectrogram.png`;
    const peaksUrl = `/data/${base}_peaks.json`;

    clear();

    // 1. VAD (pyannote + silero)
    const vadPromise = (async () => {
        const [py, sil] = await Promise.all([
            fetch(pyUrl).then(r => r.json()),
            fetch(silUrl).then(r => r.json())
        ]);
        data.py = py;
        data.sil = sil;
        draw(); // render dès que dispo
    })();

    // 2. SPECTROGRAM
    spectroImg.src = spectroUrl;

    // 3. WAVEFORM (peaks + audio)
    const wavePromise = (async () => {
        const peaksData = await fetch(peaksUrl).then(r => r.json());
        data.peaks = peaksData.peaks;
        wavesurfer.load(audio, peaksData.peaks);
    })();

    vadPromise.catch(console.error);
    wavePromise.catch(console.error);
}

// -------------------------
// CANVAS SETUP
// -------------------------
const canvas = document.getElementById('vadgraph');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    const rect = document.getElementById('waveform').getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
}

// -------------------------
// SPECTROGRAM IMAGE SETUP
// -------------------------
const spectroContainer = document.getElementById('spectrogram');

let spectroImg = document.createElement('img');
spectroImg.style.width = '100%';
spectroImg.style.height = '150px';
spectroImg.style.objectFit = 'fill';

spectroContainer.appendChild(spectroImg);

// -------------------------
// DRAW CURVES
// -------------------------
function drawCurve(t, p, color) {
    if (!t) return;

    const maxT = t[t.length - 1];

    // -------------------------
    // FILL
    // -------------------------
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(0, canvas.height);

    for (let i = 0; i < t.length; i++) {
        const x = (t[i] / maxT) * canvas.width;
        const y = canvas.height - (p[i] * canvas.height);
        ctx.lineTo(x, y);
    }

    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    // -------------------------
    // LINE
    // -------------------------
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = color;

    ctx.beginPath();

    for (let i = 0; i < t.length; i++) {
        const x = (t[i] / maxT) * canvas.width;
        const y = canvas.height - (p[i] * canvas.height);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.stroke();
}

// -------------------------
// MAIN DRAW
// -------------------------
function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data.py || !data.sil) return;

    const pyOn = document.getElementById('pyToggle').checked;
    const silOn = document.getElementById('silToggle').checked;

    if (pyOn) drawCurve(data.py.t, data.py.p, 'red');
    if (silOn) drawCurve(data.sil.t, data.sil.p, 'blue');
}

// -------------------------
// TOGGLES
// -------------------------
document.getElementById('pyToggle').onchange = draw;
document.getElementById('silToggle').onchange = draw;

// invert button
document.getElementById('invertBtn').onclick = () => {
    const py = document.getElementById('pyToggle');
    const sil = document.getElementById('silToggle');

    py.checked = !py.checked;
    sil.checked = !sil.checked;

    draw();
};

// -------------------------
// UPDATE ON RESIZE
// -------------------------
window.onresize = () => {
    resizeCanvas();
    draw();
};

// -------------------------
// INIT
// -------------------------
loadFileList();