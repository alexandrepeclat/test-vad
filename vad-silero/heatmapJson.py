# =========================================================
# SILERO VAD → CONTINUOUS SIGNAL EXPORT (JSON)
#
# Usage:
#   python heatmapJson.py test.mp3
#   python heatmapJson.py test.mp3 --no-plot
# =========================================================

import argparse
import torch
import numpy as np
import matplotlib.pyplot as plt
import subprocess
import json
from pathlib import Path
from scipy.ndimage import gaussian_filter1d

# =========================================================
# AUDIO LOADING (FFMPEG → mono float32)
# =========================================================
def load_audio(path, sr=16000):
    cmd = [
        "ffmpeg", "-y",
        "-i", str(path),
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
# SILERO MODEL
# =========================================================
model, utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    trust_repo=True
)

(get_speech_timestamps, _, _, _, _) = utils


# =========================================================
# CLI
# =========================================================
BASE_DIR = Path.cwd()
DATA_DIR = BASE_DIR / "data"

if not DATA_DIR.exists():
    raise RuntimeError("Run script from project root (must contain /data)")

parser = argparse.ArgumentParser()
parser.add_argument("audio_name", help="Audio file in ./data")
parser.add_argument("--no-plot", action="store_true")
args = parser.parse_args()

audio_path = DATA_DIR / args.audio_name

if not audio_path.exists():
    raise FileNotFoundError(f"Audio not found: {audio_path}")


# =========================================================
# LOAD AUDIO
# =========================================================
print("Loading audio...")
wav, sr = load_audio(audio_path)
wav = torch.tensor(wav)


# =========================================================
# VAD (SEGMENTS FROM MODEL)
# =========================================================
print("Running VAD...")
speech = get_speech_timestamps(wav, model, sampling_rate=sr)


# =========================================================
# SIGNAL GENERATION (ARANGE GRID)
# =========================================================
duration = len(wav) / sr
step = 0.1  # 100ms resolution (UI-friendly)

t = np.arange(0, duration, step)
p = np.zeros_like(t)

# projection segments → signal
for seg in speech:
    start = seg["start"] / sr
    end = seg["end"] / sr
    p[(t >= start) & (t <= end)] = 1.0


# smoothing for nicer visualization
p = gaussian_filter1d(p, sigma=2)


# =========================================================
# EXPORT JSON (WAVESURFER READY)
# =========================================================
out_file = DATA_DIR / f"{audio_path.stem}_silero.json"

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
# PLOT (OPTIONAL DEBUG)
# =========================================================
if not args.no_plot:
    t_min = t / 60

    plt.figure(figsize=(12, 4))
    plt.plot(t_min, p)

    plt.title("Silero VAD - Speech Activity")
    plt.xlabel("Time (minutes)")
    plt.ylabel("Speech probability (0–1)")
    plt.ylim(0, 1.05)

    plt.show()