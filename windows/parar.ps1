# Desliga o Ofertas RoB7 (e avisa o "vigia" pra nao ligar de novo).
$dados = Join-Path $env:LOCALAPPDATA 'OfertasRoB7'
New-Item -ItemType Directory -Force -Path $dados | Out-Null
Set-Content -Path (Join-Path $dados 'PARAR') -Value 'parar'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\main.js*' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
