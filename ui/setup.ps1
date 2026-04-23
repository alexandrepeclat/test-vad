Write-Host "Setting up UI app in $PSScriptRoot..."

$VENV_PY = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

python -m venv "$PSScriptRoot\.venv"
& $VENV_PY -m pip install --upgrade pip
& $VENV_PY -m pip install streamlit matplotlib numpy

Write-Host "Done!"