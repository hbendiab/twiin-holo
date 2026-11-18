#!/usr/bin/env python3
"""Twiin → n8n : compile un PLAN d'automatisation en workflow n8n, l'importe dans le n8n local et le teste une fois.

    .venv/bin/python automation/n8n_twiin.py plan.json            # compile + importe + exécute une fois
    .venv/bin/python automation/n8n_twiin.py plan.json --no-run   # compile + importe seulement

Un plan est une liste de blocs enchaînés, après un déclencheur (à la main + planification facultative) :
  {"type": "holo", "name": "...", "steps": ["..."], "expect": {"cle": "description"}}
      → nœud HTTP vers le serveur Twiin local (/api/holo/run) : Holo fait les étapes sur ce Mac, sa réponse revient
        dans n8n ; avec "expect", les valeurs lues sont dans  data.<cle>.
        Dans les étapes, {{Nom du nœud.cle}} est remplacé par une valeur lue par un bloc Holo précédent.
  {"type": "row", "name": "...", "fields": {"Colonne": "texte avec {{Nom du nœud.cle}}, {{today}}, {{execution}}"}}
      → nœud Code qui prépare une ligne.
  {"type": "sheets_append", "name": "...", "sheet": "veille" | "factures" | "<id du Google Sheet>", "columns": [...]}
      → nœud Google Sheets (connexion « Google Sheets account » du n8n local).
  {"type": "http", "name": "...", "method": "GET", "url": "...", "headers": {...}}
      → nœud HTTP Request (ex. vérifier dans l'API de comptarex).

Les workflows Twiin sont préfixés « Twiin — » et créés INACTIFS : l'activation reste une décision de l'utilisateur.
"""
import argparse
import json
import re
import secrets
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
ENV = dotenv_values(ROOT / ".env")
for _k in ("N8N_LOCAL_URL", "N8N_LOCAL_API_KEY", "N8N_LOCAL_MCP_TOKEN", "TWIIN_LOCAL_TOKEN"):  # variables du serveur
    if not ENV.get(_k) and __import__("os").environ.get(_k):
        ENV[_k] = __import__("os").environ[_k]
try:  # sinon, l'environnement LOCAL de n8ncli (n8ncli envs edit LOCAL …) : même clé et même jeton
    _l = json.loads((Path.home() / ".n8ncli-global.json").read_text(encoding="utf-8"))["environments"]["LOCAL"]
    ENV.setdefault("N8N_LOCAL_URL", _l.get("instanceUrl"))
    if not ENV.get("N8N_LOCAL_API_KEY"):
        ENV["N8N_LOCAL_API_KEY"] = _l.get("apiKey")
    if not ENV.get("N8N_LOCAL_MCP_TOKEN"):
        ENV["N8N_LOCAL_MCP_TOKEN"] = _l.get("accessToken")
except (OSError, KeyError, ValueError):
    pass
if not ENV.get("TWIIN_LOCAL_TOKEN"):  # même jeton que le serveur Twiin (créé par lui, gardé sur le poste)
    try:
        ENV["TWIIN_LOCAL_TOKEN"] = (ROOT / "workflows" / "runs" / ".twiin_local_token").read_text(encoding="utf-8").strip()
    except OSError:
        pass
N8N_DB = Path.home() / ".n8n" / "database.sqlite"
TWIIN_URL = "http://127.0.0.1:3000/api/holo/run"
SHEETS = {"veille": ENV.get("N8N_SHEET_VEILLE_ID"), "factures": ENV.get("N8N_SHEET_FACTURES_ID")}
SHEET_TABS = {"veille": ENV.get("N8N_SHEET_VEILLE_GID") or "0", "factures": ENV.get("N8N_SHEET_FACTURES_GID") or "0"}
PLACEHOLDER = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
EVENTS = None  # fichier .jsonl lu en direct par la page Twiin (--events)


def ev(kind, **data):
    line = json.dumps({"type": kind, **data}, ensure_ascii=False)
    print(line, flush=True)
    if EVENTS:
        with open(EVENTS, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def sheets_credential():
    """Référence (id + nom, jamais le secret) de la connexion Google Sheets du n8n local."""
    con = sqlite3.connect(N8N_DB)
    row = con.execute("select id, name from credentials_entity where type='googleSheetsOAuth2Api' limit 1").fetchone()
    con.close()
    if not row:
        raise SystemExit("Aucune connexion Google Sheets dans n8n : ajoute-la dans n8n (Credentials) puis relance.")
    return {"googleSheetsOAuth2Api": {"id": row[0], "name": row[1]}}


def js_template(text):
    """« Veille – {{Holo — lire.entreprise}} » → template JS n8n qui lit la valeur du nœud Holo précédent."""
    def repl(m):
        ref = m.group(1)
        if ref == "today":
            return "${$now.toFormat('dd/MM/yyyy')}"
        if ref == "execution":
            return "${$execution.id}"
        node, _, key = ref.rpartition(".")
        return "${(($('" + node.replace("'", "\\'") + "').first().json.data || {})['" + key + "'] ?? '')}"
    esc = text.replace("\\", "\\\\").replace("`", "\\`")
    return "`" + PLACEHOLDER.sub(repl, esc) + "`"


def node(name, ntype, version, params, x, creds=None):
    n = {"parameters": params, "id": secrets.token_hex(8), "name": name, "type": ntype, "typeVersion": version,
         "position": [x, 300]}
    if creds:
        n["credentials"] = creds
    return n


def compile_plan(plan):
    token = ENV.get("TWIIN_LOCAL_TOKEN") or ""
    nodes, x = [], 0
    # UN seul déclencheur actif : le webhook (tests avec n8ncli exec, lancement depuis la page Twiin).
    # La planification éventuelle est ajoutée DÉSACTIVÉE : l'utilisateur l'allume en activant l'automatisation.
    wid = plan.get("id") or secrets.token_hex(8)[:16]
    plan["id"] = wid
    trigger = f"POST /twiin-{wid}"
    nodes.append(node(trigger, "n8n-nodes-base.webhook", 2,
                      {"httpMethod": "POST", "path": f"twiin-{wid}", "responseMode": "lastNode", "options": {}}, x))
    nodes[-1]["webhookId"] = f"twiin-{wid}"
    if plan.get("schedule_cron"):
        nodes.append(node("Planification Hebdomadaire", "n8n-nodes-base.scheduleTrigger", 1.2,
                          {"rule": {"interval": [{"field": "cronExpression", "expression": plan["schedule_cron"]}]}}, x))
        nodes[-1]["position"] = [x, 120]
        nodes[-1]["disabled"] = True
    chain = []
    for b in plan["blocks"]:
        x += 300
        t = b["type"]
        if t == "holo":
            steps_js = "[" + ", ".join(js_template(s) for s in b["steps"]) + "]"
            body = ("={{ JSON.stringify({ name: " + json.dumps(b["name"]) + ", steps: " + steps_js +
                    ", expect: " + json.dumps(b.get("expect") or {}, ensure_ascii=False) + " }) }}")
            nodes.append(node(b["name"], "n8n-nodes-base.httpRequest", 4.2, {
                "method": "POST", "url": TWIIN_URL,
                "sendHeaders": True, "headerParameters": {"parameters": [{"name": "x-twiin-token", "value": token}]},
                "sendBody": True, "specifyBody": "json", "jsonBody": body,
                "options": {"timeout": 1500000, "response": {"response": {"responseFormat": "json"}}},
            }, x))
        elif t in ("holo_web", "excel_append"):
            # Blocs « sans gêner l'employé » : Holo lit une page web dans un navigateur INVISIBLE ; l'écriture dans un
            # classeur Excel du poste se fait par fichier, sans Holo. Les deux passent par le serveur Twiin local (jeton).
            if t == "holo_web":
                url = TWIIN_URL.replace("/api/holo/run", "/api/holo/web")
                body = json.dumps({"url": b["url"], "label": b.get("label") or b["name"], "columns": b["columns"]}, ensure_ascii=False)
            else:
                url = TWIIN_URL.replace("/api/holo/run", "/api/excel/write")
                body = ("={{ JSON.stringify({ path: " + json.dumps(b.get("path") or "", ensure_ascii=False) + ", name: "
                        + json.dumps(b.get("workbook") or "", ensure_ascii=False) + ", rows: $json.rows }) }}")
            nodes.append(node(b["name"], "n8n-nodes-base.httpRequest", 4.2, {
                "method": "POST", "url": url,
                "sendHeaders": True, "headerParameters": {"parameters": [{"name": "x-twiin-token", "value": token}]},
                "sendBody": True, "specifyBody": "json", "jsonBody": body,
                "options": {"timeout": 600000, "response": {"response": {"responseFormat": "json"}}},
            }, x))
        elif t == "rows_from":
            src = ", ".join("$(" + json.dumps(n, ensure_ascii=False) + ").first().json.data || {}" for n in b["sources"])
            code = (f"const rows = [{src}];\n"
                    "return [{ json: { rows: rows.filter((r) => Object.values(r).some((v) => v && v !== '—')) } }];")
            nodes.append(node(b["name"], "n8n-nodes-base.code", 2, {"jsCode": code}, x))
            nodes[-1]["notes"] = "Rassemble les valeurs lues sur chaque page en lignes de tableau."
        elif t == "row":
            lines = ",\n  ".join(f"{json.dumps(k, ensure_ascii=False)}: {js_template(v)}" for k, v in b["fields"].items())
            nodes.append(node(b["name"], "n8n-nodes-base.code", 2, {"jsCode": f"return [{{ json: {{\n  {lines}\n}} }}];"}, x))
            nodes[-1]["notes"] = "Prépare la ligne à écrire à partir des valeurs lues par Holo."
        elif t == "verify":
            # Vérification des valeurs avant écriture : présentes, au bon format, sans faute. Résultat dans « Vérification ».
            rules = json.dumps(b.get("rules") or {}, ensure_ascii=False)
            code = (
                f"const rules = {rules};\n"
                "const row = { ...$json };\n"
                "const problems = [];\n"
                "for (const [col, r] of Object.entries(rules)) {\n"
                "  const v = String(row[col] ?? '').trim();\n"
                "  if (r.required && (!v || /non trouvé/i.test(v))) { problems.push(`${col} vide`); continue; }\n"
                "  if (v && r.pattern && !new RegExp(r.pattern, 'i').test(v)) problems.push(`${col} : format inattendu « ${v} »`);\n"
                "  for (const f of r.forbid || []) if (v.toLowerCase().includes(f.toLowerCase())) problems.push(`${col} : « ${f} » interdit`);\n"
                "}\n"
                "row['Vérification'] = problems.length ? '⚠️ ' + problems.join(' ; ') : '✅ OK';\n"
                "return [{ json: row }];"
            )
            nodes.append(node(b["name"], "n8n-nodes-base.code", 2, {"jsCode": code}, x))
            nodes[-1]["notes"] = "Vérifie chaque valeur lue par Holo avant de l'écrire (règles : présente, format, mots interdits)."
            nodes[-1]["notesInFlow"] = True
        elif t == "sheets_append":
            doc = SHEETS.get(b["sheet"], b["sheet"])
            cols = b.get("columns") or []
            nodes.append(node(b["name"], "n8n-nodes-base.googleSheets", 4.4, {
                "operation": "append",
                "documentId": {"__rl": True, "mode": "id", "value": doc},
                "sheetName": {"__rl": True, "mode": "id", "value": str(b.get("tab") or SHEET_TABS.get(b["sheet"], "0"))},
                "columns": {"mappingMode": "defineBelow",
                            "value": {c: "={{ $json[" + json.dumps(c, ensure_ascii=False) + "] }}" for c in cols},
                            "matchingColumns": [],
                            "schema": [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True,
                                        "type": "string", "canBeUsedToMatch": True} for c in cols]},
                "options": {},
            }, x, sheets_credential()))
        elif t == "http":
            p = {"method": b.get("method", "GET"), "url": b["url"], "options": {"timeout": 60000}}
            if b.get("auth") == "comptarex":  # jeton admin de comptarex (lecture de la vérité, jamais affiché)
                ctx = dotenv_values(ROOT.parent / "comptarex" / ".env")
                b.setdefault("headers", {})["X-Admin-Token"] = ctx.get("SITE_ADMIN_TOKEN", "")
            if b.get("headers"):
                p["sendHeaders"] = True
                p["headerParameters"] = {"parameters": [{"name": k, "value": v} for k, v in b["headers"].items()]}
            nodes.append(node(b["name"], "n8n-nodes-base.httpRequest", 4.2, p, x))
        else:
            raise SystemExit(f"Type de bloc inconnu : {t}")
        chain.append(b["name"])
    connections = {}
    starts = [trigger] + (["Planification Hebdomadaire"] if plan.get("schedule_cron") else [])
    for s in starts:
        connections[s] = {"main": [[{"node": chain[0], "type": "main", "index": 0}]]}
    for a, b in zip(chain, chain[1:]):
        connections[a] = {"main": [[{"node": b, "type": "main", "index": 0}]]}
    return {"id": plan.get("id") or secrets.token_hex(8)[:16], "name": "Twiin — " + plan["name"], "nodes": nodes,
            "connections": connections, "active": False, "settings": {"executionOrder": "v1", "timezone": "Europe/Paris", "availableInMCP": True}, "pinData": {}}


def mcp(tool, args, timeout=1800):
    """Appelle un outil du serveur MCP du n8n local (celui qu'utilise n8ncli), avec le jeton N8N_LOCAL_MCP_TOKEN."""
    import requests
    r = requests.post((ENV.get("N8N_LOCAL_URL") or "http://localhost:5678") + "/mcp-server/http", timeout=timeout,
                      headers={"Authorization": f"Bearer {ENV.get('N8N_LOCAL_MCP_TOKEN', '').strip()}",
                               "Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
                      json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}})
    text = r.content.decode("utf-8", errors="replace")
    payload = next((l[6:] for l in text.splitlines() if l.startswith("data: ")), text)
    d = json.loads(payload)
    if "error" in d:
        raise RuntimeError(f"MCP {tool} : {d['error'].get('message')}")
    res = d.get("result", {})
    out = "".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
    try:
        return json.loads(out), res.get("isError", False)
    except json.JSONDecodeError:
        return out, res.get("isError", False)


def execute_mcp(wid, body=None):
    """Exécute le workflow en mode test (« manual ») par son webhook, via le MCP de n8n, puis attend le résultat."""
    import time
    res, err = mcp("execute_workflow", {"workflowId": wid, "executionMode": "manual", "triggerNodeName": f"POST /twiin-{wid}",
                                        "inputs": {"webhookData": {"method": "POST", "body": body or {"source": "Twiin"}}}})
    if err:
        return False, res, None
    exec_id = (res or {}).get("executionId") if isinstance(res, dict) else None
    ev("executing", execution=exec_id, url=f"{ENV.get('N8N_LOCAL_URL') or 'http://localhost:5678'}/workflow/{wid}/executions/{exec_id}")
    seen = set()
    for _ in range(1200):
        if not exec_id:
            break
        try:
            full, _e = mcp("get_workflow_execution", {"workflowId": wid, "executionId": str(exec_id), "includeData": True,
                                                      "truncateData": 3}, timeout=60)
            run = (((full or {}).get("data") or {}).get("resultData") or {}).get("runData") or {}
            for name, runs in run.items():
                if name in seen or not runs:
                    continue
                seen.add(name)
                last = runs[-1]
                items = (((last.get("data") or {}).get("main") or [[]])[0]) or []
                out = items[0].get("json") if items else None
                ev("node", name=name, status=last.get("executionStatus"), ms=last.get("executionTime"),
                   output=json.dumps(out, ensure_ascii=False)[:600] if out is not None else None,
                   error=(last.get("error") or {}).get("message"))
        except Exception as e:  # noqa: BLE001
            ev("info", text=f"suivi indisponible : {e}")
        det, _e = mcp("get_workflow_execution", {"workflowId": wid, "executionId": str(exec_id)})
        if isinstance(det, dict):
            status = det.get("status") or (det.get("execution") or {}).get("status")
        else:
            status = None
        if status and status not in ("running", "new", "waiting"):
            return status == "success", det, exec_id
        time.sleep(3)
    return isinstance(res, dict) and res.get("status") == "success", res, exec_id


def ensure_header(sheet_key, column_letter, title):
    """Écrit « title » dans la cellule d'en-tête (ex. I1) d'une feuille de test, via la connexion Google de n8n."""
    doc = SHEETS.get(sheet_key, sheet_key)
    wid = "twiinHeaderTool1"
    wf = {"id": wid, "name": "Twiin — (outil) en-tête de colonne", "active": False,
          "settings": {"executionOrder": "v1", "availableInMCP": True}, "pinData": {},
          "nodes": [node(f"POST /twiin-{wid}", "n8n-nodes-base.webhook", 2,
                         {"httpMethod": "POST", "path": f"twiin-{wid}", "responseMode": "lastNode", "options": {}}, 0),
                    node("Ecrire En-Tete", "n8n-nodes-base.httpRequest", 4.2, {
                        "method": "PUT", "authentication": "predefinedCredentialType", "nodeCredentialType": "googleSheetsOAuth2Api",
                        "url": f"https://sheets.googleapis.com/v4/spreadsheets/{doc}/values/{column_letter}1?valueInputOption=RAW",
                        "sendBody": True, "specifyBody": "json", "jsonBody": json.dumps({"values": [[title]]}), "options": {}},
                         300, sheets_credential())],
          "connections": {f"POST /twiin-{wid}": {"main": [[{"node": "Ecrire En-Tete", "type": "main", "index": 0}]]}}}
    wf["nodes"][0]["webhookId"] = f"twiin-{wid}"
    import_workflow(wf)
    return execute_mcp(wid)[0]


def run_cli(args, timeout=3600):
    import shutil
    exe = shutil.which("n8n") or "n8n"  # Windows : n8n.cmd (npm global), introuvable sous le simple nom « n8n »
    r = subprocess.run([exe, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def import_workflow(wf):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False)
    code, out, err = run_cli(["import:workflow", f"--input={f.name}"])
    if code != 0:
        raise SystemExit(f"Import n8n impossible :\n{(err or out)[-800:]}")
    return wf["id"]


def execute(wid):
    # le serveur n8n déjà lancé occupe le port 5679 du « task broker » : l'exécution en ligne de commande en prend un autre
    import os
    r = subprocess.run(["n8n", "execute", f"--id={wid}", "--rawOutput"], capture_output=True, text=True, timeout=3600,
                       env={**os.environ, "N8N_RUNNERS_BROKER_PORT": "5690"})
    code, out, err = r.returncode, r.stdout, r.stderr
    text = out.strip()
    try:
        return code == 0, json.loads(text[text.find("{") if "{" in text else 0:]) if text else None, (err or out)[-1500:]
    except json.JSONDecodeError:
        return code == 0, None, (err or out)[-1500:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path, nargs="?")
    ap.add_argument("--no-run", action="store_true")
    ap.add_argument("--run", metavar="WORKFLOW_ID", help="lance seulement une automatisation déjà importée (page « Mes automatisations »)")
    ap.add_argument("--events", help="fichier .jsonl de progression (page Twiin)")
    a = ap.parse_args()
    global EVENTS
    EVENTS = a.events
    if a.run:
        ok, result, exec_id = execute_mcp(a.run)
        ev("done", ok=ok, id=a.run, execution=exec_id, status="success" if ok else "error")
        sys.exit(0 if ok else 1)
    plan = json.loads(a.plan.read_text())
    wf = compile_plan(plan)
    ev("compiled", id=wf["id"], name=wf["name"],
       nodes=[{"name": n["name"], "type": n["type"].split(".")[-1], "disabled": n.get("disabled", False)} for n in wf["nodes"]])
    out = ROOT / "automation" / "workflows"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{wf['id']}.json").write_text(json.dumps(wf, ensure_ascii=False, indent=2))
    wid = import_workflow(wf)
    ev("imported", id=wid, name=wf["name"], url=f"{ENV.get('N8N_LOCAL_URL') or 'http://localhost:5678'}/workflow/{wid}")
    if a.no_run:
        return
    ok, result, exec_id = execute_mcp(wid)
    status = ((result or {}).get("execution") or {}).get("status") if isinstance(result, dict) else None
    ev("done", ok=ok, id=wid, execution=exec_id, status=status or ("success" if ok else "error"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
