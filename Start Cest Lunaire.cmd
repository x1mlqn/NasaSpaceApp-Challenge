@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>&1
if not errorlevel 1 (
    python "%~dp0server-local.py"
) else (
    py -3 "%~dp0server-local.py"
)
if errorlevel 1 pause
