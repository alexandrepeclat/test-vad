import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js'
import Spectrogram from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/spectrogram.esm.js'
import Timeline from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/timeline.esm.js'

const wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#999',
    progressColor: '#333',
    height: 120,
    // minPxPerSec: 10,
    partialRender: true,

    plugins: [
        Spectrogram.create({
            container: '#spectrogram',
            labels: true,
            height: 150,
            fftSamples: 1024
        }),
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

    draw(); // clear curves while loading new file
    Promise.all([
        fetch(pyUrl).then(r => r.json()),
        fetch(silUrl).then(r => r.json())
    ]).then(([py, sil]) => {
        data.py = py;
        data.sil = sil;
        draw();
    });

    wavesurfer.load(audio);
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
// DRAW CURVES
// -------------------------
function drawCurve(t, p, color) {
    if (!t) return;

    ctx.strokeStyle = color;
    ctx.beginPath();

    const maxT = t[t.length - 1];

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