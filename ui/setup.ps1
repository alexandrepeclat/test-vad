Write-Host "Setting up UI app..."

python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install streamlit matplotlib numpy
deactivate

Write-Host "Done!"