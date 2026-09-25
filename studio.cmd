@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo Install the current LTS version from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\@11ty\eleventy\bin\eleventy.js" (
  echo Installing the site tools. This only happens once...
  call npm install --no-package-lock
  if errorlevel 1 goto :failed
)

echo.
echo Starting Anas Malas Studio...
echo.
node tools\studio-server.js
goto :end

:failed
echo.
echo Studio setup failed. Use the error above to troubleshoot.
pause
exit /b 1

:end
echo.
echo Studio stopped.
pause
