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
});

// temps courant
wavesurfer.on('audioprocess', () => {
    const current = wavesurfer.getCurrentTime();
    const duration = wavesurfer.getDuration();
    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
});



let currentFile = null;

// -------------------------
// FILE LIST
// -------------------------
async function loadFileList() {
    const res = await fetch('/data/');
    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const files = [...doc.querySelectorAll('a')]
        .map(a => a.href)
        .filter(h => h.endsWith('.mp3'));

    const list = document.getElementById('fileList');

    files.forEach(f => {
        const name = f.split('/').pop();

        const li = document.createElement('li');
        li.textContent = name;

        li.onclick = () => loadFile(name);

        list.appendChild(li);
    });
}

// -------------------------
// LOAD DATA
// -------------------------
async function loadFile(file) {
    currentFile = file;
    const base = file.replace('.mp3', '');

    const audio = `/data/${file}`;
    const pyUrl = `/data/${base}_pyannote.json`;
    const silUrl = `/data/${base}_silero.json`;

    const [py, sil] = await Promise.all([
        fetch(pyUrl).then(r => r.json()),
        fetch(silUrl).then(r => r.json())
    ]);

    data.py = py;
    data.sil = sil;
    draw();

    wavesurfer.load(audio);

    wavesurfer.on('ready', () => {
        resizeCanvas();
        draw();
    });
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
    if (!data.py || !data.sil) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

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