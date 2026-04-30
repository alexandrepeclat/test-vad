param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

. .\secrets.ps1

$TOOLS_PY = ".\py-tools\.venv\Scripts\python.exe"
$SPECTRO_SCRIPT = ".\py-tools\spectrogram.py"
$inputAbs = $InputPath
$outputAbs = $OutputPath

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

Write-Host "Spectrogram -> $inputAbs -> $outputAbs"
& $TOOLS_PY $SPECTRO_SCRIPT "$inputAbs" "$outputAbs"
exit $LASTEXITCODE
