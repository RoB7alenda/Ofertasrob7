@echo off
rem Mantem o programa ligado: se cair, liga de novo em 5 segundos.
cd /d "%~dp0.."
set "ROB7_QUIET=1"
set "DADOS=%LOCALAPPDATA%\OfertasRoB7"
if not exist "%DADOS%\logs" mkdir "%DADOS%\logs"
if exist "%DADOS%\PARAR" del "%DADOS%\PARAR"
:loop
node src\main.js >> "%DADOS%\logs\console.log" 2>&1
rem Codigo 3 = o programa ja estava aberto. Nao abre outro.
if errorlevel 3 if not errorlevel 4 goto fim
if exist "%DADOS%\PARAR" goto fim
timeout /t 5 /nobreak >nul
goto loop
:fim
