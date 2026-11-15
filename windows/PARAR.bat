@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0parar.ps1"
echo.
echo  Ofertas RoB7 desligado.
echo  Pra ligar de novo, use o INICIAR.bat (ou reinicie o PC).
timeout /t 4 >nul
