
#Env
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install matplotlib scipy
pip install numpy==1.26.4
pip install torch==2.1.2 torchaudio==2.1.2 --index-url https://download.pytorch.org/whl/cpu
pip install huggingface_hub==0.20.3
pip install pyannote.audio==3.1.1 pyannote.core==5.0.0 pyannote.metrics==3.2.1
pip install speechbrain==0.5.16

#Run
.venv\Scripts\activate
$env:HF_TOKEN="xyz"
python pyannote_heatmap.py "test-grenier.mp3"
python pyannote_heatmap.py "test-grenier.mp3" --no-plot


#Doc
https://github.com/pyannote/pyannote-audio

Alternatives
https://github.com/snakers4/silero-vad
https://github.com/wiseman/py-webrtcvad