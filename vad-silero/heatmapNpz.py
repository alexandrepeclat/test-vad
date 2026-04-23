# =========================================================
# VAD HEATMAP GENERATION (SILERO)
#
# .venv\Scripts\activate
# python heatmapNpz.py test.mp3
# python heatmapNpz.py test.mp3 --no-plot
# =========================================================

import argparse
import os 
import torch
import numpy as np
import matplotlib.pyplot as plt
import subprocess
import sys
from pathlib import Path
from scipy.ndimage import gaussian_filter1d

# =========================================================
# LOAD AUDIO VIA FFMPEG (robuste)
# =========================================================
def load_audio(path, sr=16000):
    cmd = [
        "ffmpeg",
        "-y",
        "-i", path,
        "-ac", "1",
        "-ar", str(sr),
        "-f", "f32le",
        "-"
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode())

    audio = np.frombuffer(result.stdout, np.float32)
    return audio, sr

# =========================================================
# SILERO VAD LOAD
# =========================================================
model, utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    trust_repo=True
)

(get_speech_timestamps, _, _, _, _) = utils

# =========================================================
# INPUT FILE
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

print("Loading audio...")
wav, sr = load_audio(audio_path)

wav = torch.tensor(wav)

# =========================================================
# VAD
# =========================================================
print("Running VAD...")
speech = get_speech_timestamps(wav, model, sampling_rate=sr)

# =========================================================
# BUILD HEATMAP (Silero)
# =========================================================
duration = len(wav) / sr
t = np.linspace(0, duration, 2000)
heat = np.zeros_like(t)

for seg in speech:
    start = seg["start"] / sr
    end = seg["end"] / sr
    heat[(t >= start) & (t <= end)] = 1.0

heat = gaussian_filter1d(heat, sigma=2)

# =========================================================
# EXPORT
# =========================================================
out_file = DATA_DIR / f"{audio_path.stem}_silero.npz"
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

plt.title("Speech Activity (Silero VAD)")
plt.xlabel("Time (minutes)")
plt.ylabel("Speech activity (0–1)")
plt.ylim(0, 1.05)
plt.xlim(0, t_min.max())
plt.xticks(np.arange(0, t_min.max() + 0.1, 15))

if not args.no_plot:
    plt.show()
