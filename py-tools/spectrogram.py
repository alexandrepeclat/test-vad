from py_common.audio import load_audio
import numpy as np
import matplotlib.pyplot as plt
import argparse

# =========================================================
# SPECTROGRAM GENERATION
# =========================================================
def generate_spectrogram(audio_path, output_path):

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
    plt.savefig(output_path, bbox_inches='tight', pad_inches=0)
    plt.close()

    print(f"Saved: {output_path}")


# =========================================================
# CLI ENTRY POINT
# =========================================================
if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path", help="Path to audio file (wav/mp3)")
    parser.add_argument("output_path", help="Path to output spectrogram PNG")

    args = parser.parse_args()

    generate_spectrogram(args.audio_path, args.output_path)