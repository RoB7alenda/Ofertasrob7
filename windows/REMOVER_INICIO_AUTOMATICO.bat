@echo off
chcp 65001 >nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Ofertas RoB7.lnk" >nul 2>nul
echo  O Ofertas RoB7 nao vai mais ligar sozinho com o Windows.
echo  Pra voltar, rode o INSTALAR.bat de novo.
timeout /t 5 >nul
