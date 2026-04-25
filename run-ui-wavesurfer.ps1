# Start Python HTTP server in a new terminal window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "python -m http.server 8000"

# Wait a bit to let the server start
Start-Sleep -Seconds 2

# Open URL in Firefox
Start-Process "firefox" "http://localhost:8000/ui-wavesurfer"
