. .\secrets.ps1

Write-Host "Running VAD scripts on all audio files..."

$DATA_DIR = ".\data"
$PYANNOTE_PY = ".\vad-pyannote\.venv\Scripts\python.exe"
$SILERO_PY   = ".\vad-silero\.venv\Scripts\python.exe"
$PYANNOTE_SCRIPT = ".\vad-pyannote\heatmapJson.py"
$SILERO_SCRIPT   = ".\vad-silero\heatmapJson.py"

# Lookup for all files in data/ with priority: WAV > MP3
$files_wav = Get-ChildItem $DATA_DIR -Filter *.wav
$files_mp3 = Get-ChildItem $DATA_DIR -Filter *.mp3
$allFiles = @{}

foreach ($f in $files_mp3) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $allFiles[$base] = $f
}

foreach ($f in $files_wav) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $allFiles[$base] = $f
}

# Process each file with both VADs if not already done
foreach ($f in $allFiles.Values) {

    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $pyannote_json = Join-Path $DATA_DIR "$($base)_pyannote.json"
    $silero_json   = Join-Path $DATA_DIR "$($base)_silero.json"

    # PYANNOTE
    if (!(Test-Path $pyannote_json)) {
        Write-Host "Running pyannote for $($f.Name) → $($base)_pyannote.json"
        & $PYANNOTE_PY $PYANNOTE_SCRIPT $f.FullName --no-plot
    }

    # SILERO
    if (!(Test-Path $silero_json)) {
        Write-Host "Running silero for $($f.Name) → $($base)_silero.json"
        & $SILERO_PY $SILERO_SCRIPT $f.FullName --no-plot
    }
}

Write-Host "Done!"