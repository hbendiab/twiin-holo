#!/usr/bin/env python3
"""Construit le plan d'automatisation n8n à partir de la découverte d'une tâche (solution gagnante), sans gêner
l'employé : Holo lit les pages web dans un navigateur INVISIBLE, l'écriture dans Excel se fait par le fichier.

    python -m discovery.build_automation <dossier de session>     -> écrit automation/plans/<nom>.json, affiche son chemin

Sources : la spécification du jumeau (éléments, colonnes), l'analyse de l'enregistrement (étapes), les adresses lues
à l'écran (OCR des barres d'adresse) et le journal d'actions (nom du classeur dans le titre de la fenêtre Excel).
"""
import json
import re
import sys
from pathlib import Path

from discovery.discovery import HF_MODEL, ROOT, fenced, hf_client

PROMPT = """You prepare an automation for a task an employee recorded. Map each item of the task to the web page where
its values are read, using ONLY addresses that appear in the recording (OCR of the address bar, possibly truncated or
with tracking parameters: rebuild the clean product address, drop the tracking parameters ?gad_source, gclid, utm_…).
Also give the spreadsheet file name the employee filled (from window titles, e.g. "Comparatif - Excel" -> "Comparatif").
First decide the PATTERN of the task:
- "lecture_web": the employee READS values on web pages and copies them into a spreadsheet;
- "saisie_web": the employee READS a document (PDF invoice, order, form received…) and TYPES its content into a
  business web application (no API) — e.g. entering a supplier invoice.
Return ONLY JSON:
{"pattern": "lecture_web" | "saisie_web",
 "name": "short French name of the automation",
 // lecture_web only:
 "items": [{"label": "item as the employee names it", "url": "https://…"}],
 "columns": ["the spreadsheet columns, in order, as in the recording"],
 "workbook": "file name without extension",
 // saisie_web only:
 "form_url": "address of the entry form in the web application (from the recording)",
 "record": "what is entered, in English (e.g. the supplier invoice)",
 "fields": ["form fields filled once, as labelled on screen"],
 "line_fields": ["columns of the table rows filled (e.g. invoice lines), [] if none"],
 "source_hint": "word found in the source document file names (e.g. facture, INV), \"\" if unknown"}"""


def collect(session: Path) -> dict:
    st = json.loads((session / "discovery.json").read_text(encoding="utf-8"))
    spec = json.loads((session / "twin" / "spec.json").read_text(encoding="utf-8"))
    cand = json.loads((ROOT / "workflows" / "candidates.json").read_text(encoding="utf-8")).get("workflows", [{}])[0]
    last = json.loads((ROOT / "workflows" / "last_run.json").read_text(encoding="utf-8"))
    ocr = last.get("ocr_transcript", "")
    urls = sorted(set(re.findall(r"(?:https?://)?(?:www\.)?[a-z0-9-]+\.(?:fr|com|net|org|eu|io)/[^\s|«»\"]{4,}", ocr)))
    titles = []
    p = session / "actions.jsonl"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                w = json.loads(line).get("window") or ""
            except ValueError:
                continue
            if w and w not in titles:
                titles.append(w)
    cols = list((spec.get("expected") or {}).get("rows", [{}])[0].keys())
    return {"task": cand.get("name"), "steps": cand.get("steps", []), "items": spec.get("items") or [],
            "columns": cols, "urls": urls[:60], "windows": titles[:40], "question": st.get("question")}


def build(session: Path) -> Path:
    info = collect(session)
    r = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=2500, temperature=0,
        messages=[{"role": "system", "content": PROMPT}, {"role": "user", "content": json.dumps(info, ensure_ascii=False)}],
        extra_body={"reasoning_effort": "low"})
    raw = (r.choices[0].message.content or "").strip()
    raw = fenced(raw, "json") or raw[raw.find("{"): raw.rfind("}") + 1]
    m = json.loads(raw)
    if m.get("pattern") == "saisie_web":
        return save(session, info, m, saisie_blocks(m))
    cols = m.get("columns") or info["columns"]
    items = [i for i in m.get("items", []) if str(i.get("url", "")).startswith("http")]
    if not items:
        raise SystemExit("Aucune adresse de page retrouvée dans l'enregistrement : impossible de construire la lecture.")
    blocks = [{"type": "holo_web", "name": f"Lire « {i['label'][:40]} »", "url": i["url"], "label": i["label"],
               "columns": cols} for i in items]
    blocks.append({"type": "rows_from", "name": "Préparer les lignes", "sources": [b["name"] for b in blocks]})
    blocks.append({"type": "excel_append", "name": f"Écrire dans {m.get('workbook') or 'le classeur'}.xlsx",
                   "workbook": m.get("workbook") or ""})
    return save(session, info, m, blocks, "holo_web + excel")


def saisie_blocks(m: dict) -> list[dict]:
    """Document du poste -> Holo saisit dans le logiciel web sans API (navigateur invisible) -> vérification à l'écran."""
    if not str(m.get("form_url", "")).startswith("http"):
        raise SystemExit("Adresse du formulaire de saisie introuvable dans l'enregistrement.")
    return [{"type": "source_read", "name": "Lire le document à saisir", "columns": m.get("fields") or [],
             "line_columns": m.get("line_fields") or [], "pattern": m.get("source_hint") or ""},
            {"type": "holo_fill", "name": "Saisir et vérifier (Holo, invisible)", "url": m["form_url"],
             "label": m.get("record") or "the record"}]


def save(session: Path, info: dict, m: dict, blocks: list, mode: str = "source + holo_fill") -> Path:
    name = m.get("name") or info["task"] or "Automatisation"
    slug = re.sub(r"[^a-z0-9]+", "", name.lower().encode("ascii", "ignore").decode())
    plan = {"id": ("twiin" + slug)[:16], "name": name, "blocks": blocks, "schedule_cron": None,
            "source": {"session": session.name, "mode": mode}}
    out = ROOT / "automation" / "plans" / f"{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}-sans-gene.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


if __name__ == "__main__":
    print(build(Path(sys.argv[1]).resolve()))
