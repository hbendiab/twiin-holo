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
        """Bloc Holo du workflow : lire (sans rien saisir) les colonnes demandées pour l'élément n° item,
        ou pour TOUS les éléments d'un coup si body["all"]."""
        if body.get("all"):
            return self.holo_read_all(body)
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

    def holo_read_all(self, body: dict) -> dict:
        cols, items = list(body.get("columns") or []), list(body.get("items") or [])
        mission = (self.spec["mission"] + "\n\n## YOUR JOB IN THIS AUTOMATION STEP\nDo NOT fill any table. Only READ, on screen, "
                   f"for each of these items: {', '.join(items)}, the values: {', '.join(cols)}. Open each item's page, use note "
                   "to write the values down, then call done with summary = ONLY a JSON object "
                   '{"rows": [ {one object per item, keys exactly: ' + json.dumps(cols, ensure_ascii=False) + "} ]}.")
        res = run_agent(f"{self.base}/index.html", mission, self.runs_dir / "holo-all", self.model, max_steps=40)
        self.holo_stats["calls"] += res["stats"]["calls"]
        self.holo_stats["seconds"] += res["stats"]["seconds"]
        self.holo_stats["blocks"] += 1
        m = re.search(r"\{.*\}", res.get("summary") or "", re.S)
        try:
            rows = json.loads(m.group(0)).get("rows", []) if m else []
        except ValueError:
            rows = []
        return {"ok": bool(rows), "rows": [{c: str(r.get(c, "")) for c in cols} for r in rows if isinstance(r, dict)]}

    def close(self):
        self.srv.shutdown()


# ---------------------------------------------------------------- workflow n8n

def _chain(nodes_spec):
    nodes, conns = [], {}
    for i, node in enumerate(nodes_spec):
        node.setdefault("position", [220 * i, 0])
        nodes.append(node)
        if i:
            conns[nodes[i - 1]["name"]] = {"main": [[{"node": node["name"], "type": "main", "index": 0}]]}
    return nodes, conns


def _hook(hook):
    return {"name": f"POST /{hook}", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "webhookId": hook,
            "parameters": {"httpMethod": "POST", "path": hook, "responseMode": "onReceived"}}


def _post(name, url, body_expr):
    return {"name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
            "parameters": {"method": "POST", "url": url, "sendBody": True, "specifyBody": "json", "jsonBody": body_expr,
                           "options": {"timeout": 600000}}}


def _write(base):
    return _post("Écrire par l'API du tableur", f"{base}/api/rows", "={{ JSON.stringify({ rows: $json.rows }) }}")


def build_workflow(variant: str, name: str, hook: str, base: str, cols: list[str], items: list[str], native: dict | None) -> dict:
    """Quatre constructions possibles, deux par mode :
      n8n natif   : natif_html (HTTP + nœud HTML à sélecteurs CSS) / natif_code (HTTP + bloc Code qui analyse la page)
      n8n + Holo  : holo_par_element (un bloc Holo par élément) / holo_un_bloc (un seul bloc Holo pour tout)"""
    n = len(items)
    chain = [_hook(hook)]
    if variant == "holo_par_element":
        for i, it in enumerate(items, 1):
            chain.append(_post(f"Holo — lire « {it[:30]} »", f"{base}/holo",
                               json.dumps({"item": i, "columns": cols, "label": f"the item « {it} »"}, ensure_ascii=False)))
        code = "const rows = [];\n" + "\n".join(
            f"rows.push($({json.dumps(c['name'], ensure_ascii=False)}).first().json.data || {{}});" for c in chain[1:]) \
            + "\nreturn [{ json: { rows } }];"
        chain.append({"name": "Préparer les lignes", "type": "n8n-nodes-base.code", "typeVersion": 2, "parameters": {"jsCode": code}})
    elif variant == "holo_un_bloc":
        chain.append(_post("Holo — lire tous les éléments", f"{base}/holo",
                           json.dumps({"all": True, "columns": cols, "items": items}, ensure_ascii=False)))
    else:
        chain.append({"name": "Lire la page (HTTP)", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
                      "parameters": {"method": "GET", "url": f"{base}/index.html",
                                     "options": {"response": {"response": {"responseFormat": "text", "outputPropertyName": "data"}}}}})
        if variant == "natif_html":
            sel = (native or {}).get("selectors") or {}
            chain.append({"name": "Extraire (sélecteurs CSS)", "type": "n8n-nodes-base.html", "typeVersion": 1.2,
                          "parameters": {"operation": "extractHtmlContent", "sourceData": "json", "dataPropertyName": "data",
                                         "extractionValues": {"values": [{"key": k, "cssSelector": v, "returnValue": "text"}
                                                                         for k, v in sel.items()]},
                                         "options": {"trimValues": True}}})
            code = ("const j = $json; const rows = [];\n"
                    f"for (let i = 1; i <= {n}; i++) {{ const r = {{}}; for (const c of {json.dumps(cols, ensure_ascii=False)}) "
                    "r[c] = j[`r${i}_${c}`] ?? ''; rows.push(r); }\nreturn [{ json: { rows } }];")
            chain.append({"name": "Préparer les lignes", "type": "n8n-nodes-base.code", "typeVersion": 2, "parameters": {"jsCode": code}})
        else:  # natif_code
            js = (native or {}).get("js") or "return [];"
            code = ("const html = $json.data || '';\nconst extract = (html) => {\n" + js + "\n};\n"
                    "return [{ json: { rows: extract(html) } }];")
            chain.append({"name": "Analyser la page (Code)", "type": "n8n-nodes-base.code", "typeVersion": 2, "parameters": {"jsCode": code}})
    chain.append(_write(base))
    nodes, conns = _chain(chain)
    return {"name": name, "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1", "availableInMCP": True}}


NATIVE_PROMPT = """You prepare an n8n automation that reads a web page WITHOUT any computer-use agent: n8n downloads the raw
HTML (as served, before any JavaScript runs) and extracts values. Items to process (in order): ITEMS. Columns: COLS.
Return ONLY JSON:
{"selectors": {"r1_<column>": "CSS selector of the element whose text is that value", ...one key per item i and column},
 "js": "body of a JavaScript function (html) { ... } that returns an array of row objects keyed by the columns, using only
        string / regex operations (no DOM available)",
 "lisible": true if the values are present in the raw HTML, false if they only appear after JavaScript runs}"""


def native_plan(spec: dict, html: str, cols: list[str], items: list[str]) -> dict:
    from discovery.discovery import HF_MODEL, fenced, hf_client
    prompt = NATIVE_PROMPT.replace("ITEMS", ", ".join(items)).replace("COLS", ", ".join(cols))
    r = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=6000, temperature=0.1,
        messages=[{"role": "system", "content": prompt}, {"role": "user", "content": html[:60000]}],
        extra_body={"reasoning_effort": "low"})
    raw = (r.choices[0].message.content or "").strip()
    raw = fenced(raw, "json") or raw[raw.find("{"): raw.rfind("}") + 1]
    return json.loads(raw)


def run_automation(spec: dict, twin_dir: Path, runs_dir: Path, model: str, columns: list[str], n: int,
                   variant: str = "holo_par_element", native: dict | None = None) -> dict:
    """Crée le workflow dans le n8n local, l'exécute une fois contre le jumeau, puis le supprime. Rend l'état final."""
    rows = (spec.get("expected") or {}).get("rows") or []
    items = spec.get("items") or ([str(r.get(columns[0], "")) for r in rows] if columns else [])
    items = items[:n] if n else items
    conf = n8n_conf()
    twin = TwinServer(twin_dir, spec, model, runs_dir / variant)
    t0 = time.time()
    wid = None
    try:
        hook = f"twiin-test-{variant}-{int(t0)}"
        wf = build_workflow(variant, f"Twiin test — {variant}", hook, twin.base, columns, items, native)
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
            time.sleep(2)
        return {"state": {"rows": twin.rows}, "status": status, "workflow_id": wid, "variant": variant,
                "seconds": round(time.time() - t0, 1), "holo": twin.holo_stats, "nodes": [x["name"] for x in wf["nodes"]]}
    finally:
        twin.close()
        if wid:
            try:
                rest(conf, "DELETE", f"/workflows/{wid}")
            except Exception:  # noqa: BLE001
                pass
