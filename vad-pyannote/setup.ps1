Write-Host "Setting up pyannote VAD in $PSScriptRoot"

$VENV_PY = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

python -m venv "$PSScriptRoot\.venv"
& $VENV_PY -m pip install --upgrade pip
& $VENV_PY -m pip install matplotlib scipy
& $VENV_PY -m pip install numpy==1.26.4
& $VENV_PY -m pip install torch==2.1.2 torchaudio==2.1.2 --index-url https://download.pytorch.org/whl/cpu
& $VENV_PY -m pip install huggingface_hub==0.20.3
& $VENV_PY -m pip install pyannote.audio==3.1.1 pyannote.core==5.0.0 pyannote.metrics==3.2.1
& $VENV_PY -m pip install speechbrain==0.5.16

Write-Host "Done!"