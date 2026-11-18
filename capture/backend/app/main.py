"""Twiin — brique OBSERVER (Audit + Capture), backend FastAPI.

Reçoit les enregistrements de l'extension Chrome, transcrit la narration avec Gladia,
fusionne tout en une timeline d'étapes (session.json + skill.md), inventorie les outils vus
(audit.json), et pousse le résultat vers H Company.

Repris de Show Me Once (Jean-Christophe Dorn), chargebacks/chrome_cast/backend.
"""
import base64
import json
import re
import secrets
import shutil
import traceback
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import audit as audit_mod
from . import config, gladia, hcompany, merge

app = FastAPI(title="Twiin — Observer", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/files", StaticFiles(directory=config.DATA_DIR), name="files")

STATIC = Path(__file__).parent / "static"
ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


# ---------- helpers ----------

def check_key(x_twiin_key: str = Header(default="")):
    if config.TWIIN_API_KEY and not secrets.compare_digest(x_twiin_key, config.TWIIN_API_KEY):
        raise HTTPException(401, "clé X-Twiin-Key invalide")


def rec_dir(rec_id: str) -> Path:
    if not ID_RE.match(rec_id):
        raise HTTPException(400, "id invalide")
    d = config.DATA_DIR / rec_id
    if not d.is_dir():
        raise HTTPException(404, "enregistrement introuvable")
    return d


def read_json(p: Path, default=None):
    return json.loads(p.read_text()) if p.exists() else default


def write_json(p: Path, data) -> None:
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def set_status(d: Path, status: str, **extra) -> None:
    st = read_json(d / "status.json", {})
    st.update(status=status, updated_at=datetime.now(timezone.utc).isoformat(), **extra)
    write_json(d / "status.json", st)


def safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", Path(name).name)


# ---------- pipeline ----------

async def process(rec_id: str) -> None:
    d = config.DATA_DIR / rec_id
    try:
        events = read_json(d / "events.json", [])
        meta = read_json(d / "meta.json", {})

        transcript_raw = read_json(d / "transcript.json")
        audio = d / "audio.webm" if (d / "audio.webm").exists() else d / "video.webm"
        if transcript_raw is None and config.GLADIA_API_KEY and audio.exists():
            set_status(d, "transcribing")
            try:
                transcript_raw = await gladia.transcribe(audio)
                write_json(d / "transcript.json", transcript_raw)
            except gladia.GladiaError as e:
                set_status(d, "transcribing", gladia_error=str(e))
        elif transcript_raw is None and not config.GLADIA_API_KEY:
            set_status(d, "merging", gladia_error="GLADIA_API_KEY absente du .env : narration non transcrite")

        set_status(d, "merging")
        steps = merge.build_steps(events)
        utterances = gladia.utterances(transcript_raw)
        closing = merge.attach_narration(steps, utterances)
        apps = merge.apps_sequence(steps)
        accounts = merge.accounts_needed(events, apps)
        summary = gladia.summary(transcript_raw)
        transcript = gladia.full_transcript(transcript_raw)

        session = {
            "id": rec_id,
            "schema": "twiin/session@1",
            "title": meta.get("title") or f"Twiin — {' → '.join(apps[:4]) or rec_id}",
            "goal": meta.get("goal") or summary or (transcript[:400] if transcript else ""),
            "created_at": meta.get("started_at"),
            "duration_s": meta.get("duration_s"),
            "apps": apps,
            "accounts": accounts,
            "start_url": next((s["url"] for s in steps if not merge.ignored(s.get("url"))), None),
            "transcript": transcript,
            "utterances": utterances,
            "closing_narration": closing,
            "steps": steps,
            "files": {
                "video": "video.webm",
                "audio": "audio.webm" if (d / "audio.webm").exists() else None,
                "screenshots_dir": "screenshots/",
            },
        }
        audit = audit_mod.build_audit(steps, apps, accounts, rec_dir=d)
        session["audit"] = [{k: a[k] for k in ("app", "type", "api", "connector")} for a in audit]
        write_json(d / "audit.json", audit)
        write_json(d / "session.json", session)
        generated = merge.build_skill_markdown(session)
        (d / "skill.generated.md").write_text(generated)
        if not meta.get("skill_edited"):  # une procédure relue/corrigée par l'employé n'est jamais écrasée
            (d / "skill.md").write_text(generated)
        set_status(d, "ready", steps=len(steps), transcribed=bool(transcript_raw),
                   unknown_apps=sum(a["type"] == "inconnu" for a in audit))
    except Exception as e:  # noqa: BLE001
        set_status(d, "error", error=str(e), trace=traceback.format_exc())


# ---------- endpoints : enregistrements ----------

@app.post("/recordings", dependencies=[Depends(check_key)])
async def create_recording(
    background: BackgroundTasks,
    video: UploadFile = File(...),
    audio: UploadFile | None = File(None),
    events: str = Form(...),
    meta: str = Form("{}"),
    screenshots: list[UploadFile] = File(default=[]),
):
    rec_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
    d = config.DATA_DIR / rec_id
    (d / "screenshots").mkdir(parents=True)

    with (d / "video.webm").open("wb") as f:
        shutil.copyfileobj(video.file, f)
    if audio is not None:
        with (d / "audio.webm").open("wb") as f:
            shutil.copyfileobj(audio.file, f)
    for s in screenshots:
        with (d / "screenshots" / safe_name(s.filename or "shot.jpg")).open("wb") as f:
            shutil.copyfileobj(s.file, f)
    write_json(d / "events.json", json.loads(events))
    write_json(d / "meta.json", json.loads(meta))
    set_status(d, "received")

    background.add_task(process, rec_id)
    return {"id": rec_id, "status": "received", "viewer": f"/viewer/{rec_id}"}


@app.post("/recordings/import", dependencies=[Depends(check_key)])
async def import_local_bundle(
    background: BackgroundTasks,
    events_file: UploadFile = File(..., description="twiin-…-events.json (téléchargement local)"),
    video: UploadFile | None = File(None),
    audio: UploadFile | None = File(None),
):
    """Ré-importe un bundle téléchargé en local par l'extension quand l'upload a échoué."""
    bundle = json.loads(await events_file.read())
    rec_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
    d = config.DATA_DIR / rec_id
    (d / "screenshots").mkdir(parents=True)
    events = []
    for e in bundle.get("events", []):
        shot = e.pop("screenshot", None)
        if shot and "," in shot:
            name = f"{safe_name(e['id'])}.jpg"
            (d / "screenshots" / name).write_bytes(base64.b64decode(shot.split(",", 1)[1]))
            e["screenshot_file"] = name
        events.append(e)
    for up, name in ((video, "video.webm"), (audio, "audio.webm")):
        if up is not None:
            with (d / name).open("wb") as f:
                shutil.copyfileobj(up.file, f)
    write_json(d / "events.json", events)
    write_json(d / "meta.json", bundle.get("meta", {}))
    set_status(d, "received")
    background.add_task(process, rec_id)
    return {"id": rec_id, "status": "received"}


@app.get("/recordings")
def list_recordings():
    out = []
    for d in sorted(config.DATA_DIR.iterdir(), reverse=True):
        if d.is_dir():
            s = read_json(d / "session.json", {})
            out.append({"id": d.name, **read_json(d / "status.json", {}), "title": s.get("title"), "apps": s.get("apps")})
    return out


@app.get("/recordings/{rec_id}")
def get_recording(rec_id: str):
    d = rec_dir(rec_id)
    return {"status": read_json(d / "status.json", {}), "session": read_json(d / "session.json")}


@app.get("/recordings/{rec_id}/skill.md", response_class=PlainTextResponse)
def get_skill(rec_id: str):
    p = rec_dir(rec_id) / "skill.md"
    if not p.exists():
        raise HTTPException(409, "pas encore prêt")
    return p.read_text()


@app.get("/recordings/{rec_id}/audit.json")
def get_audit(rec_id: str):
    """Inventaire des plateformes vues pendant la capture (brique Audit)."""
    p = rec_dir(rec_id) / "audit.json"
    if not p.exists():
        raise HTTPException(409, "pas encore prêt")
    return read_json(p)


class SkillEdit(BaseModel):
    body: str | None = None  # None = revenir à la version générée


@app.put("/recordings/{rec_id}/skill.md", dependencies=[Depends(check_key)])
def edit_skill(rec_id: str, req: SkillEdit):
    """L'employé relit et corrige la procédure capturée avant de la confier à l'agent."""
    d = rec_dir(rec_id)
    meta = read_json(d / "meta.json", {})
    if req.body is None or not req.body.strip():
        gen = d / "skill.generated.md"
        if not gen.exists():
            raise HTTPException(409, "pas encore prêt")
        (d / "skill.md").write_text(gen.read_text())
        meta["skill_edited"] = False
    else:
        (d / "skill.md").write_text(req.body)
        meta["skill_edited"] = True
    write_json(d / "meta.json", meta)
    return {"ok": True, "edited": meta["skill_edited"]}


class Patch(BaseModel):
    title: str | None = None
    goal: str | None = None


@app.patch("/recordings/{rec_id}", dependencies=[Depends(check_key)])
async def patch_recording(rec_id: str, body: Patch, background: BackgroundTasks):
    """Corrige le titre / l'objectif puis régénère session.json et skill.md."""
    d = rec_dir(rec_id)
    meta = read_json(d / "meta.json", {})
    meta.update({k: v for k, v in body.model_dump().items() if v is not None})
    write_json(d / "meta.json", meta)
    background.add_task(process, rec_id)
    return {"ok": True}


@app.post("/recordings/{rec_id}/reprocess", dependencies=[Depends(check_key)])
async def reprocess(rec_id: str, background: BackgroundTasks, retranscribe: bool = False):
    d = rec_dir(rec_id)
    if retranscribe:
        (d / "transcript.json").unlink(missing_ok=True)
    background.add_task(process, rec_id)
    return {"ok": True}


# ---------- endpoints : H Company ----------

def _export(rec_id: str) -> dict:
    d = rec_dir(rec_id)
    session = read_json(d / "session.json")
    if not session:
        raise HTTPException(409, "pas encore prêt")
    session = json.loads(config.rewrite_urls(json.dumps(session)))
    session["apps"] = [config.rewrite_host(a) for a in session.get("apps") or []]
    return hcompany.build_h_export(session, config.rewrite_urls((d / "skill.md").read_text()), rec_id)


@app.get("/recordings/{rec_id}/export/h-agent.json")
def export_h_agent(rec_id: str):
    """Fichier agent H : skill + agent, prêt à importer (bouton, script scripts/import_to_h.py, ou API)."""
    exp = _export(rec_id)
    name = exp["agent"]["name"].split("/")[-1]
    return JSONResponse(exp, headers={"Content-Disposition": f'attachment; filename="{name}.h-agent.json"'})


@app.get("/recordings/{rec_id}/export/SKILL.md")
def export_skill_md(rec_id: str):
    exp = _export(rec_id)
    name = exp["skill"]["name"].split("/")[-1]
    return PlainTextResponse(hcompany.skill_file(exp), headers={"Content-Disposition": f'attachment; filename="{name}.SKILL.md"'})


@app.post("/recordings/{rec_id}/hcompany/agent", dependencies=[Depends(check_key)])
async def create_h_agent(rec_id: str):
    """Importe le fichier agent dans H : crée le skill et l'agent dans ton catalogue."""
    exp = _export(rec_id)
    try:
        res = await hcompany.import_export(exp)
    except hcompany.HCompanyError as e:
        raise HTTPException(502, str(e)) from e
    write_json(rec_dir(rec_id) / "hcompany_agent.json", res)
    return res


@app.get("/recordings/{rec_id}/hcompany/auth-check")
async def auth_check(rec_id: str):
    """Pour chaque app de l'enregistrement : l'agent H aura-t-il de quoi se connecter ?"""
    d = rec_dir(rec_id)
    session = read_json(d / "session.json")
    if not session:
        raise HTTPException(409, "pas encore prêt")
    accounts = session.get("accounts") or [{"app": a, "login_seen": False} for a in session.get("apps", [])]
    try:
        return await hcompany.auth_check(accounts)
    except hcompany.HCompanyError as e:
        raise HTTPException(502, str(e)) from e


class SkillReq(BaseModel):
    name: str | None = None
    description: str | None = None


@app.post("/recordings/{rec_id}/hcompany/skill", dependencies=[Depends(check_key)])
async def push_skill(rec_id: str, req: SkillReq):
    """Crée un Skill H Company réutilisable à partir de l'enregistrement."""
    d = rec_dir(rec_id)
    session = read_json(d / "session.json")
    if not session:
        raise HTTPException(409, "pas encore prêt")
    name = req.name or f"twiin-{rec_id.lower()}"
    if config.HAI_SKILL_NAMESPACE and "/" not in name:
        name = f"{config.HAI_SKILL_NAMESPACE}/{name}"
    description = req.description or f"Use when asked to: {(session.get('goal') or session['title'])[:300]}"
    try:
        res = await hcompany.create_skill(name, description, (d / "skill.md").read_text())
    except hcompany.HCompanyError as e:
        raise HTTPException(502, str(e)) from e
    write_json(d / "hcompany_skill.json", res)
    return res


class RunReq(BaseModel):
    agent: str | None = None
    start_url: str | None = None
    instructions: str | None = None  # ex: "Fais-le pour le litige dp_123"
    include_screenshots: bool = True
    max_steps: int | None = None


@app.post("/recordings/{rec_id}/hcompany/run", dependencies=[Depends(check_key)])
async def run_on_hcompany(rec_id: str, req: RunReq):
    """Lance une session d'agent H Company qui rejoue la procédure enregistrée."""
    d = rec_dir(rec_id)
    session = read_json(d / "session.json")
    if not session:
        raise HTTPException(409, "pas encore prêt")
    task = (
        "Reproduce the following procedure that a user recorded once. "
        "Screenshots attached are from the recording, in chronological order.\n\n"
        + (d / "skill.md").read_text()
    )
    if req.instructions:
        task += f"\n\n## This run\n{req.instructions}"
    task += "\n\n## Reminder\nStop at the draft (\"Enregistrer le brouillon\"). Never click \"Valider\" unless this message explicitly asks for it."
    images = hcompany.pick_screenshots(session["steps"], d) if req.include_screenshots else None
    try:
        res = await hcompany.create_session(
            config.rewrite_urls(task), agent=req.agent,
            start_url=config.rewrite_urls(req.start_url or session.get("start_url")), images=images, max_steps=req.max_steps
        )
    except hcompany.HCompanyError as e:
        raise HTTPException(502, str(e)) from e
    runs = read_json(d / "hcompany_runs.json", [])
    runs.append({"session_id": res.get("id"), "agent_view_url": res.get("agent_view_url"), "created_at": res.get("created_at")})
    write_json(d / "hcompany_runs.json", runs)
    return {"session_id": res.get("id"), "agent_view_url": res.get("agent_view_url"), "status": res.get("status")}


@app.get("/hcompany/sessions/{session_id}")
async def hcompany_session(session_id: str):
    try:
        s = await hcompany.get_session(session_id)
    except hcompany.HCompanyError as e:
        raise HTTPException(502, str(e)) from e
    return {k: s.get(k) for k in ("id", "status", "latest_answer", "agent_view_url", "started_at", "finished_at")}


# ---------- viewer ----------

@app.get("/viewer/{rec_id}")
def viewer(rec_id: str):
    rec_dir(rec_id)
    return FileResponse(STATIC / "viewer.html")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/health")
def health():
    return {"ok": True, "gladia": bool(config.GLADIA_API_KEY), "hcompany": bool(config.HAI_API_KEY)}
