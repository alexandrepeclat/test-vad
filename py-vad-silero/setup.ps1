Write-Host "Setting up silero VAD in $PSScriptRoot"

$VENV_PY = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
    
python -m venv "$PSScriptRoot\.venv"
& $VENV_PY -m pip install --upgrade pip
& $VENV_PY -m pip install -e "$PSScriptRoot/../py-common"
& $VENV_PY -m pip install torch torchaudio numpy matplotlib scipy

Write-Host "Done!"