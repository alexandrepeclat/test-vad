# Structure
project/
  data/
    audio.mp3
    audio_pyannote.npz
    audio_silero.npz

  vad-pyannote/
    pyannote_heatmap.py

  vad-silero/
    silero_heatmap.py

  ui/
    app.py
	
	
# Usage
Depuis dossier de base

$env:HF_TOKEN="xyz"
.\vad-pyannote\.venv\Scripts\python.exe .\vad-pyannote\pyannote_heatmap.py test.mp3
.\vad-silero\.venv\Scripts\python.exe .\vad-silero\silero_heatmap.py test.mp3
.\ui\.venv\Scripts\python.exe -m streamlit run .\ui\app.py

Pour exporter sans ouvrir la fenetre matplotlib :
.\vad-pyannote\.venv\Scripts\python.exe .\vad-pyannote\pyannote_heatmap.py test.mp3 --no-plot
.\vad-silero\.venv\Scripts\python.exe .\vad-silero\silero_heatmap.py test.mp3 --no-plot