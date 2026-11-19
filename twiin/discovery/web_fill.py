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


# Les champs de saisie visibles avec leur libellé (label, aria, ou en-tête de colonne) et leur ligne de tableau.
# Exposé comme window.__twinState : run_agent le lit à chaque « fini » (done_guard) et à la fin.
FIELDS_JS = r"""window.__twinState = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const txt = (e) => (e?.innerText || e?.textContent || '').trim();
  const rows = [...document.querySelectorAll('tr')].filter((tr) => tr.querySelector('input, select, textarea'));
  return [...document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]), select, textarea')]
    .filter(vis).map((e) => {
      let label = (e.id && txt(document.querySelector(`label[for="${e.id}"]`))) || e.getAttribute('aria-label') || '';
      if (!label && e.getAttribute('aria-labelledby')) label = e.getAttribute('aria-labelledby').split(' ').map((i) => txt(document.getElementById(i))).join(' ');
      const td = e.closest('td'), tr = e.closest('tr');
      if (!label && td && tr) { const th = e.closest('table')?.querySelectorAll('tr')[0]?.children[td.cellIndex]; label = txt(th); }
      const value = e.tagName === 'SELECT' ? txt(e.selectedOptions[0]) : e.value;
      return { label: label.slice(0, 60), value: (value || '').slice(0, 120), row: tr && td ? rows.indexOf(tr) : -1 };
    });
};"""


def same(want, got) -> bool:
    a, b = norm(want), norm(got)
    if not a:
        return True
    if not b:
        return False
    if a == b or (len(a) > 3 and (a in b or (len(b) > 3 and b in a))):
        return True
    return bool(digits(want)) and digits(want) == digits(got) and not re.search(r"[a-z]{3}", a.replace("eur", ""))


def label_match(key, label) -> bool:
    k, l = set(norm(key).split()), set(norm(label).split())
    return bool(k and l) and len(k & l) / len(k) >= 0.5


def compare(values: dict, fields: list) -> list[str]:
    """Écarts entre les valeurs à saisir et ce que montrent les champs, ligne par ligne. [] si tout est bon."""
    rows = sorted({f["row"] for f in fields if f["row"] >= 0})
    bad = []
    for k, v in values.items():
        m = re.match(r"ligne (\d+) · (.+)", k)
        if m:
            i, key = int(m.group(1)) - 1, m.group(2)
            pool = [f for f in fields if rows[i:i + 1] and f["row"] == rows[i]] if i < len(rows) else []
        else:
            key, pool = k, [f for f in fields if f["row"] < 0] or fields
        named = [f for f in pool if label_match(key, f["label"])]
        if named and not any(same(v, f["value"]) for f in named):
            bad.append(f"{k} : attendu « {v} », affiché « {named[0]['value']} »")
        elif not named and not any(same(v, f["value"]) for f in pool):
            bad.append(f"{k} : « {v} » absent")
    return bad


def guard(values: dict):
    def done_guard(state):
        bad = compare(values, state or [])
        return ("these fields are wrong or empty, fix them (then save the draft again): " + " ; ".join(bad)) if bad else None
    return done_guard


def checker(values: dict):
    def final_check(page):
        bad = compare(values, page.evaluate("() => window.__twinState ? window.__twinState() : []") or [])
        # messages d'erreur affichés par le logiciel (champ obligatoire, doublon…) : la saisie n'est pas enregistrée
        errs = page.evaluate(r"""() => [...document.querySelectorAll('[role=alert], .error, .erreur, .errors, .alert, .message-erreur, [class*=error], [class*=erreur]')]
            .filter((e) => e.offsetParent).map((e) => e.innerText.trim()).filter((t) => /erreur|error|doublon|duplicate|obligatoire|required|invalide|invalid/i.test(t))
            .map((t) => t.slice(0, 200))""") or []
        return {"ok": not bad and not errs, "missing": bad, "page_errors": errs}
    return final_check


def main():
    req = json.loads(sys.stdin.read().lstrip("﻿") or "{}")
    url, label = req["url"], req.get("label") or "the record"
    raw = req.get("values") or {}
    rows = [r for r in (raw.get("lignes") or []) if isinstance(r, dict)]
    dest = str(raw.get("destinataire") or "")
    values = {k: v for k, v in raw.items() if k not in ("lignes", "destinataire") and str(v).strip()}
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
               + (f"The document is addressed to « {dest} »: if the application first asks to choose a company, client "
                  f"file or folder (dossier), open the one for « {dest} » (use its search box if needed). " if dest else "")
               + "If you are not on the entry form yet, open it (e.g. « Nouveau », « Créer », « + »). Fields with a suggestion "
               "list: type a few letters, then click the matching suggestion. Use note to track which fields are done. "
               "When every field shows its value, save it as a DRAFT (« Enregistrer », « Brouillon ») if such a button exists. "
               "Never validate, send, pay, sign or delete anything. Then call done.")
    out = Path(tempfile.mkdtemp(prefix="twiin-fill-"))
    try:
        res = run_agent(url, mission, out, MODEL, max_steps=int(req.get("max_steps") or 40),
                        init_script=FIELDS_JS, done_guard=guard(values), prepare=login(url),
                        final_check=checker(values))
    except RuntimeError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return
    check = res.get("check") or {"ok": False}
    print(json.dumps({"ok": bool(check.get("ok")), "check": check, "final_url": res.get("final_url"),
                      "seconds": res["stats"]["seconds"], "calls": res["stats"]["calls"], "model": MODEL,
                      "screenshot": str(out / "final.jpg")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
