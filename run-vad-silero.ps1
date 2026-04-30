param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

. .\secrets.ps1

$PYTHON = ".\py-vad-silero\.venv\Scripts\python.exe"
$SCRIPT = ".\py-vad-silero\vad.py"
$inputAbs = $InputPath
$outputAbs = $OutputPath

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

Write-Host "Silero -> $inputAbs -> $outputAbs"
& $PYTHON $SCRIPT "$inputAbs" "$outputAbs"
exit $LASTEXITCODE
