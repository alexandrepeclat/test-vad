import subprocess
import numpy as np

# =========================================================
# AUDIO LOADING (FFMPEG → mono float32)
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
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode())
    audio = np.frombuffer(result.stdout, np.float32)
    return audio, sr