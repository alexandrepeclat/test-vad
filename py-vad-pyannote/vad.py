# =========================================================
# PYANNOTE VAD → CONTINUOUS SIGNAL EXPORT (JSON)
#
# Usage:
#   python heatmap.py path/to/audio.mp3
#   python heatmap.py path/to/audio.wav --plot
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
# HF TOKEN
# =========================================================
HF_TOKEN = os.getenv("HF_TOKEN")
if HF_TOKEN is None:
    raise ValueError("HF_TOKEN not set")


# =========================================================
# AUDIO LOADING (FFMPEG)
# =========================================================
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
# SIGNAL GENERATION
# =========================================================
duration = len(audio) / sr
step = 0.1

t = np.arange(0, duration, step)
p = np.zeros_like(t)

for seg in segments:
    p[(t >= seg.start) & (t <= seg.end)] = 1.0

p = gaussian_filter1d(p, sigma=2)


# =========================================================
# EXPORT JSON (NEXT TO INPUT FILE)
# =========================================================
out_file = audio_path.with_name(f"{audio_path.stem}_pyannote.json")

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
# PLOT (OPTIONAL)
# =========================================================
if args.plot:
    t_min = t / 60

    plt.figure(figsize=(12, 4))
    plt.plot(t_min, p)

    plt.title("Pyannote VAD - Speech Activity")
    plt.xlabel("Time (minutes)")
    plt.ylabel("Speech activity (0–1)")
    plt.ylim(0, 1.05)

    plt.show()