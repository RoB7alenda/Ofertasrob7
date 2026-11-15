# Desliga o Ofertas RoB7 (e avisa o "vigia" pra nao ligar de novo).
$dados = Join-Path $env:LOCALAPPDATA 'OfertasRoB7'
New-Item -ItemType Directory -Force -Path $dados | Out-Null
Set-Content -Path (Join-Path $dados 'PARAR') -Value 'parar'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\main.js*' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
# Desliga o tunel do celular (cloudflared) que o programa abriu.
$pidFile = Join-Path $dados 'tunel.pid'
if (Test-Path $pidFile) {
  $tpid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $tp = Get-Process -Id $tpid -ErrorAction SilentlyContinue
  if ($tp -and $tp.ProcessName -eq 'cloudflared') { Stop-Process -Id $tpid -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
