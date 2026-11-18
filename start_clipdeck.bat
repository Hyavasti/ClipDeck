@echo off
start "ClipDeck Backend" cmd /k "cd /d S:\AIViralClipper\backend && .\venv\Scripts\activate.bat && uvicorn main:app --reload --port 8000 --no-access-log"
start "ClipDeck Frontend" cmd /k "cd /d S:\AIViralClipper\frontend && npm run dev"
timeout /t 6 /nobreak >nul
start http://localhost:5173