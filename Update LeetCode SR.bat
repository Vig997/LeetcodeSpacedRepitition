@echo off
cd /d "%~dp0"
echo ========================================
echo  Update LeetCode SR
echo ========================================
echo.

where git >nul 2>&1
if %ERRORLEVEL% equ 0 (
  if exist ".git" (
    echo Pulling latest code...
    git pull
    if errorlevel 1 (
      echo.
      echo UPDATE FAILED: git pull failed.
      pause
      exit /b 1
    )
    echo.
  ) else (
    echo Note: not a git repo — skipping git pull.
    echo.
  )
) else (
  echo Note: git not found — skipping git pull.
  echo.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-local.ps1"
if errorlevel 1 (
  echo.
  echo UPDATE FAILED. See messages above.
  pause
  exit /b 1
)

echo.
echo UPDATE SUCCESSFUL. Launch from Desktop shortcut "LeetCode SR".
pause
exit /b 0
