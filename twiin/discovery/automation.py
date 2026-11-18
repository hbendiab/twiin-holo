"""Itération « automatisation » : la même tâche faite par un workflow n8n, dans l'environnement de test.

Schéma (celui qu'on proposerait en vrai) :
  déclencheur → un bloc Holo par élément pour LIRE ce que les logiciels sans API affichent
             → un bloc Code qui prépare les lignes → un bloc HTTP qui ÉCRIT par l'API du logiciel cible.

Dans l'environnement de test, tout pointe vers le jumeau :
  - POST <jumeau>/holo     : un agent Holo lit les valeurs demandées DANS LE JUMEAU et les rend en JSON ;
  - POST <jumeau>/api/rows : fausse API du tableur (elle garde les lignes reçues, comparées à l'état attendu).
Le workflow est créé dans le n8n LOCAL, préfixé « Twiin test — », INACTIF, exécuté une fois en mode test via le MCP
de n8n (même méthode que automation/n8n_twiin.py), puis supprimé.
Connexion n8n : environnement LOCAL de n8ncli (~/.n8ncli-global.json), ou N8N_LOCAL_URL / N8N_LOCAL_API_KEY /
N8N_LOCAL_MCP_TOKEN dans l'environnement. Aucune clé n'est écrite dans le dépôt.
"""
import functools
import http.server
import json
import os
import re
import socket
import threading
import time
import urllib.request
from pathlib import Path

from discovery.agent import run_agent


# ---------------------------------------------------------------- connexion au n8n local

def n8n_conf() -> dict:
    url, key, tok = os.environ.get("N8N_LOCAL_URL"), os.environ.get("N8N_LOCAL_API_KEY"), os.environ.get("N8N_LOCAL_MCP_TOKEN")
    if not (key and tok):
        try:
            env = json.loads((Path.home() / ".n8ncli-global.json").read_text(encoding="utf-8"))["environments"]["LOCAL"]
            url, key, tok = url or env.get("instanceUrl"), key or env.get("apiKey"), tok or env.get("accessToken")
        except (OSError, KeyError, ValueError):
            pass
    if not (key and tok):
        raise RuntimeError("n8n local non configuré (n8ncli envs edit LOCAL --api-key … --access-token …)")
    return {"url": (url or "http://localhost:5678").rstrip("/"), "key": key, "token": tok}


def rest(conf, method, path, body=None):
    req = urllib.request.Request(conf["url"] + "/api/v1" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"X-N8N-API-KEY": conf["key"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
        return json.loads(b) if b else None


def mcp(conf, tool, args, timeout=900):
    req = urllib.request.Request(conf["url"] + "/mcp-server/http", method="POST",
                                 data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                  "params": {"name": tool, "arguments": args}}).encode(),
                                 headers={"Authorization": f"Bearer {conf['token']}", "Content-Type": "application/json",
                                          "Accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        text = r.read().decode("utf-8", errors="replace")
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


# ---------------------------------------------------------------- jumeau + fausse API + pont Holo

class TwinServer:
    def __init__(self, twin_dir: Path, spec: dict, model: str, runs_dir: Path):
        self.rows: list[dict] = []
        self.holo_stats = {"calls": 0, "seconds": 0.0, "blocks": 0}
        outer = self

        class H(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **k):
                super().__init__(*a, directory=str(twin_dir), **k)

            def log_message(self, *a):
                pass

            def _json(self, code, obj):
                b = json.dumps(obj, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                if self.path.startswith("/api/rows"):
                    return self._json(200, {"rows": outer.rows})
                return super().do_GET()

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                if self.path.startswith("/api/rows"):
                    rows = body.get("rows") if isinstance(body.get("rows"), list) else [body]
                    outer.rows.extend(r for r in rows if isinstance(r, dict))
                    return self._json(200, {"ok": True, "count": len(outer.rows)})
                if self.path.startswith("/holo"):
                    return self._json(200, outer.holo_read(body))
                return self._json(404, {"error": "inconnu"})

        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.port}"
        self.spec, self.model, self.runs_dir = spec, model, runs_dir

    def holo_read(self, body: dict) -> dict:
        """Bloc Holo du workflow : lire (sans rien saisir) les colonnes demandées pour l'élément n° item."""
        item, cols = int(body.get("item", 1)), list(body.get("columns") or [])
        label = body.get("label") or f"item number {item} of the task (in the order of the task)"
        mission = (self.spec["mission"] + "\n\n## YOUR JOB IN THIS AUTOMATION STEP\nDo NOT fill any table. Only READ, on screen, "
                   f"the values of {label}: {', '.join(cols)}. Open ITS page first. "
                   "Use note to write them down as you read them. Then call done with summary = ONLY a JSON object with "
                   f"exactly these keys: {json.dumps(cols, ensure_ascii=False)} (values exactly as displayed; "
                   "\"—\" if absent).")
        res = run_agent(f"{self.base}/index.html", mission, self.runs_dir / f"holo-item{item}", self.model, max_steps=20)
        self.holo_stats["calls"] += res["stats"]["calls"]
        self.holo_stats["seconds"] += res["stats"]["seconds"]
        self.holo_stats["blocks"] += 1
        m = re.search(r"\{.*\}", res.get("summary") or "", re.S)
        try:
            data = json.loads(m.group(0)) if m else {}
        except ValueError:
            data = {}
        return {"ok": bool(data), "data": {c: str(data.get(c, "")) for c in cols}, "seconds": res["stats"]["seconds"]}

    def close(self):
        self.srv.shutdown()


# ---------------------------------------------------------------- workflow n8n

def build_workflow(name: str, hook: str, base: str, n: int, cols: list[str], items: list[str] | None = None) -> dict:
    nodes, conns = [], {}
    def add(node):
        nodes.append(node)
        if len(nodes) > 1:
            conns[nodes[-2]["name"]] = {"main": [[{"node": node["name"], "type": "main", "index": 0}]]}
    add({"name": f"POST /{hook}", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
         "webhookId": hook, "parameters": {"httpMethod": "POST", "path": hook, "responseMode": "onReceived"}})
    for i in range(1, n + 1):
        add({"name": f"Holo — lire l'élément {i}", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
             "position": [220 * i, 0],
             "parameters": {"method": "POST", "url": f"{base}/holo", "sendBody": True, "specifyBody": "json",
                            "jsonBody": json.dumps({"item": i, "columns": cols,
                                                    "label": f"the item « {items[i - 1]} »" if items and i <= len(items) else None},
                                                   ensure_ascii=False),
                            "options": {"timeout": 600000}}})
    code = ("const rows = [];\n" + "\n".join(
        f"rows.push($('Holo — lire l\\'élément {i}').first().json.data || {{}});" for i in range(1, n + 1))
            + "\nreturn [{ json: { rows } }];")
    add({"name": "Préparer les lignes", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220 * (n + 1), 0],
         "parameters": {"jsCode": code}})
    add({"name": "Écrire par l'API du tableur", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
         "position": [220 * (n + 2), 0],
         "parameters": {"method": "POST", "url": f"{base}/api/rows", "sendBody": True, "specifyBody": "json",
                        "jsonBody": "={{ JSON.stringify({ rows: $json.rows }) }}"}})
    return {"name": name, "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1", "availableInMCP": True}}


def run_automation(spec: dict, twin_dir: Path, runs_dir: Path, model: str, columns: list[str], n: int) -> dict:
    # éléments à traiter, tels que la tâche les nomme (ex. les 3 sites) : liste du jumeau, sinon 1re colonne attendue
    rows = (spec.get("expected") or {}).get("rows") or []
    items = spec.get("items") or ([str(r.get(columns[0], "")) for r in rows] if columns else None)
    """Crée le workflow dans le n8n local, l'exécute une fois contre le jumeau, puis le supprime. Rend l'état final."""
    conf = n8n_conf()
    twin = TwinServer(twin_dir, spec, model, runs_dir)
    t0 = time.time()
    wid = None
    try:
        hook = f"twiin-test-{int(t0)}"
        wf = build_workflow(f"Twiin test — {spec.get('cadrage', {}).get('objectif', 'tâche')[:40]}", hook, twin.base, n,
                            columns, items)
        try:
            created = rest(conf, "POST", "/workflows", wf)
        except urllib.error.HTTPError:  # réglage inconnu de cette version : on le retire
            wf["settings"] = {"executionOrder": "v1"}
            created = rest(conf, "POST", "/workflows", wf)
        wid = created["id"]
        res, err = mcp(conf, "execute_workflow", {"workflowId": wid, "executionMode": "manual",
                                                  "triggerNodeName": f"POST /{hook}",
                                                  "inputs": {"webhookData": {"method": "POST", "body": {"source": "Twiin"}}}})
        if err:
            raise RuntimeError(f"exécution refusée par n8n : {str(res)[:200]}")
        exec_id = res.get("executionId") if isinstance(res, dict) else None
        status = None
        for _ in range(400):
            det, _e = mcp(conf, "get_workflow_execution", {"workflowId": wid, "executionId": str(exec_id)}, timeout=60)
            status = (det.get("status") or (det.get("execution") or {}).get("status")) if isinstance(det, dict) else None
            if status and status not in ("running", "new", "waiting"):
                break
            time.sleep(3)
        return {"state": {"rows": twin.rows}, "status": status, "workflow_id": wid,
                "seconds": round(time.time() - t0, 1), "holo": twin.holo_stats}
    finally:
        twin.close()
        if wid:
            try:
                rest(conf, "DELETE", f"/workflows/{wid}")
            except Exception:  # noqa: BLE001
                pass
