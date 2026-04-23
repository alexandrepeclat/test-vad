# =========================================================
# VAD HEATMAP VIEWER (STREAMLIT)
#
# .venv\Scripts\activate
# streamlit run app.py
# =========================================================

import streamlit as st
import numpy as np
import os
import matplotlib.pyplot as plt

# =========================================================
# LOAD NPZ
# =========================================================
def load_npz(path):
    data = np.load(path)
    return data["t"], data["heat"]

# =========================================================
# UI
# =========================================================
st.title("🎙 VAD Heatmap Viewer")

if "show_pyannote" not in st.session_state:
    st.session_state.show_pyannote = True

if "show_silero" not in st.session_state:
    st.session_state.show_silero = True
    
if st.button("Toggle VADs"):
    st.session_state.show_pyannote = not st.session_state.show_pyannote
    st.session_state.show_silero = not st.session_state.show_silero
    
uploaded_file = st.file_uploader("Upload MP3", type=["mp3"])
st.checkbox("Pyannote", key="show_pyannote")
st.checkbox("Silero", key="show_silero")

if uploaded_file:

    # =====================================================
    # AUDIO
    # =====================================================
    data_dir = os.path.join(os.getcwd(), "data")
    os.makedirs(data_dir, exist_ok=True)

    audio_path = os.path.join(data_dir, uploaded_file.name)

    with open(audio_path, "wb") as f:
        f.write(uploaded_file.read())

    base = os.path.splitext(uploaded_file.name)[0]

    pyannote_npz = os.path.join(data_dir, f"{base}_pyannote.npz")
    silero_npz   = os.path.join(data_dir, f"{base}_silero.npz")

    st.audio(audio_path)

    # =====================================================
    # CHECK FILES
    # =====================================================
    if not os.path.exists(pyannote_npz) or not os.path.exists(silero_npz):
        st.warning("Lance d'abord les scripts VAD (pyannote + silero).")
        st.stop()

    # =====================================================
    # LOAD HEATMAPS
    # =====================================================
    t1, h1 = load_npz(pyannote_npz)
    t2, h2 = load_npz(silero_npz)

    # conversion en minutes
    t1 = t1 / 60
    t2 = t2 / 60

    # =====================================================
    # PLOT
    # =====================================================
    fig, ax = plt.subplots(figsize=(12, 4))

    if st.session_state.show_pyannote:
        ax.plot(t1, h1, label="Pyannote", color="#e63946", alpha=0.7)
    if st.session_state.show_silero:
        ax.plot(t2, h2, label="Silero", color="#457b9d", alpha=0.7)
        
    ax.set_title("Speech Activity Comparison")
    ax.set_xlabel("Time (minutes)")
    ax.set_ylabel("Speech intensity (0–1)")
    ax.set_ylim(0, 1.05)
    ax.legend()

    st.pyplot(fig)