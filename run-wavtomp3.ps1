param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

$FFMPEG = "ffmpeg"
$inputAbs = $InputPath
$outputAbs = $OutputPath
$tempFileName = [System.IO.Path]::GetFileName($outputAbs)
if ([string]::IsNullOrWhiteSpace($tempFileName)) {
    $tempFileName = "output.mp3"
}
$tempOutputAbs = Join-Path ([System.IO.Path]::GetTempPath()) $tempFileName

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

if (Test-Path $tempOutputAbs) {
    Remove-Item $tempOutputAbs -Force -ErrorAction SilentlyContinue
}

Write-Host "WAV -> MP3 $inputAbs -> $outputAbs"

# -------------------------------------------------
# loudnorm params (EBU R128)
#
# I   = Integrated loudness (target volume)
#       -16 LUFS = standard podcast / YouTube level
#
# TP  = True Peak (max peak after encoding)
#       -1.5 dB = avoids clipping (especially MP3)
#
# LRA = Loudness Range (dynamic range)
#       11 = natural voice dynamics (not too compressed)
# -------------------------------------------------

& $FFMPEG -i "$inputAbs" `
    -hide_banner -loglevel info `
    -af "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=16000,pan=mono|c0=0.5*c0+0.5*c1" `
    -vn -acodec libmp3lame -b:a 128k `
    "$tempOutputAbs"

$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    if (Test-Path $tempOutputAbs) {
        Remove-Item $tempOutputAbs -Force -ErrorAction SilentlyContinue
    }
    exit $exitCode
}

if (!(Test-Path $tempOutputAbs)) {
    Write-Host "ERROR: Temp output not produced: $tempOutputAbs" -ForegroundColor Red
    exit 1
}

Move-Item -Path $tempOutputAbs -Destination $outputAbs -Force
exit 0