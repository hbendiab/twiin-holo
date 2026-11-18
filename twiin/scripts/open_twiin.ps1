# Ouvre Twiin sous Windows (équivalent de open_twiin.sh) : démarre le serveur s'il est arrêté, puis ouvre la page.
# Lancé par le raccourci Ctrl+Alt+T (scripts/hotkey_win.py) ; utilisable aussi à la main.
$twiin = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:3000/"
function Test-Twiin { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
if (-not (Test-Twiin)) {
  $env:PORT = "3000"
  $log = Join-Path $twiin "workflows\server.log"
  Start-Process -WindowStyle Hidden -FilePath node -ArgumentList "server.js" -WorkingDirectory (Join-Path $twiin "recorder") `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  for ($i = 0; $i -lt 40 -and -not (Test-Twiin); $i++) { Start-Sleep -Milliseconds 500 }
}
# Chrome si installé (partage de plusieurs écrans), sinon le navigateur par défaut
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome $url } else { Start-Process $url }
