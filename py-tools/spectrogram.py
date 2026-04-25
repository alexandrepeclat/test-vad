from py_common.audio import load_audio
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
import argparse

# =========================================================
# SPECTROGRAM GENERATION
# =========================================================
def generate_spectrogram(audio_path):

    audio_path = Path(audio_path)

    # =====================================================
    # LOAD AUDIO
    # =====================================================
    print("Loading audio...")
    audio, sr = load_audio(audio_path)

    duration = len(audio) / sr

    # =====================================================
    # WIDTH STRATEGY
    # =====================================================
    px_per_sec = 2
    max_width = 8000

    width = int(duration * px_per_sec)
    width = min(width, max_width)

    height = 256  # frequency axis size (fixed for consistency)

    print(f"Duration: {duration:.1f}s | Width: {width}px")

    # =====================================================
    # SPECTROGRAM COMPUTATION
    # =====================================================
    plt.figure(figsize=(width / 100, height / 100), dpi=100)

    plt.specgram(
        audio,
        Fs=sr,
        NFFT=1024,
        noverlap=512,
        cmap='magma'
    )

    plt.axis('off')

    # =====================================================
    # OUTPUT FILE
    # =====================================================
    out_file = audio_path.with_name(f"{audio_path.stem}_spectrogram.png")

    plt.savefig(out_file, bbox_inches='tight', pad_inches=0)
    plt.close()

    print(f"Saved: {out_file}")


# =========================================================
# CLI ENTRY POINT
# =========================================================
if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path", help="Path to audio file (wav/mp3)")

    args = parser.parse_args()

    generate_spectrogram(args.audio_path)