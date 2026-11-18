#!/usr/bin/env python3
"""Audit Twiin du poste en COMPUTER USE : Holo regarde l'écran et inventorie les outils.

    .venv/bin/python capture/scripts/audit_poste_holo.py                # audit réel (Finder à l'écran)
    .venv/bin/python capture/scripts/audit_poste_holo.py --images a.png b.png   # test sur des captures fixes

Déroulé, répété à chaque étape :
  📸 le script capture UNIQUEMENT la fenêtre Finder ouverte sur /Applications (pas le reste de l'écran) ;
  🧠 la capture part à Holo (holo3-1-35b-a3b, API Modèles de H) ;
  🎯 Holo répond par un seul appel `observe` : les outils qu'il LIT à l'écran + l'action suivante
     (page suivante, ouvrir un sous-dossier, revenir, terminer) et sa raison ;
  ▶️ le script exécute l'action dans le Finder.
Ce que Holo a lu est ensuite classé avec le registre Twiin (known_tools.json) → audit.json au format du brief :
[{app, type: connu|inconnu, api: oui|non, connector, screenshots}] ; les captures où chaque outil apparaît sont gardées.

Garde-fous :
  - Holo ne clique pas et ne tape rien : il choisit parmi 4 actions, exécutées par AppleScript sur le Finder
    (sélection d'un élément pour faire défiler, changement de dossier). Aucune app n'est ouverte.
  - `open_folder` n'accepte qu'un sous-dossier de /Applications qui existe et n'est pas une app.
  - Seule la fenêtre Finder est capturée (screencapture -l <fenêtre>) et envoyée à H : ni ce qui passe devant
    (notifications, dialogues), ni les autres fenêtres. Le tri du Finder est remis comme avant à la fin. Ni fichiers de travail, ni historique, ni activité.
  - Vérification indépendante : chaque nom lu par Holo doit exister dans /Applications (ou le sous-dossier
    exploré) ; sinon il est écarté et compté comme « non vérifié ». On ne croit pas l'agent sur parole.
  - Lancé par l'employé, la fenêtre est visible pendant tout l'audit ; elle est refermée à la fin.

Permissions macOS nécessaires pour le terminal qui lance le script (VS Code, Terminal…) :
  - Réglages Système → Confidentialité et sécurité → Enregistrement de l'écran (pour la capture) ;
  - Automatisation → Finder (demandé automatiquement au premier lancement).
"""
import argparse
import base64
import io
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "capture" / "backend"))
from app.audit import load_registry, match_app  # noqa: E402

HOLO_BASE_URL = "https://api.hcompany.ai/v1/"
DEFAULT_MODEL = "holo3-1-35b-a3b"
MIN_SECONDS_BETWEEN_CALLS = 6.5          # limite gratuite : 10 requêtes / minute
APPS_ROOT = Path("/Applications")
OUT_BASE = ROOT / "capture" / "backend" / "data" / "audit_poste_holo"

TOOLS = [{
    "type": "function",
    "function": {
        "name": "observe",
        "description": "Report the software visible in this screenshot, then choose the next action.",
        "parameters": {
            "type": "object",
            "properties": {
                "apps_visible": {"type": "array", "items": {"type": "string"},
                                 "description": "Every application or folder name visible in the list, written exactly as on screen, without '.app'."},
                "personal": {"type": "array", "items": {"type": "string"},
                             "description": "Among apps_visible, those clearly for leisure, not work: games (e.g. Solitaire), video streaming (e.g. Prime Video, Netflix), watch-party, food delivery or shopping apps."},
                "next_action": {"type": "string", "enum": ["next_page", "open_folder", "back", "done"]},
                "folder": {"type": "string", "description": "For open_folder only: the folder name exactly as shown."},
                "reason": {"type": "string", "description": "One short sentence: why this action."},
            },
            "required": ["apps_visible", "next_action", "reason"],
        },
    },
}]


# ---------- Finder (AppleScript) ----------

def osa(script: str) -> str:
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()


def displayed_names(folder: Path) -> list[str]:
    """Noms tels que le Finder les affiche (localisés, sans .app). Sert au défilement et à la vérification."""
    if not folder.is_dir():
        return []
    out = osa(f'''tell application "Finder"
        set AppleScript's text item delimiters to linefeed
        return (displayed name of every item of folder (POSIX file "{folder}" as alias)) as text
    end tell''')
    return [n.removesuffix(".app") for n in out.splitlines() if n.strip()]


def sort_key(name: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().casefold()


class Finder:
    """La seule chose que l'agent pilote : une fenêtre Finder, sans clic ni clavier.
    Le Finder affiche dans « Applications » les apps de /Applications ET les apps système (/System/Applications).
    Pour défiler sans clavier, on sélectionne une vraie app située environ une page plus bas (tri par nom)."""

    def __init__(self):
        self.folder = APPS_ROOT
        self.created: list[str] = []
        _, _, sw, sh = (int(v) for v in osa('tell application "Finder" to get bounds of window of desktop').split(", "))
        self.bounds = (60, 40, min(sw - 60, 1060), sh - 40)
        # Si une fenêtre Finder est en plein écran, le Finder ouvre un ONGLET dans cette fenêtre au lieu
        # d'une nouvelle fenêtre : on ne pourrait ni la dimensionner, ni capturer proprement. On s'arrête.
        probe = osa(f'''tell application "Finder"
            set w to make new Finder window to (POSIX file "{APPS_ROOT}" as alias)
            set i to id of w
            set bounds of w to {{{self.bounds[0]}, {self.bounds[1]}, {self.bounds[2]}, {self.bounds[3]}}}
            delay 0.3
            set b to bounds of w
            close w
            return (item 1 of b as text) & "," & (item 2 of b as text)
        end tell''')
        if probe != f"{self.bounds[0]},{self.bounds[1]}":
            raise SystemExit("Le Finder ouvre les dossiers en onglet (une fenêtre Finder est en plein écran). "
                             "Sors-la du plein écran (ou ferme-la) puis relance l'audit.")
        # Tri par nom pendant l'audit (le Finder ne l'applique qu'à la réouverture de la fenêtre) ;
        # le tri d'origine est remis à la fin, de la même façon.
        self.sort_orig = osa(f'''tell application "Finder"
            set w to make new Finder window to (POSIX file "{APPS_ROOT}" as alias)
            set current view of w to list view
            set o to list view options of w
            set orig to name of sort column of o
            try
                set sort column of o to name column
            end try
            close w
            return orig
        end tell''')
        time.sleep(0.5)
        self.wid = osa(f'''tell application "Finder"
            activate
            set w to make new Finder window to (POSIX file "{APPS_ROOT}" as alias)
            set current view of w to list view
            set bounds of w to {{{self.bounds[0]}, {self.bounds[1]}, {self.bounds[2]}, {self.bounds[3]}}}
            return id of w
        end tell''')
        self.created.append(self.wid)
        try:
            self.rows = max(8, (self.bounds[3] - self.bounds[1] - 70) // 20)
            time.sleep(1.5)  # laisser le Finder afficher la fenêtre avant de la faire défiler
            self._load()
        except Exception:
            self.close()
            raise
        time.sleep(1.0)

    def _load(self):
        real = displayed_names(self.folder)
        system = displayed_names(Path("/System") / self.folder.relative_to("/")) if self.folder == APPS_ROOT else []
        self.real = set(real)
        self.display = sorted(set(real) | set(system), key=sort_key)
        self.top = 0
        first = next((n for n in self.display if n in self.real), None)
        if first:  # la fenêtre peut s'ouvrir au milieu de la liste : on remonte en haut
            self._select(first)
            time.sleep(0.5)

    def _select(self, shown: str):
        osa(f'''tell application "Finder"
            activate
            set index of window id {self.wid} to 1
            select (POSIX file "{self._path(shown)}" as alias)
        end tell''')
        time.sleep(0.4)

    def at_end(self) -> bool:
        return self.top + self.rows >= len(self.display)

    def next_page(self) -> str:
        if self.at_end():
            return "already at the bottom of the list"
        bottom = self.top + self.rows - 1
        goal = min(len(self.display) - 1, bottom + self.rows - 3)          # 2-3 lignes de recouvrement
        cands = [i for i in range(goal, bottom, -1) if self.display[i] in self.real]
        if not cands:
            cands = [i for i in range(goal + 1, len(self.display)) if self.display[i] in self.real][:1]
        if not cands:
            self.top = len(self.display) - self.rows
            return "no more selectable item: treat the list as finished"
        i = cands[0]
        self._select(self.display[i])
        self.top = max(0, i - self.rows + 1)
        return f"scrolled down (now around rows {self.top + 1}-{min(len(self.display), self.top + self.rows)} of {len(self.display)})"

    def _path(self, shown: str) -> Path:
        for cand in (self.folder / f"{shown}.app", self.folder / shown):
            if cand.exists():
                return cand
        return self.folder / shown  # nom localisé : le Finder le résout quand même dans la plupart des cas

    def go(self, path: Path):
        osa(f'tell application "Finder" to set target of window id {self.wid} to (POSIX file "{path}" as alias)')
        self.folder = path
        self._load()
        time.sleep(0.8)

    def open_folder(self, name: str) -> str:
        name = (name or "").strip().removesuffix(".app")
        target = (self.folder / name).resolve()
        if APPS_ROOT not in (target, *target.parents) or not target.is_dir() or target.suffix == ".app":
            return f"refused: '{name}' is not a sub-folder of the current folder"
        self.go(target)
        return f"opened folder {target}"

    def back(self) -> str:
        if self.folder == APPS_ROOT:
            return "already at /Applications"
        self.go(self.folder.parent)
        return f"back to {self.folder}"

    def screenshot(self, path: Path):
        x1, y1, x2, y2 = (int(v) for v in osa(f'tell application "Finder" to get bounds of window id {self.wid}').split(", "))
        raw = path.with_suffix(".png")
        # -l : uniquement cette fenêtre (rien de ce qui passe devant ou derrière) ; -o : sans ombre.
        # macOS peut demander une autorisation en plus pour ce mode ; à défaut, on capture la zone de la fenêtre
        # après l'avoir mise au premier plan.
        r = subprocess.run(["screencapture", "-x", "-o", "-l", str(self.wid), str(raw)], capture_output=True, text=True)
        if r.returncode != 0 or not raw.exists():
            osa(f'tell application "Finder" to activate\ntell application "Finder" to set index of window id {self.wid} to 1')
            time.sleep(0.3)
            r = subprocess.run(["screencapture", "-x", "-R", f"{x1},{y1},{x2 - x1},{y2 - y1}", str(raw)], capture_output=True, text=True)
            self.capture_mode = "zone de la fenêtre"
        else:
            self.capture_mode = "fenêtre seule"
        if r.returncode != 0 or not raw.exists():
            raise SystemExit("Capture d'écran refusée par macOS. Autorise « Enregistrement de l'écran » pour VS Code/Terminal "
                             "(Réglages Système → Confidentialité et sécurité), puis relance l'app et le script.")
        from PIL import Image
        Image.open(raw).convert("RGB").resize((x2 - x1, y2 - y1)).save(path, quality=85)  # Retina 2x → taille réelle
        raw.unlink()

    def close(self):
        """Remet le tri d'origine et ferme TOUTES les fenêtres ouvertes par l'audit (et seulement elles)."""
        if getattr(self, "sort_orig", "name column") != "name column":
            try:
                self.created.append(osa(f'''tell application "Finder"
                    set w to make new Finder window to (POSIX file "{APPS_ROOT}" as alias)
                    set i to id of w
                    set o to list view options of w
                    try
                        set sort column of o to column {self.sort_orig} of o
                    end try
                    close w
                    return i
                end tell'''))
            except Exception:
                pass
        time.sleep(0.5)
        for wid in getattr(self, "created", []):
            try:
                osa(f'''tell application "Finder"
                    if exists window id {wid} then close window id {wid}
                end tell''')
            except Exception:
                pass


class ImageSource:
    """Mode test (--images) : des captures fixes à la place du Finder."""

    def __init__(self, images: list[Path]):
        self.images, self.i, self.folder, self.pos, self.rows = images, 0, APPS_ROOT, 0, 0

    def at_end(self):
        return self.i >= len(self.images) - 1

    def next_page(self):
        if self.at_end():
            return "already at the bottom of the list"
        self.i += 1
        return f"next image {self.i + 1}/{len(self.images)}"

    def open_folder(self, name):
        return "test mode: folders are not opened"

    def back(self):
        return "test mode"

    def screenshot(self, path: Path):
        from PIL import Image
        Image.open(self.images[self.i]).convert("RGB").save(path, quality=85)

    def close(self):
        pass


# ---------- classement ----------

def norm(s: str) -> str:
    return " ".join(re.sub(r"\.app$", "", (s or "").strip(), flags=re.I).lower().split())


def classify(name: str, registry: list[dict]) -> dict | None:
    n = norm(name)
    tool = match_app(n, "", registry)
    if tool:
        return tool
    for t in registry:  # « Maxon Cinema 4D 2025 » → alias « Maxon Cinema 4D »
        for a in t.get("apps", []):
            a = a.lower()
            if not a.endswith(".") and len(a) >= 4 and n.startswith(a + " "):
                return t
    return None


def catalog(folders: list[Path]) -> dict[str, bool]:
    """Noms réels (affichés par le Finder et noms de fichiers) → True si app système d'Apple."""
    cat: dict[str, bool] = {}
    for f in folders:
        system_f = Path("/System") / f.relative_to("/") if f == APPS_ROOT else None
        for d, is_sys in ((f, False), (system_f, True)):
            if d is None or not d.is_dir():
                continue
            names = displayed_names(d) + [e.name.removesuffix(".app") for e in d.iterdir() if not e.name.startswith(".")]
            for n in names:
                cat.setdefault(n, is_sys)
    return cat


def on_disk(name: str, cat: dict[str, bool]) -> str | None:
    """Contrôle indépendant : le nom lu par Holo correspond-il à une app ou un dossier réel ?
    Renvoie le nom réel (corrigé si Holo a fait une petite faute de lecture, ex. « Vectormator »), sinon None.
    On compare seulement des noms, sans rien lire dans les apps ni les dossiers."""
    import difflib
    n = name.strip().removesuffix(".app")
    if n in cat:
        return n
    low = {k.casefold(): k for k in cat}
    if n.casefold() in low:
        return low[n.casefold()]
    if len(n) < 6:  # noms courts (« Zoom » / « Loom ») : correspondance exacte seulement
        return None
    close = difflib.get_close_matches(n, list(cat), n=1, cutoff=0.88)
    return close[0] if close else None


def build_audit(seen: dict[str, list[str]], personal: set[str], registry: list[dict],
                cat: dict[str, bool] | None = None) -> tuple[list[dict], list[str], list[str], list[str]]:
    tools: dict[str, dict] = {}
    excluded, unverified, system = [], [], []
    merged: dict[str, list[str]] = {}
    for name, shots in seen.items():
        real = name if cat is None else on_disk(name, cat)
        if real is None:
            unverified.append(name)  # inventé ou illisible : écarté de l'audit
            continue
        merged[real] = sorted(set(merged.get(real, [])) | set(shots))
    for name, shots in merged.items():
        if name.lower() in ("utilities", "utilitaires"):
            continue
        tool = classify(name, registry)
        if tool is None and cat is not None and cat.get(name):
            system.append(name)  # app système d'Apple (Calendrier, Notes…) : pas un outil métier
            continue
        if tool is None and norm(name) in personal:
            excluded.append(name)
            continue
        key = tool["name"] if tool else name
        e = tools.setdefault(key, {
            "app": key,
            "type": "connu" if tool else "inconnu",
            "api": "oui" if tool and tool.get("api") else "non",
            "connector": tool.get("connector") if tool else None,
            "name": tool["name"] if tool else None,
            "category": tool.get("category") if tool else None,
            "twin_strategy": "connecteur API" if tool and tool.get("api") else "jumeau par captures d'écran",
            "seen_as": [],
            "screenshots": [],
        })
        e["seen_as"].append(name)
        e["screenshots"] = sorted(set(e["screenshots"]) | set(shots))
    ordered = sorted(tools.values(), key=lambda e: (e["type"] != "connu", e["category"] or "~", e["app"].lower()))
    return ordered, sorted(excluded), sorted(unverified), sorted(system)


def markdown(audit: list[dict], excluded: list[str], meta: dict, unverified: list[str] | None = None,
             system: list[str] | None = None) -> str:
    connus = sum(e["type"] == "connu" for e in audit)
    lines = [f"# Audit du poste par Holo (computer use) — {meta['date']}", "",
             f"Modèle `{meta['model']}` · {meta['steps']} étapes · {meta['seconds']} s · "
             f"captures de la fenêtre Finder uniquement.", "",
             f"**{len(audit)} outils lus à l'écran** : {connus} connus "
             f"({sum(e['api'] == 'oui' for e in audit)} avec API), {len(audit) - connus} inconnus.", "",
             "| Outil | Catégorie | Type | API | Connecteur | Jumeau | Lu à l'écran comme | Captures |",
             "|---|---|---|---|---|---|---|---|"]
    for e in audit:
        lines.append(f"| {e['app']} | {e['category'] or '—'} | {e['type']} | {e['api']} | {e['connector'] or '—'} | "
                     f"{e['twin_strategy']} | {', '.join(e['seen_as'])} | {', '.join(e['screenshots'])} |")
    if excluded:
        lines += ["", "**Jugées perso par Holo (exclues)** : " + ", ".join(excluded)]
    if system:
        lines += ["", f"**Apps système d'Apple lues mais ignorées** ({len(system)}) : " + ", ".join(system)]
    if unverified:
        lines += ["", f"**Écartés par la vérification** ({len(unverified)} noms lus par Holo qui n'existent pas sur le disque) : "
                  + ", ".join(unverified)]
    return "\n".join(lines) + "\n"


# ---------- boucle agent ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-steps", type=int, default=20)
    ap.add_argument("--images", nargs="+", type=Path, help="mode test : captures fixes au lieu du Finder")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--no-verify", action="store_true", help="ne pas contrôler les noms lus contre le disque")
    a = ap.parse_args()

    from dotenv import load_dotenv
    from openai import OpenAI
    load_dotenv(ROOT / ".env")
    key = os.getenv("HAI_API_KEY")
    if not key:
        sys.exit("HAI_API_KEY absente du .env de la racine.")
    client = OpenAI(base_url=HOLO_BASE_URL, api_key=key)
    registry = load_registry()

    out = a.out or OUT_BASE / datetime.now().strftime("%Y%m%d-%H%M%S")
    (out / "pages").mkdir(parents=True, exist_ok=True)
    print("🔎 Audit du poste par Holo : seule la fenêtre Finder « Applications » est capturée et envoyée à H.", flush=True)

    src = ImageSource(a.images) if a.images else Finder()
    seen: dict[str, list[str]] = {}
    personal: set[str] = set()
    history: list[str] = []
    opened: list[str] = []
    log = []
    t0, last_call = time.time(), 0.0
    tokens = 0
    try:
        for step in range(1, a.max_steps + 1):
            shot = out / "pages" / f"page_{step:02d}.jpg"
            src.screenshot(shot)
            print(f"\n📸 [{step}] capture {shot.name} (dossier {src.folder})", flush=True)

            wait = MIN_SECONDS_BETWEEN_CALLS - (time.time() - last_call)
            if wait > 0:
                time.sleep(wait)
            end_note = "The last item of this folder IS visible now." if src.at_end() else \
                       "There are MORE items below: the last item is not visible yet."
            prompt = (
                "You are auditing which software tools are installed on this Mac, for an inventory. "
                "The screenshot shows a Finder window listing a folder of applications.\n"
                f"Current folder: {src.folder}. {end_note}\n"
                f"Sub-folders already explored: {opened or 'none'}.\n"
                "Rules:\n- Put in apps_visible EVERY application or folder name you can read in the list, exactly as written.\n"
                "- Also fill personal with the leisure apps among them (games, streaming, watch-party, shopping, food delivery).\n"
                "- If there are more items below, choose next_page.\n"
                "- When the end of the list is visible: if you saw a folder that contains applications from a vendor "
                "(e.g. 'Adobe Creative Cloud', 'Maxon Cinema 4D 2025') and it is not explored yet, choose open_folder with its name; "
                "skip 'Utilities'. If you are inside a sub-folder and finished it, choose back. Otherwise choose done.\n"
                "## What you already did\n" + ("\n".join(history[-10:]) or "(nothing yet)") +
                "\n\nCall the observe tool exactly once.")
            data_uri = "data:image/jpeg;base64," + base64.b64encode(shot.read_bytes()).decode()
            print("🧠 Holo lit la capture…", flush=True)
            for attempt in range(4):
                try:
                    last_call = time.time()
                    resp = client.chat.completions.create(
                        model=a.model, tools=TOOLS, tool_choice="required",
                        messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_uri}},
                                                               {"type": "text", "text": prompt}]}])
                    break
                except Exception as e:  # noqa: BLE001
                    if "429" in str(e) and attempt < 3:
                        print("   limite gratuite atteinte : pause 30 s", flush=True)
                        time.sleep(30)
                        continue
                    raise
            took = time.time() - last_call
            tokens += getattr(getattr(resp, "usage", None), "prompt_tokens", 0) or 0
            calls = resp.choices[0].message.tool_calls or []
            try:
                args = json.loads(calls[0].function.arguments or "{}") if calls else {}
            except json.JSONDecodeError:
                args = {}
            names = [n.strip().removesuffix(".app") for n in args.get("apps_visible", []) if isinstance(n, str) and n.strip()]
            new = [n for n in names if n not in seen]
            for n in names:
                seen.setdefault(n, [])
                if f"pages/{shot.name}" not in seen[n]:
                    seen[n].append(f"pages/{shot.name}")
            personal |= {norm(p) for p in args.get("personal", []) if isinstance(p, str)}
            action, reason = args.get("next_action", "next_page"), args.get("reason", "")
            print(f"🎯 lu {len(names)} noms ({len(new)} nouveaux) en {took:.1f} s : {', '.join(new) or '—'}", flush=True)
            print(f"   → {action}{' ' + args.get('folder', '') if action == 'open_folder' else ''} · {reason}", flush=True)

            if action == "done" and not src.at_end():
                result = "refused: the end of the list is not visible yet, continue with next_page"
            elif action == "open_folder":
                result = src.open_folder(args.get("folder", ""))
                if not result.startswith("refused"):
                    opened.append(args.get("folder", ""))
            elif action == "back":
                result = src.back()
            elif action == "done":
                result = "done"
            else:
                result = src.next_page()
            print(f"▶️  {result}", flush=True)
            history.append(f"{step}. read {len(names)} names; {action} {args.get('folder', '')} -> {result}")
            log.append({"step": step, "screenshot": f"pages/{shot.name}", "folder": str(src.folder), "apps_visible": names,
                        "personal": args.get("personal", []), "action": action, "folder_arg": args.get("folder"),
                        "reason": reason, "result": result, "latency": round(took, 2)})
            if result == "done":
                break
    finally:
        src.close()

    folders = sorted({APPS_ROOT} | {Path(s["folder"]) for s in log})
    cat = None if (a.no_verify or a.images) else catalog(folders)
    if a.images and not a.no_verify:
        cat = catalog([APPS_ROOT])
    audit, excluded, unverified, system = build_audit(seen, personal, registry, cat)
    meta = {"date": datetime.now().strftime("%Y-%m-%d %H:%M"), "model": a.model, "steps": len(log),
            "seconds": round(time.time() - t0), "prompt_tokens": tokens,
            "names_read": len(seen), "names_unverified": len(unverified), "system_ignored": len(system), "mode": "images" if a.images else "finder"}
    (out / "audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2))
    (out / "run.json").write_text(json.dumps({"meta": meta, "steps": log, "excluded_personal": excluded, "unverified": unverified, "system_ignored": system}, ensure_ascii=False, indent=2))
    md = markdown(audit, excluded, meta, unverified, system)
    (out / "audit.md").write_text(md)
    print("\n" + md)
    print(f"→ {out / 'audit.json'}\n→ {out / 'audit.md'}\n→ {out / 'pages'}/")


if __name__ == "__main__":
    main()
