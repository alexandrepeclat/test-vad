param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

$FFPROBE = "ffprobe"
$inputAbs = $InputPath
$outputAbs = $OutputPath
$tempFileName = [System.IO.Path]::GetFileName($outputAbs)
if ([string]::IsNullOrWhiteSpace($tempFileName)) {
    $tempFileName = "metadata.json"
}
$tempOutputAbs = Join-Path ([System.IO.Path]::GetTempPath()) $tempFileName

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

if (Test-Path $tempOutputAbs) {
    Remove-Item $tempOutputAbs -Force -ErrorAction SilentlyContinue
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

$metadata | ConvertTo-Json -Depth 10 | Set-Content $tempOutputAbs -Encoding UTF8

if (!(Test-Path $tempOutputAbs)) {
    Write-Host "ERROR: Temp output not produced: $tempOutputAbs" -ForegroundColor Red
    exit 1
}

Move-Item -Path $tempOutputAbs -Destination $outputAbs -Force
exit 0
