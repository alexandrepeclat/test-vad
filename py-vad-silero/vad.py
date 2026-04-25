# =========================================================
# SILERO VAD → CONTINUOUS SIGNAL EXPORT (JSON)
#
# Usage:
#   python heatmapJson.py path/to/audio.wav
#   python heatmapJson.py path/to/audio.mp3 --plot
# =========================================================

import os
import warnings
import logging
warnings.filterwarnings("ignore")
logging.getLogger("torch").setLevel(logging.ERROR)
logging.getLogger("torchaudio").setLevel(logging.ERROR)
logging.getLogger("urllib3").setLevel(logging.ERROR)
logging.getLogger("pytorch_lightning").setLevel(logging.ERROR)
os.environ["PYTHONWARNINGS"] = "ignore"
os.environ["TORCH_SHOW_CPP_STACKTRACES"] = "0"
os.environ["LIGHTNING_LOG_LEVEL"] = "ERROR"

from py_common.audio import load_audio
import argparse
import torch
import numpy as np
import matplotlib.pyplot as plt
import subprocess
import json
from pathlib import Path
from scipy.ndimage import gaussian_filter1d

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
parser = argparse.ArgumentParser()
parser.add_argument("audio_path", help="Path to audio file (wav/mp3)")
parser.add_argument("--plot", action="store_true", help="Show debug plot")
args = parser.parse_args()

audio_path = Path(args.audio_path)

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

for seg in speech:
    start = seg["start"] / sr
    end = seg["end"] / sr
    p[(t >= start) & (t <= end)] = 1.0

p = gaussian_filter1d(p, sigma=2)


# =========================================================
# EXPORT JSON (NEXT TO INPUT FILE)
# =========================================================
out_file = audio_path.with_name(f"{audio_path.stem}_silero.json")

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
if args.plot:
    t_min = t / 60

    plt.figure(figsize=(12, 4))
    plt.plot(t_min, p)

    plt.title("Silero VAD - Speech Activity")
    plt.xlabel("Time (minutes)")
    plt.ylabel("Speech probability (0–1)")
    plt.ylim(0, 1.05)

    plt.show()