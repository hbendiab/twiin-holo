#!/usr/bin/env python3
"""Bloc « saisir dans un logiciel web sans API » d'une automatisation : Holo remplit un formulaire dans un navigateur
INVISIBLE (la souris et le clavier restent à l'employé), puis le navigateur vérifie que les valeurs sont bien à l'écran.

    echo '{"url": "https://app…/factures/new", "label": "la facture", "values": {"Fournisseur": "…", "Montant HT": "…"}}' \\
        | python -m discovery.web_fill

Connexion : si la page demande un mot de passe, Twiin le saisit lui-même depuis le coffre local du poste
(workflows/runs/.coffre.json : {"app.exemple.fr": {"login": "…", "password": "…"}}, jamais dans git) ; Holo ne voit
jamais le mot de passe. Sécurité : Holo enregistre en brouillon, ne valide, n'envoie, ne paie et ne supprime jamais.
Sortie : {"ok": true, "check": {"ok": true, "missing": []}, "final_url": …, "seconds": …}
"""
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT.parent / ".env")
load_dotenv(ROOT / ".env")

from discovery.agent import run_agent  # noqa: E402

MODEL = os.environ.get("HOLO_WEB_MODEL") or os.environ.get("HOLO_MODEL") or "holo4-35b-a3b"
VAULT = Path(os.environ.get("TWIIN_COFFRE") or ROOT / "workflows" / "runs" / ".coffre.json")


def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def digits(s) -> str:
    """« 1 234,50 € » et « 1234.5 » donnent la même chose : les chiffres significatifs."""
    d = re.sub(r"[^\d,.]", "", str(s)).replace(",", ".")
    try:
        return f"{float(d):.2f}" if d.count(".") <= 1 and d.strip(".") else ""
    except ValueError:
        return ""


def creds_for(url: str) -> dict | None:
    try:
        vault = json.loads(VAULT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    host = urlparse(url).hostname or ""
    return next((v for k, v in vault.items() if host == k or host.endswith("." + k)), None)


def login(url: str):
    def prepare(page):
        pwd = page.locator("input[type=password]:visible")
        if not pwd.count():
            return
        c = creds_for(page.url) or creds_for(url)
        if not c:
            raise RuntimeError("page de connexion sans identifiants dans le coffre Twiin pour " + (urlparse(url).hostname or url))
        user = page.locator("input[type=email]:visible, input[type=text]:visible, input:not([type]):visible").first
        if user.count():
            user.fill(c.get("login", ""))
        pwd.first.fill(c.get("password", ""))
        pwd.first.press("Enter")
        page.wait_for_load_state("networkidle", timeout=15000)
        if page.locator("input[type=password]:visible").count():
            raise RuntimeError("connexion refusée : identifiants du coffre à mettre à jour")
    return prepare


def checker(values: dict):
    def final_check(page):
        shown = page.evaluate("""() => document.body.innerText + '\\n' +
            [...document.querySelectorAll('input, textarea, select')].map((e) =>
              e.tagName === 'SELECT' ? (e.selectedOptions[0]?.text || '') : e.value).join('\\n')""")
        txt, nums = norm(shown), {digits(x) for x in re.findall(r"\d[\d\s.,]*", shown)}
        missing = [k for k, v in values.items() if str(v).strip()
                   and norm(v) not in txt and not (digits(v) and digits(v) in nums)]
        return {"ok": not missing, "missing": missing}
    return final_check


def main():
    req = json.loads(sys.stdin.read().lstrip("﻿") or "{}")
    url, label = req["url"], req.get("label") or "the record"
    raw = req.get("values") or {}
    rows = [r for r in (raw.get("lignes") or []) if isinstance(r, dict)]
    values = {k: v for k, v in raw.items() if k != "lignes" and str(v).strip()}
    for i, r in enumerate(rows, 1):  # à vérifier aussi à l'écran
        values.update({f"ligne {i} · {k}": v for k, v in r.items() if str(v).strip()})
    if not values:
        print(json.dumps({"ok": True, "skipped": True, "info": "rien à saisir"}, ensure_ascii=False))
        return
    lines = "\n".join(f"- {k}: {v}" for k, v in values.items() if not k.startswith("ligne "))
    if rows:
        lines += "\nand these table rows (add a row with « + » / « Ajouter une ligne » when needed):\n" + "\n".join(
            f"- row {i}: " + "; ".join(f"{k} = {v}" for k, v in r.items()) for i, r in enumerate(rows, 1))
    mission = (f"You are in a business web application. Enter {label} with EXACTLY these values, each in the field "
               f"with this label:\n{lines}\n"
               "If you are not on the entry form yet, open it (e.g. « Nouveau », « Créer », « + »). Fields with a suggestion "
               "list: type a few letters, then click the matching suggestion. Use note to track which fields are done. "
               "When every field shows its value, save it as a DRAFT (« Enregistrer », « Brouillon ») if such a button exists. "
               "Never validate, send, pay, sign or delete anything. Then call done.")
    out = Path(tempfile.mkdtemp(prefix="twiin-fill-"))
    try:
        res = run_agent(url, mission, out, MODEL, max_steps=int(req.get("max_steps") or 40),
                        prepare=login(url), final_check=checker(values))
    except RuntimeError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return
    check = res.get("check") or {"ok": False}
    print(json.dumps({"ok": bool(check.get("ok")), "check": check, "final_url": res.get("final_url"),
                      "seconds": res["stats"]["seconds"], "calls": res["stats"]["calls"], "model": MODEL,
                      "screenshot": str(out / "final.jpg")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
