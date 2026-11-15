@echo off
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0esta-ligado.ps1"
if not errorlevel 1 goto jaligado
wscript "%~dp0rodar-escondido.vbs"
if "%~1"=="silencioso" exit /b 0
timeout /t 5 /nobreak >nul
start "" http://127.0.0.1:3777
exit /b 0

:jaligado
if "%~1"=="silencioso" exit /b 0
start "" http://127.0.0.1:3777
exit /b 0
