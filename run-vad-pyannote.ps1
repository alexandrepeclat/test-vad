param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

. .\secrets.ps1

$PYTHON = ".\py-vad-pyannote\.venv\Scripts\python.exe"
$SCRIPT = ".\py-vad-pyannote\vad.py"
$inputAbs = $InputPath
$outputAbs = $OutputPath

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

Write-Host "Pyannote -> $inputAbs -> $outputAbs"
& $PYTHON $SCRIPT "$inputAbs" "$outputAbs"
exit $LASTEXITCODE
