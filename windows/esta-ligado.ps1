# Sai com 0 se o painel ja responde (programa ligado), 1 se nao.
try {
  Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3777/api/auth' -TimeoutSec 2 | Out-Null
  exit 0
} catch {
  exit 1
}
