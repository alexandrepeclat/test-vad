. .\secrets.ps1

Write-Host "Running VAD scripts on all audio files..."

$DATA_DIR = ".\data"
$PYANNOTE_PY = ".\vad-pyannote\.venv\Scripts\python.exe"
$SILERO_PY   = ".\vad-silero\.venv\Scripts\python.exe"
$PYANNOTE_SCRIPT = ".\vad-pyannote\heatmapJson.py"
$SILERO_SCRIPT   = ".\vad-silero\heatmapJson.py"

# Get all audio files recursively
$files_wav = Get-ChildItem $DATA_DIR -Recurse -Filter *.wav
$files_mp3 = Get-ChildItem $DATA_DIR -Recurse -Filter *.mp3

# Dictionary (key = full path without extension)
$allFiles = @{}

# MP3 first (lower priority)
foreach ($f in $files_mp3) {
    $key = [System.IO.Path]::ChangeExtension($f.FullName, $null)
    $allFiles[$key] = $f
}

# WAV overrides MP3 (higher priority)
foreach ($f in $files_wav) {
    $key = [System.IO.Path]::ChangeExtension($f.FullName, $null)
    $allFiles[$key] = $f
}

# Process files
foreach ($f in $allFiles.Values) {

    $inputPath = $f.FullName
    $base = $f.BaseName
    $folder = $f.DirectoryName

    $pyannote_json = Join-Path $folder "${base}_pyannote.json"
    $silero_json   = Join-Path $folder "${base}_silero.json"

    # PYANNOTE
    if (!(Test-Path $pyannote_json)) {
        Write-Host "Pyannote -> $inputPath -> $pyannote_json"
        & $PYANNOTE_PY $PYANNOTE_SCRIPT "$inputPath"
    }

    # SILERO
    if (!(Test-Path $silero_json)) {
        Write-Host "Silero -> $inputPath -> $silero_json"
        & $SILERO_PY $SILERO_SCRIPT "$inputPath"
    }
}

Write-Host "Done!"