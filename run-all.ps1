
& "./run-sd-copy.ps1"
& "./run-wavtomp3.ps1"

Write-Host "Build scripts now require -InputPath and -OutputPath and are orchestrated by ui-server / UI buttons." -ForegroundColor Yellow

& "./run-ui.ps1"

#& "./run-vad-npz.ps1"
#& "./run-ui.ps1"