#!/usr/bin/env python3
"""Collecte la documentation et des captures PUBLIQUES des outils connus (banque `dictionnaire`).

Deux phases, volontairement séparées :
  1. collecte locale (défaut) : pour chaque outil, ouvre ses pages publiques (aide officielle, page produit),
     garde titre + extrait + capture dans testbench/dico_out/<outil>/ (docs.json + screens/*.png).
  2. envoi (--upload) : pousse docs/captures dans Supabase avec la clé service_role (ADMIN SEULEMENT).
     SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY viennent de l'environnement, jamais d'un fichier du dépôt.

    .venv/Scripts/python testbench/collect_dico.py                   # tous les outils
    .venv/Scripts/python testbench/collect_dico.py --tool Excel      # un seul
    .venv/Scripts/python testbench/collect_dico.py --upload          # envoi (clé service_role requise)

Limite : seules les pages publiques sont capturées (aide, produit). L'interface réelle d'un outil connecté
(après login) relève de l'audit / shadow agent, pas de cette collecte.
"""
import argparse, json, os, re, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent / "dico_out"

SOURCES = {
    "Excel": ["https://support.microsoft.com/en-us/excel", "https://www.microsoft.com/en-us/microsoft-365/excel"],
    "Word": ["https://support.microsoft.com/en-us/word", "https://www.microsoft.com/en-us/microsoft-365/word"],
    "Outlook": ["https://support.microsoft.com/en-us/outlook", "https://www.microsoft.com/en-us/microsoft-365/outlook/email-and-calendar-software-microsoft-outlook"],
    "Power BI": ["https://learn.microsoft.com/en-us/power-bi/fundamentals/power-bi-overview", "https://www.microsoft.com/en-us/power-platform/products/power-bi"],
    "Google Sheets": ["https://support.google.com/docs/topic/9054603", "https://workspace.google.com/products/sheets/"],
    "Gmail": ["https://support.google.com/mail", "https://workspace.google.com/products/gmail/"],
    "LinkedIn": ["https://www.linkedin.com/help/linkedin", "https://about.linkedin.com/"],
}


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def collect(tool: str, urls: list[str], pw) -> dict:
    d = OUT / slug(tool)
    (d / "screens").mkdir(parents=True, exist_ok=True)
    docs, screens = [], []
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    for i, url in enumerate(urls, 1):
        page = ctx.new_page()
        status = None
        try:
            r = page.goto(url, wait_until="domcontentloaded", timeout=30000)
            status = r.status if r else None
            page.wait_for_timeout(2500)
            for sel in ("button:has-text('Reject all')", "button:has-text('Reject')", "button:has-text('Decline')"):
                try:
                    page.click(sel, timeout=800); break  # refuse les cookies non essentiels
                except Exception:
                    pass
            title = page.title()
            text = " ".join(page.inner_text("body").split())[:1200]
            png = d / "screens" / f"{i:02d}.png"
            page.screenshot(path=str(png))
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            docs.append({"url": url, "title": title, "excerpt": text, "kind": "doc", "http_status": status, "fetched_at": now})
            screens.append({"storage_path": f"public/{{id}}/{png.name}", "local_path": str(png), "label": title[:80],
                            "ocr_text": "", "source": "web", "captured_at": now})
            print(f"  ok  {tool}: {url} ({status})")
        except Exception as e:  # noqa: BLE001
            docs.append({"url": url, "error": str(e)[:200], "http_status": status})
            print(f"  ERR {tool}: {url} : {str(e)[:100]}")
        page.close()
    browser.close()
    (d / "docs.json").write_text(json.dumps({"docs": docs, "screens": screens}, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"docs": docs, "screens": screens}


def upload(tools: list[str]) -> None:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans l'environnement (admin seulement).")
    H = {"apikey": key, "Authorization": f"Bearer {key}"}

    def call(method, path, body=None, headers=None, raw=False):
        req = urllib.request.Request(url + path, method=method, data=body if raw else (json.dumps(body).encode() if body is not None else None),
                                     headers={**H, **({"Content-Type": "application/json"} if not raw else {}), **(headers or {})})
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read()
            return json.loads(b) if b and not raw else b

    for tool in tools:
        f = OUT / slug(tool) / "docs.json"
        if not f.exists():
            print(f"  skip {tool} (rien collecté)"); continue
        rows = call("GET", f"/rest/v1/dictionnaire?select=id&name=eq.{urllib.request.quote(tool)}&company_id=is.null")
        if not rows:
            print(f"  skip {tool} (absent du dictionnaire public)"); continue
        tid = rows[0]["id"]
        data = json.loads(f.read_text(encoding="utf-8"))
        screens = []
        for s in data["screens"]:
            path = s["storage_path"].replace("{id}", tid)
            png = Path(s["local_path"]).read_bytes()
            call("POST", f"/storage/v1/object/tool-screens/{path}", png, {"Content-Type": "image/png", "x-upsert": "true"}, raw=True)
            screens.append({k: v for k, v in s.items() if k != "local_path"} | {"storage_path": path})
        call("PATCH", f"/rest/v1/dictionnaire?id=eq.{tid}", {"docs": [d for d in data["docs"] if "error" not in d], "screens": screens},
             {"Prefer": "return=minimal"})
        print(f"  envoyé {tool} : {len(screens)} captures")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tool", action="append", help="un outil (répétable) ; défaut : tous")
    ap.add_argument("--upload", action="store_true", help="envoyer dans Supabase (clé service_role, admin)")
    a = ap.parse_args()
    tools = a.tool or list(SOURCES)
    if a.upload:
        return upload(tools)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        for t in tools:
            if t not in SOURCES:
                print(f"outil inconnu : {t}"); continue
            collect(t, SOURCES[t], pw)
    print(f"\nRésultats dans {OUT}")


if __name__ == "__main__":
    main()
