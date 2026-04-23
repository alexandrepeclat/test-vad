# =========================================================
# PYANNOTE VAD → CONTINUOUS SIGNAL EXPORT (JSON)
#
# .venv\Scripts\activate
# python heatmap.py test.mp3
# python heatmap.py test.mp3 --no-plot
# =========================================================

import argparse
import os
import subprocess
import json
from pathlib import Path

import numpy as np
import torch
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d
from pyannote.audio import Pipeline

# =========================================================
# ENV (important for stability on Windows)
# =========================================================
os.environ["PYANNOTE_NO_TORCHCODEC"] = "1"
os.environ["SPEECHBRAIN_K2"] = "0"

# =========================================================
# PATHS
# =========================================================
BASE_DIR = Path.cwd()
DATA_DIR = BASE_DIR / "data"

if not DATA_DIR.exists():
    raise RuntimeError("Run from project root (must contain /data)")

parser = argparse.ArgumentParser()
parser.add_argument("audio_name", help="Audio file in ./data")
parser.add_argument("--no-plot", action="store_true")
args = parser.parse_args()

audio_path = DATA_DIR / args.audio_name

if not audio_path.exists():
    raise FileNotFoundError(f"Audio not found: {audio_path}")

# =========================================================
# HF TOKEN
# =========================================================
HF_TOKEN = os.getenv("HF_TOKEN")
if HF_TOKEN is None:
    raise ValueError("HF_TOKEN not set")

# =========================================================
# AUDIO LOADING (FFMPEG)
# =========================================================
def load_audio(path, sr=16000):
    cmd = [
        "ffmpeg",
        "-i", str(path),
        "-ac", "1",
        "-ar", str(sr),
        "-f", "f32le",
        "-"
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    audio = np.frombuffer(result.stdout, np.float32)

    return audio, sr

print("Loading audio...")
audio, sr = load_audio(audio_path)

audio_tensor = torch.tensor(audio).unsqueeze(0)

# =========================================================
# LOAD PYANNOTE
# =========================================================
print("Loading pyannote VAD...")
pipeline = Pipeline.from_pretrained(
    "pyannote/voice-activity-detection",
    use_auth_token=HF_TOKEN
)

# =========================================================
# RUN VAD
# =========================================================
print("Running VAD...")
result = pipeline({
    "waveform": audio_tensor,
    "sample_rate": sr
})

segments = result.get_timeline()

# =========================================================
# SIGNAL GENERATION (same logic as Silero)
# =========================================================
duration = len(audio) / sr
step = 0.1  # keep identical resolution across both models

t = np.arange(0, duration, step)
p = np.zeros_like(t)

for seg in segments:
    start = seg.start
    end = seg.end
    p[(t >= start) & (t <= end)] = 1.0

# smoothing (UI-friendly curve)
p = gaussian_filter1d(p, sigma=2)

# =========================================================
# EXPORT JSON (UNIFIED FORMAT)
# =========================================================
out_file = DATA_DIR / f"{audio_path.stem}_pyannote.json"

data = {
    "audio": audio_path.name,
    "sample_rate": sr,
    "step": step,
    "t": t.tolist(),
    "p": p.tolist()
}

with open(out_file, "w", encoding="utf-8") as f:
    json.dump(data, f)

print(f"Saved: {out_file}")

# =========================================================
# DEBUG PLOT
# =========================================================
if not args.no_plot:
    t_min = t / 60

    plt.figure(figsize=(12, 4))
    plt.plot(t_min, p)

    plt.title("Pyannote VAD - Speech Activity")
    plt.xlabel("Time (minutes)")
    plt.ylabel("Speech activity (0–1)")
    plt.ylim(0, 1.05)

    plt.show()