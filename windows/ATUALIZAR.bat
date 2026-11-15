@echo off
chcp 65001 >nul
title Ofertas RoB7 - Atualizar
cd /d "%~dp0.."
if not exist ".git" goto semgit
where git >nul 2>nul
if errorlevel 1 goto semgit
echo  [1/3] Baixando a versao nova do GitHub...
git pull --ff-only
if errorlevel 1 goto erro
echo  [2/3] Atualizando as pecas...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto erro
echo  [3/3] Reiniciando o programa...
call "%~dp0PARAR.bat"
call "%~dp0INICIAR.bat"
echo  Atualizado!
pause
exit /b 0

:semgit
echo.
echo  Esta pasta nao veio pelo Git.
echo  Pra atualizar: baixe o ZIP novo no GitHub, extraia por cima desta pasta
echo  e rode o INSTALAR.bat de novo. Seus dados NAO se perdem: ficam em
echo  %LOCALAPPDATA%\OfertasRoB7
echo.
pause
exit /b 0

:erro
echo.
echo  Deu erro na atualizacao. Nada foi apagado. Me mande o print desta tela.
pause
exit /b 1
