@echo off
cd /d "%~dp0"
echo MINE MIRAGE BUILD 5234 - http://127.0.0.1:5233/
py -3 -m http.server 5233 --bind 127.0.0.1
pause
