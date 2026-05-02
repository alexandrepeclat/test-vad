param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

. .\secrets.ps1

$TOOLS_PY = ".\py-tools\.venv\Scripts\python.exe"
$PEAKS_SCRIPT = ".\py-tools\peaks.py"
$inputAbs = $InputPath
$outputAbs = $OutputPath
$tempFileName = [System.IO.Path]::GetFileName($outputAbs)
if ([string]::IsNullOrWhiteSpace($tempFileName)) {
    $tempFileName = "peaks.json"
}
$tempOutputAbs = Join-Path ([System.IO.Path]::GetTempPath()) $tempFileName

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

if (Test-Path $tempOutputAbs) {
    Remove-Item $tempOutputAbs -Force -ErrorAction SilentlyContinue
}

Write-Host "Peaks -> $inputAbs -> $outputAbs"

& $TOOLS_PY $PEAKS_SCRIPT "$inputAbs" "$tempOutputAbs"
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
