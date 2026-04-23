Write-Host "Setting up pyannote VAD environment..."

python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install matplotlib scipy
pip install numpy==1.26.4
pip install torch==2.1.2 torchaudio==2.1.2 --index-url https://download.pytorch.org/whl/cpu
pip install huggingface_hub==0.20.3
pip install pyannote.audio==3.1.1 pyannote.core==5.0.0 pyannote.metrics==3.2.1
pip install speechbrain==0.5.16
deactivate

Write-Host "Done!"