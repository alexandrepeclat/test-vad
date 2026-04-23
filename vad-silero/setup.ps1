Write-Host "Setting up silero VAD environment..."

python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install torch torchaudio numpy matplotlib scipy
deactivate

Write-Host "Done!"