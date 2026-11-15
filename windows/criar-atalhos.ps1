# Cria o atalho pra ligar junto com o Windows e o atalho do painel na Area de Trabalho.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ws = New-Object -ComObject WScript.Shell

$startup = [Environment]::GetFolderPath('Startup')
$lnk = $ws.CreateShortcut((Join-Path $startup 'Ofertas RoB7.lnk'))
$lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$lnk.Arguments = '"' + (Join-Path $PSScriptRoot 'rodar-escondido.vbs') + '"'
$lnk.WorkingDirectory = $repo
$lnk.Description = 'Ofertas RoB7 - liga escondido junto com o Windows'
$lnk.Save()

$desktop = [Environment]::GetFolderPath('Desktop')
$painel = $ws.CreateShortcut((Join-Path $desktop 'Ofertas RoB7.lnk'))
$painel.TargetPath = Join-Path $PSScriptRoot 'INICIAR.bat'
$painel.WorkingDirectory = $repo
$painel.Description = 'Abre o painel do Ofertas RoB7'
$painel.WindowStyle = 7
$painel.Save()

Write-Host '  Atalhos criados: inicio automatico + "Ofertas RoB7" na Area de Trabalho.'
