param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

. .\secrets.ps1

$inputAbs  = (Resolve-Path $InputPath).Path
$inputDir  = Split-Path $inputAbs -Parent
$inputFile = Split-Path $inputAbs -Leaf
$cacheDir  = Join-Path $PSScriptRoot ".cache"

if (!(Test-Path $inputAbs)) {
    Write-Host "ERROR: Input not found: $InputPath" -ForegroundColor Red
    exit 1
}

Write-Host "Transcr -> $inputAbs -> $OutputPath"

docker run --rm --gpus all `
    -e HF_TOKEN="$($env:HF_TOKEN)" `
    -v "${inputDir}:/app" `
    -v "${cacheDir}:/.cache" `
    ghcr.io/jim60105/whisperx:no_model `
    -- `
    /app/$inputFile `
    --model large-v3 `
    --task transcribe `
    --language bg `
    --device cuda `
    --batch_size 4 `
    --diarize `
    --align_model infinitejoy/wav2vec2-large-xls-r-300m-bulgarian `
    --output_dir /app `
    --output_format all

$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    exit $exitCode
}

if (!(Test-Path $OutputPath)) {
    Write-Host "ERROR: Output not produced: $OutputPath" -ForegroundColor Red
    exit 1
}

exit 0
