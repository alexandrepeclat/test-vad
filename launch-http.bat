::cd nginx
::start nginx
start cmd /k "python -m http.server 8000"
timeout /t 2
start chrome http://localhost:8000
