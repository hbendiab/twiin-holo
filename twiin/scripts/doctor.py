#!/usr/bin/env python3
"""Vérifie qu'un poste (Mac ou Windows) a tout ce qu'il faut pour Twiin, sans jamais afficher un secret.

    python scripts/doctor.py          (depuis twiin/, avec le Python du venv)

Pour chaque point : ✅ OK, ⚠️ facultatif ou dégradé, ❌ bloquant, avec la commande pour corriger.
"""
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import urllib.request
try:  # certificats HTTPS (Python de python.org sur Mac)
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IS_WIN, IS_MAC = sys.platform == "win32", sys.platform == "darwin"
results = []


def check(ok, label, fix="", level="❌"):
    results.append((("✅" if ok else level), label, "" if ok else fix))


def has(mod):
    return importlib.util.find_spec(mod) is not None


def env_values() -> dict:
    vals = dict(os.environ)
    for f in (ROOT / ".env", ROOT.parent / ".env"):
        if f.exists():
            for line in f.read_text(encoding="utf-8").splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    vals.setdefault(k.strip(), v.split("#")[0].strip().strip('"'))
    return vals


def http_ok(url, headers=None, timeout=8):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=timeout) as r:
            return r.status < 400
    except Exception:  # noqa: BLE001
        return False


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"Système : {platform.system()} {platform.release()} · Python {platform.python_version()} ({sys.executable})\n")
    check(sys.version_info >= (3, 10), "Python 3.10 ou plus", "installe Python 3.12")
    check(".venv" in sys.executable, "lancé depuis le venv du projet",
          "utilise le Python du venv : .venv/bin/python (Mac) ou .venv\\Scripts\\python (Windows)", "⚠️")
    node = shutil.which("node")
    check(bool(node), "Node.js installé", "installe Node 20+ (n8n 2.48 demande Node 24)")
    if node:
        v = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
        check(int(v.lstrip("v").split(".")[0]) >= 20, f"Node {v} (20 ou plus)", "mets Node à jour")
    check((ROOT / "recorder" / "node_modules").exists(), "dépendances de la page installées", "cd recorder && npm install")

    # Python : dépendances communes et propres au système
    for mod, pkg in [("openai", "openai"), ("dotenv", "python-dotenv"), ("playwright", "playwright"), ("PIL", "pillow")]:
        check(has(mod), f"module {pkg}", "pip install -e .  (depuis twiin/)")
    if IS_MAC:
        check(has("Quartz") and has("Vision"), "OCR et journal d'actions macOS (pyobjc)", "pip install -e .")
        print("  ℹ️  macOS : autoriser Enregistrement de l'écran (Chrome), Accessibilité et Surveillance de l'entrée "
              "(Terminal / VS Code), puis relancer le serveur.")
    elif IS_WIN:
        check(has("winocr"), "OCR Windows (winocr)", "pip install -e .")
        check(has("pynput") and has("uiautomation") and has("psutil"), "journal d'actions Windows (pynput, uiautomation)",
              "pip install -e .")
    else:
        check(False, "OCR et journal d'actions", "système non pris en charge (Mac ou Windows)", "⚠️")
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            p.chromium.launch().close()
        check(True, "navigateur Chromium de Playwright")
    except Exception:  # noqa: BLE001
        check(False, "navigateur Chromium de Playwright", "python -m playwright install chromium")

    # Clés (présence + validité, jamais la valeur)
    e = env_values()
    hf = e.get("HF_TOKEN")
    check(bool(hf) and http_ok("https://router.huggingface.co/v1/models", {"Authorization": f"Bearer {hf}"}),
          "HF_TOKEN présent et valide (analyse)", "mets ta clé Hugging Face dans twiin/.env (HF_TOKEN=)")
    hai = e.get("HAI_API_KEY")
    check(bool(hai) and http_ok("https://api.hcompany.ai/v1/models", {"Authorization": f"Bearer {hai}"}),
          "HAI_API_KEY présent et valide (Holo)", "mets ta clé H dans twiin/.env (HAI_API_KEY=)", "⚠️")
    sup = all(e.get(k) for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_EMAIL", "SUPABASE_PASSWORD"))
    if sup:
        try:
            req = urllib.request.Request(e["SUPABASE_URL"].rstrip("/") + "/auth/v1/token?grant_type=password", method="POST",
                                         data=json.dumps({"email": e["SUPABASE_EMAIL"], "password": e["SUPABASE_PASSWORD"]}).encode(),
                                         headers={"apikey": e["SUPABASE_PUBLISHABLE_KEY"], "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as r:
                user = json.loads(r.read())["user"]
            check(bool((user.get("app_metadata") or {}).get("company_id")), "Supabase : connexion + entreprise rattachée",
                  "demande à l'admin de renseigner company_id dans app_metadata")
        except Exception:  # noqa: BLE001
            check(False, "Supabase : connexion", "vérifie SUPABASE_EMAIL / SUPABASE_PASSWORD / SUPABASE_PUBLISHABLE_KEY")
    else:
        check(False, "Supabase configuré (découverte de la tâche)", "remplis SUPABASE_* dans twiin/.env", "⚠️")

    # n8n (itérations d'automatisation)
    url = (e.get("N8N_LOCAL_URL") or "http://localhost:5678").rstrip("/")
    check(http_ok(url + "/healthz"), f"n8n joignable ({url})", "lance n8n : npx n8n@2.48.5 start (ou n8n start)", "⚠️")
    cfg = Path.home() / ".n8ncli-global.json"
    local = {}
    if cfg.exists():
        try:
            local = json.loads(cfg.read_text(encoding="utf-8")).get("environments", {}).get("LOCAL", {})
        except ValueError:
            pass
    check(bool((e.get("N8N_LOCAL_API_KEY") or local.get("apiKey")) and (e.get("N8N_LOCAL_MCP_TOKEN") or local.get("accessToken"))),
          "n8n : clé API + jeton MCP", "n8ncli envs edit LOCAL --url http://localhost:5678 --api-key … --access-token …", "⚠️")

    print()
    for icon, label, fix in results:
        print(f"{icon} {label}" + (f"\n     → {fix}" if fix else ""))
    blocking = sum(1 for r in results if r[0] == "❌")
    print(f"\n{'Tout est prêt.' if not blocking else f'{blocking} point(s) bloquant(s) à corriger.'}")
    sys.exit(1 if blocking else 0)


if __name__ == "__main__":
    main()
