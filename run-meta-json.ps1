Write-Host "Generating metadata JSON for WAV/MP3 files..."

$DATA_DIR = ".\data"
$FFPROBE = "ffprobe"

# -------------------------
# COLLECT FILES
# -------------------------
$files_wav = Get-ChildItem $DATA_DIR -Recurse -Filter *.wav
$files_mp3 = Get-ChildItem $DATA_DIR -Recurse -Filter *.mp3

# -------------------------
# DICTIONARY (WAV overrides MP3)
# key = full path without extension
# -------------------------
$allFiles = @{}

foreach ($f in $files_mp3) {
    $key = [System.IO.Path]::ChangeExtension($f.FullName, $null)
    $allFiles[$key] = $f
}

foreach ($f in $files_wav) {
    $key = [System.IO.Path]::ChangeExtension($f.FullName, $null)
    $allFiles[$key] = $f
}

# -------------------------
# PROCESS UNIQUE FILES
# -------------------------
foreach ($f in $allFiles.Values) {

    $outFile = Join-Path $f.DirectoryName "$($f.BaseName)_metadata.json"

    if (Test-Path $outFile) {
        continue
    }

    Write-Host "Processing $($f.FullName)"

    # -------------------------
    # FILE CREATION DATE
    # -------------------------
    $startDate = $f.CreationTime.ToString("o")

    # -------------------------
    # AUDIO DURATION (ffprobe)
    # -------------------------
    $durationRaw = & $FFPROBE -v error `
        -show_entries format=duration `
        -of default=noprint_wrappers=1:nokey=1 `
        "$($f.FullName)"

    $duration = [double]$durationRaw

    # -------------------------
    # STREAM INFO
    # -------------------------
    $infoRaw = & $FFPROBE -v error `
        -show_entries stream=sample_rate,channels,codec_name,bit_rate `
        -of json `
        "$($f.FullName)" | ConvertFrom-Json

    $stream = $infoRaw.streams[0]

    # -------------------------
    # OUTPUT
    # -------------------------
    $metadata = @{
        file = $f.Name
        startDate = $startDate
        duration = $duration
        sampleRate = $stream.sample_rate
        channels = $stream.channels
        codec = $stream.codec_name
        bitRate = $stream.bit_rate
    }

    $metadata | ConvertTo-Json -Depth 10 | Set-Content $outFile -Encoding UTF8
}

Write-Host "Done!"