. .\secrets.ps1

$DATA_DIR = ".\data"

$PYANNOTE_PY = ".\vad-pyannote\.venv\Scripts\python.exe"
$SILERO_PY   = ".\vad-silero\.venv\Scripts\python.exe"

$PYANNOTE_SCRIPT = ".\vad-pyannote\pyannote_heatmap.py"
$SILERO_SCRIPT   = ".\vad-silero\silero_heatmap.py"

# Récupération des fichiers
$files = Get-ChildItem $DATA_DIR -Filter *.mp3

foreach ($f in $files) {

    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)

    $pyannote_npz = Join-Path $DATA_DIR "$($base)_pyannote.npz"
    $silero_npz   = Join-Path $DATA_DIR "$($base)_silero.npz"

    # =====================================================
    # PYANNOTE
    # =====================================================
    if (!(Test-Path $pyannote_npz)) {
        Write-Host "Running pyannote for $($f.Name) → $($base)_pyannote.npz"
        & $PYANNOTE_PY $PYANNOTE_SCRIPT $f.FullName --no-plot
    }

    # =====================================================
    # SILERO
    # =====================================================
    if (!(Test-Path $silero_npz)) {
        Write-Host "Running silero for $($f.Name) → $($base)_silero.npz"
        & $SILERO_PY $SILERO_SCRIPT $f.FullName --no-plot
    }
}