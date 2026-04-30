param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

$FFPROBE = "ffprobe"
$inputAbs = $InputPath
$outputAbs = $OutputPath

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

Write-Host "Metadata -> $inputAbs -> $outputAbs"

$inputFile = Get-Item $inputAbs
$startDate = $inputFile.CreationTime.ToString("o")

$durationRaw = & $FFPROBE -v error `
    -show_entries format=duration `
    -of default=noprint_wrappers=1:nokey=1 `
    "$inputAbs"

$duration = [double]$durationRaw

$infoRaw = & $FFPROBE -v error `
    -show_entries stream=sample_rate,channels,codec_name,bit_rate `
    -of json `
    "$inputAbs" | ConvertFrom-Json

$stream = $infoRaw.streams[0]

$metadata = @{
    file = $inputFile.Name
    startDate = $startDate
    duration = $duration
    sampleRate = $stream.sample_rate
    channels = $stream.channels
    codec = $stream.codec_name
    bitRate = $stream.bit_rate
}

$metadata | ConvertTo-Json -Depth 10 | Set-Content $outputAbs -Encoding UTF8
exit 0
