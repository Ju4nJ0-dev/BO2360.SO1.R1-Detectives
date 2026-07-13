@echo off
REM ── Sirve el juego en http://localhost:8000 (necesario para PWA + carga del Sheet) ──
cd /d "%~dp0"
echo Abriendo http://localhost:8000  (deja esta ventana abierta mientras juegas)
start "" http://localhost:8000
py -m http.server 8000 2>nul || python -m http.server 8000 2>nul || npx --yes serve -l 8000
pause
