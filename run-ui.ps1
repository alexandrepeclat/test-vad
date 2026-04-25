# Start Python HTTP server in a new terminal window
#Start-Process powershell -ArgumentList "-NoExit", "-Command", "node ui-server/server.js"

# Wait a bit to let the server start
#Start-Sleep -Seconds 2

# Open URL in Firefox
#Start-Process "firefox" "http://localhost:3000"
node ui-server/server.js