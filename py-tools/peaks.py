from py_common.audio import load_audio
import numpy as np
from pathlib import Path
import json
import argparse

def generate_peaks(audio_path, px_per_sec=50, max_width=8000):

    audio_path = Path(audio_path)

    audio, sr = load_audio(audio_path)
    duration = len(audio) / sr

    width = int(duration * px_per_sec)
    width = min(width, max_width)

    samples_per_bin = max(1, int(len(audio) / width))

    peaks = []

    # =====================================================
    # ROBUST NORMALIZATION (IMPORTANT FIX)
    # =====================================================
    audio = audio.astype(np.float32)

    peak_ref = np.percentile(np.abs(audio), 99.5)
    audio = audio / (peak_ref + 1e-9)

    # clamp (important to avoid explosion)
    audio = np.clip(audio, -1.0, 1.0)

    # =====================================================
    # ENVELOPE (simple + stable)
    # =====================================================
    for i in range(width):
        start = i * samples_per_bin
        end = start + samples_per_bin

        segment = audio[start:end]

        if len(segment) == 0:
            peaks.append(0.0)
            continue

        # WaveSurfer-friendly: peak envelope
        value = np.max(np.abs(segment))

        peaks.append(float(value))

    out_file = audio_path.with_name(f"{audio_path.stem}_peaks.json")

    with open(out_file, "w") as f:
        json.dump({
            "peaks": peaks,
            "duration": duration
        }, f)

    print("Saved:", out_file)


if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--px_per_sec", type=int, default=50)

    args = parser.parse_args()

    generate_peaks(args.audio_path, args.px_per_sec)