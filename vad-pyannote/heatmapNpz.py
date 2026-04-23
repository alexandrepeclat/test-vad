# =========================================================
# VAD HEATMAP GENERATION (PYANNOTE)
#
# .venv\Scripts\activate
# python heatmapNpz.py test.mp3
# python heatmapNpz.py test.mp3 --no-plot
# =========================================================

import argparse
import os
import sys
from pathlib import Path
os.environ["PYANNOTE_NO_TORCHCODEC"] = "1"
os.environ["SPEECHBRAIN_K2"] = "0"

import subprocess
import numpy as np
import torch
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d
from pyannote.audio import Pipeline

# =========================================================
# ARGUMENT AUDIO
# =========================================================
BASE_DIR = Path.cwd()
DATA_DIR = BASE_DIR / "data"
if not (BASE_DIR / "data").exists():
    raise RuntimeError("Run this script from project root (folder containing /data)")

parser = argparse.ArgumentParser()
parser.add_argument("audio_name", help="Audio file name located in ./data")
parser.add_argument(
    "--no-plot",
    action="store_true",
    help="Export the heatmap without opening a matplotlib window",
)
args = parser.parse_args()

audio_name = args.audio_name
audio_path = DATA_DIR / audio_name

if not audio_path.exists():
    raise FileNotFoundError(f"Audio not found: {audio_path}")

# =========================================================
# HF TOKEN
# =========================================================
HF_TOKEN = os.getenv("HF_TOKEN")
if HF_TOKEN is None:
    raise ValueError("HF_TOKEN not set. Use: $env:HF_TOKEN='xxx'")

# =========================================================
# LOAD AUDIO VIA FFMPEG (ROBUST + WINDOWS SAFE)
# =========================================================
def load_audio_ffmpeg(path, sr=16000):
    cmd = [
        "ffmpeg",
        "-i", path,
        "-ac", "1",
        "-ar", str(sr),
        "-f", "f32le",
        "-"
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
    audio = np.frombuffer(result.stdout, np.float32)

    return audio, sr

print("Loading audio via FFmpeg...")
audio, sr = load_audio_ffmpeg(audio_path)

audio_tensor = torch.tensor(audio).unsqueeze(0)

# =========================================================
# LOAD PYANNOTE MODEL (NEW API)
# =========================================================
print("Loading VAD model...")
pipeline = Pipeline.from_pretrained(
    "pyannote/voice-activity-detection",
    use_auth_token=HF_TOKEN
)

# =========================================================
# RUN VAD (IN-MEMORY AUDIO → avoids decoder issues)
# =========================================================
print("Running VAD...")
vad_result = pipeline({
    "waveform": audio_tensor,
    "sample_rate": sr
})

segments = vad_result.get_timeline()

# =========================================================
# BUILD HEATMAP (pyannote)
# =========================================================
duration = len(audio) / sr
t = np.linspace(0, duration, 2000)
heat = np.zeros_like(t)

for segment in segments:
    start = segment.start
    end = segment.end
    heat[(t >= start) & (t <= end)] = 1.0

heat = gaussian_filter1d(heat, sigma=2)

# =========================================================
# EXPORT
# =========================================================
out_file = DATA_DIR / f"{audio_path.stem}_pyannote.npz"
np.savez(
    out_file,
    t=t,
    heat=heat
)

# =========================================================
# PLOT
# =========================================================
t_min = t / 60
plt.figure(figsize=(12, 4))
plt.plot(t_min, heat)

plt.title("Speech Activity (pyannote VAD)")
plt.xlabel("Time (minutes)")
plt.ylabel("Speech activity (0–1)")
plt.ylim(0, 1.05)
plt.xlim(0, t_min.max())
plt.xticks(np.arange(0, t_min.max() + 0.1, 15))

if not args.no_plot:
    plt.show()