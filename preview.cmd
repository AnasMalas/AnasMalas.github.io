@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo Install the current LTS version from https://nodejs.org/
  echo Then close this window and run preview.cmd again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\@11ty\eleventy\bin\eleventy.js" (
  echo Installing the site tools. This only happens once...
  call npm install --no-package-lock
  if errorlevel 1 goto :failed
)

echo.
echo Starting the website at http://localhost:8080 ...
echo Keep this window open while you write. Press Ctrl+C to stop.
echo.
start "" "http://localhost:8080"
call npm run dev
goto :end

:failed
echo.
echo Setup failed. Keep this window open and use the error above to troubleshoot.
pause
exit /b 1

:end
echo.
echo Preview stopped.
pause
