@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Dependencies are missing. Run npm ci and npm run assets first.
  pause
  exit /b 1
)
echo Starting Score to MIDI. Keep this window open while using the app.
call npm run dev -- --host 127.0.0.1 --open
