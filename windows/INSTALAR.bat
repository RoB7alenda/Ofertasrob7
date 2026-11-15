@echo off
chcp 65001 >nul
title Ofertas RoB7 - Instalar
cd /d "%~dp0.."
echo.
echo  ==========================================
echo    OFERTAS RoB7 V3 - INSTALACAO
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto semnode
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 goto semnode
goto temnode

:semnode
echo  [1/4] O Node.js 22 nao esta instalado. Instalando pelo winget...
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto nodemanual
echo.
echo  Node.js instalado!
echo  FECHE esta janela e abra o INSTALAR.bat de novo.
echo.
pause
exit /b 0

:nodemanual
echo.
echo  Nao consegui instalar sozinho.
echo  Baixe o Node.js LTS em https://nodejs.org , instale e rode este arquivo de novo.
echo.
pause
exit /b 1

:temnode
echo  [1/4] Node.js OK
echo  [2/4] Baixando as pecas do programa. Pode levar alguns minutos...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto erronpm
echo  [3/4] Configurando pra ligar junto com o Windows...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0criar-atalhos.ps1"
echo  [4/4] Ligando o programa...
call "%~dp0INICIAR.bat" silencioso
timeout /t 5 /nobreak >nul
start "" http://127.0.0.1:3777
echo.
echo  ==========================================
echo    PRONTO! O painel abriu no navegador.
echo    Endereco: http://127.0.0.1:3777
echo  ==========================================
echo.
pause
exit /b 0

:erronpm
echo.
echo  ERRO ao baixar as pecas. Confira a internet e rode de novo.
pause
exit /b 1
