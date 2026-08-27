@echo off
setlocal
cd /d "%~dp0"
title A.T IN PHYSICS Owner Control
echo Starting A.T IN PHYSICS Owner Control...
call npm run owner:control
if errorlevel 1 (
  echo.
  echo Owner Control stopped because its trusted local configuration is missing or invalid.
  pause
)
endlocal
