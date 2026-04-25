. .\secrets.ps1

Write-Host "Running spectrogram generation on all audio files..."

$DATA_DIR = ".\data"
$TOOLS_PY = ".\py-tools\.venv\Scripts\python.exe"
$SPECTRO_SCRIPT = ".\py-tools\spectrogram.py"

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

# WAV overrides MP3 (priority)
foreach ($f in $files_wav) {
    $key = [System.IO.Path]::ChangeExtension($f.FullName, $null)
    $allFiles[$key] = $f
}

# Process files
foreach ($f in $allFiles.Values) {

    $outFile = Join-Path $f.DirectoryName "$($f.BaseName)_spectrogram.png"
    if (Test-Path $outFile) {
        continue
    }

    $inputPath = $f.FullName
    Write-Host "Spectrogram -> $inputPath"
    & $TOOLS_PY $SPECTRO_SCRIPT "$inputPath" "$outFile"
}

Write-Host "Done!"