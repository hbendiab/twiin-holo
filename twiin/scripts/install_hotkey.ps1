# Installe le raccourci Ctrl+Alt+T qui ouvre Twiin (équivalent Windows de install_hotkey.sh) :
# un raccourci dans le dossier Démarrage lance scripts/hotkey_win.py, sans fenêtre, à chaque ouverture de session.
$twiin = Split-Path -Parent $PSScriptRoot
$py = @((Join-Path $twiin ".venv\Scripts\pythonw.exe"), (Join-Path (Split-Path -Parent $twiin) ".venv\Scripts\pythonw.exe")) |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $py) { Write-Error "venv introuvable : installe d'abord Twiin (voir README)"; exit 1 }
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Twiin (Ctrl+Alt+T).lnk"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $py
$s.Arguments = '"' + (Join-Path $PSScriptRoot "hotkey_win.py") + '"'
$s.WorkingDirectory = $twiin
$s.Save()
Start-Process -FilePath $py -ArgumentList ('"' + (Join-Path $PSScriptRoot "hotkey_win.py") + '"') -WindowStyle Hidden
Write-Output "Raccourci Ctrl+Alt+T installé (démarrage de session) et lancé. Pour l'enlever : supprimer « $lnk »."
