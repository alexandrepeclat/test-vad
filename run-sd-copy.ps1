# Source and destination paths
$source = "G:\"
$destination = Join-Path (Get-Location) "data"

# Check if source exists (e.g., SD card inserted)
if (!(Test-Path $source)) {
    Write-Host "Source drive not found. Skipping copy."
    return
}

# Create destination directory if it does not exist
if (!(Test-Path $destination)) {
    Write-Host "Destination directory not found. Abort !"
    return
}

# Run Robocopy

# /E -> Copy all subdirectories, including empty ones 
# /COPY:DAT -> Copy Data, Attributes, and Timestamps 
# /DCOPY:T -> Preserve directory timestamps 
# /R:2 -> Retry 2 times on failure 
# /W:2 -> Wait 2 seconds between retries

robocopy $source $destination `
    /E `
    /COPY:DAT `
    /DCOPY:T `
    /R:2 `
    /W:2

Write-Host "Copy completed."
