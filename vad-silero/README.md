python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install torch torchaudio numpy matplotlib scipy

python silero_heatmap.py test-grenier.mp3
python silero_heatmap.py test-grenier.mp3 --no-plot