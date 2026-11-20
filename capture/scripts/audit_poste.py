#!/usr/bin/env python3
"""Audit Twiin du poste : la liste des outils installés sur ce Mac ou ce PC Windows, classés connu / inconnu.

    .venv/bin/python capture/scripts/audit_poste.py            # écrit audit_poste.json + .md
    .venv/bin/python capture/scripts/audit_poste.py --print    # affiche aussi le tableau

Même registre (capture/backend/app/known_tools.json) et même format que l'audit d'une capture :
[{app, type: connu|inconnu, api: oui|non, connector, screenshots}] (+ name, category, composants…).

Règle de confiance. Le script lit UNIQUEMENT des métadonnées d'outils :
  - les applications : sur Mac /Applications (Info.plist : nom, version, bundle id, catégorie déclarée) ;
    sur Windows la liste « Applications installées » du registre (nom, version, éditeur) ;
  - les outils en ligne de commande installés (Homebrew `brew leaves`, quelques commandes courantes et leur version) ;
  - les extensions d'éditeur (VS Code, Cursor) et de Chrome : leur nom seulement.
Il ne lit AUCUN fichier de travail, AUCUN historique de navigation, AUCUNE activité. Rien n'est envoyé :
le résultat reste sur la machine (capture/backend/data/, ignoré par git). Lancé par l'employé, jamais en silence.

Les outils web (SaaS utilisés dans le navigateur) ne sont PAS devinés ici, car il faudrait lire l'historique :
ils sont détectés par l'audit d'une capture Observer, quand l'employé montre sa tâche.
"""
import argparse
import json
import plistlib
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "capture" / "backend"))
from app.audit import load_registry, match_app  # noqa: E402

OUT_BASE = ROOT / "capture" / "backend" / "data" / "audit_poste"
HOME = Path.home()

# Catégories déclarées par les apps (LSApplicationCategoryType) qu'on considère hors travail : exclues du jumeau.
PERSO = ("games", "entertainment", "lifestyle", "shopping", "food-and-drink", "travel", "sports", "kids",
         "music", "video", "card-games", "casual-games", "puzzle-games", "board-games", "action-games")
CLI_PROBES = ["python3", "node", "npm", "git", "gh", "uv", "docker", "cloudflared", "vercel", "n8n", "duckdb", "sqlite3"]


def run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def app_bundles() -> list[Path]:
    found = []
    for base in (Path("/Applications"), HOME / "Applications"):
        if not base.exists():
            continue
        for p in sorted(base.iterdir()):
            if p.suffix == ".app":
                found.append(p)
            elif p.is_dir() and p.name not in ("Utilities",) and not p.name.endswith(".localized"):
                found += sorted(q for q in p.iterdir() if q.suffix == ".app")  # ex. « Adobe Creative Cloud/ »
    return found


def read_app(p: Path) -> dict | None:
    try:
        info = plistlib.loads((p / "Contents" / "Info.plist").read_bytes())
    except Exception:
        return None
    return {
        "name": info.get("CFBundleDisplayName") or info.get("CFBundleName") or p.stem,
        "file": p.stem,
        "bundle_id": info.get("CFBundleIdentifier", ""),
        "version": str(info.get("CFBundleShortVersionString", "")),
        "declared_category": (info.get("LSApplicationCategoryType") or "").replace("public.app-category.", ""),
        "path": str(p),
    }


def recent_use(app_path: str, days: int = 30) -> dict:
    """Seulement si l'employé l'a accepté (--usage) : combien de JOURS l'appli a été ouverte ces `days` derniers jours.
    Source : les métadonnées Spotlight de l'appli (kMDItemUsedDates), jamais ce qui a été fait dedans ni à quelle heure."""
    raw = run(["mdls", "-name", "kMDItemUsedDates", app_path])
    used = set()
    now = datetime.utcnow()
    for m in re.findall(r"(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}", raw):
        try:
            d = datetime.strptime(m, "%Y-%m-%d")
        except ValueError:
            continue
        if (now - d).days <= days:
            used.add(m)
    n = len(used)
    return {"usage_days": n, "usage": "récente" if n else ("ancienne" if "(" in raw and "null" not in raw else "inconnue")}


# ---------------------------------------------------------------- Windows

WIN_SKIP = re.compile(r"^(Microsoft Visual C\+\+|Microsoft \.NET|Windows Software Development Kit|Windows SDK|"
                      r"Microsoft Windows Desktop Runtime|Microsoft ASP\.NET|Microsoft Update Health|Update for|"
                      r"Security Update|Microsoft Edge WebView2|vs_|Microsoft GameInput|NVIDIA (Graphics|PhysX|HD Audio|USBC|FrameView))", re.I)
WIN_PERSO = re.compile(r"\b(steam|epic games|battle\.net|riot|origin|ubisoft|game|jeu|spotify|netflix|deezer|vlc|discord)\b", re.I)


def windows_apps() -> list[dict]:
    """Applications installées (registre « Désinstaller un programme ») : nom, version, éditeur, dossier. Rien d'autre."""
    import winreg
    roots = [(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
             (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
             (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")]
    seen, out = set(), []
    for hive, path in roots:
        try:
            root = winreg.OpenKey(hive, path)
        except OSError:
            continue
        for i in range(winreg.QueryInfoKey(root)[0]):
            try:
                k = winreg.OpenKey(root, winreg.EnumKey(root, i))
            except OSError:
                continue
            def val(name):
                try:
                    return winreg.QueryValueEx(k, name)[0]
                except OSError:
                    return None
            name = (val("DisplayName") or "").strip()
            if not name or val("SystemComponent") == 1 or val("ParentKeyName") or val("ReleaseType"):
                continue
            if name.lower() in seen:
                continue
            seen.add(name.lower())
            icon = str(val("DisplayIcon") or "").split(",")[0].strip('"')
            out.append({"name": name, "file": name, "bundle_id": str(val("Publisher") or ""),
                        "version": str(val("DisplayVersion") or ""), "declared_category": "",
                        "path": str(val("InstallLocation") or "") or (str(Path(icon).parent) if icon else "")})
    return sorted(out, key=lambda a: a["name"].lower())


def windows_recent_use(days: int = 30) -> dict[str, datetime]:
    """Seulement si l'employé l'a accepté : DERNIÈRE ouverture de chaque programme, lue dans UserAssist (registre de
    l'utilisateur, tenu par Windows). Ni ce qui a été fait, ni les fichiers ouverts. {chemin exe en minuscules: date}."""
    import codecs, struct, winreg
    res = {}
    base = r"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist"
    try:
        ua = winreg.OpenKey(winreg.HKEY_CURRENT_USER, base)
    except OSError:
        return res
    for i in range(winreg.QueryInfoKey(ua)[0]):
        try:
            cnt = winreg.OpenKey(ua, winreg.EnumKey(ua, i) + r"\Count")
        except OSError:
            continue
        for j in range(winreg.QueryInfoKey(cnt)[1]):
            name, data, _ = winreg.EnumValue(cnt, j)
            if not isinstance(data, bytes) or len(data) < 68:
                continue
            ft = struct.unpack_from("<Q", data, 60)[0]
            if not ft:
                continue
            when = datetime(1601, 1, 1) + __import__("datetime").timedelta(microseconds=ft // 10)
            res[codecs.decode(name, "rot13").lower()] = when
    return res


def windows_usage_for(app: dict, ua: dict[str, datetime], days: int = 30) -> dict:
    folder = (app.get("path") or "").lower().rstrip("\\")
    key = re.sub(r"[^a-z0-9]", "", app["name"].lower())[:8]
    last = None
    for exe, when in ua.items():
        if (folder and exe.startswith(folder)) or (key and key in re.sub(r"[^a-z0-9]", "", Path(exe).stem.lower())):
            last = max(last, when) if last else when
    if last is None:
        return {"usage_days": 0, "usage": "inconnue"}
    recent = (datetime.utcnow() - last).days <= days
    # Windows ne garde que la dernière ouverture : on indique « au moins 1 jour » quand elle date de moins de 30 jours
    return {"usage_days": 1 if recent else 0, "usage": "récente" if recent else "ancienne",
            "last_used": last.strftime("%Y-%m-%d")}


def cli_tools() -> list[dict]:
    out, seen = [], set()
    if shutil.which("brew"):
        versions = dict(l.split(" ", 1) for l in run(["brew", "list", "--formula", "--versions"]).splitlines() if " " in l)
        for name in run(["brew", "leaves"]).splitlines():  # installés à la demande (pas les dépendances)
            out.append({"name": name, "version": versions.get(name, "").split(" ")[0], "via": "Homebrew"})
            seen.add(name)
        for name in run(["brew", "list", "--cask"]).splitlines():
            out.append({"name": name, "version": "", "via": "Homebrew cask"})
            seen.add(name)
    for cmd in CLI_PROBES:
        if cmd in seen or not shutil.which(cmd):
            continue
        v = run([cmd, "--version"]).splitlines()
        m = re.search(r"\d+(\.\d+)+", v[0] if v else "")
        out.append({"name": cmd, "version": m.group(0) if m else "", "via": "PATH"})
    return out


def editor_extensions() -> dict[str, list[str]]:
    res = {}
    for label, d in (("VS Code", HOME / ".vscode" / "extensions"), ("Cursor", HOME / ".cursor" / "extensions")):
        if d.exists():
            names = {re.sub(r"-\d+(\.\d+)+.*$", "", p.name) for p in d.iterdir() if p.is_dir() and not p.name.startswith(".")}
            res[label] = sorted(names)
    return res


def chrome_extensions() -> list[str]:
    root = (Path(__import__("os").environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "User Data"
            if sys.platform == "win32" else HOME / "Library" / "Application Support" / "Google" / "Chrome")
    names = set()
    for manifest in root.glob("*/Extensions/*/*/manifest.json"):
        try:
            m = json.loads(manifest.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        name = m.get("name", "")
        if name.startswith("__MSG_"):  # nom traduit : on le cherche dans _locales
            key = name[6:-2].lower()
            for loc in (m.get("default_locale", "en"), "en", "fr"):
                f = manifest.parent / "_locales" / loc / "messages.json"
                if f.exists():
                    try:
                        msgs = {k.lower(): v for k, v in json.loads(f.read_text(encoding="utf-8-sig")).items()}
                        name = msgs.get(key, {}).get("message", name)
                        break
                    except Exception:
                        pass
        if name and not name.startswith("__MSG_"):
            names.add(name)
    return sorted(names)


def entry(tool: dict | None, label: str, source: str, components: list[dict]) -> dict:
    known = tool is not None
    return {
        "app": tool["name"] if known else label,
        "type": "connu" if known else "inconnu",
        "api": "oui" if known and tool.get("api") else "non",
        "connector": tool.get("connector") if known else None,
        "name": tool["name"] if known else None,
        "category": tool.get("category") if known else None,
        "twin_strategy": ("connecteur API" if known and tool.get("api") else "jumeau par captures d'écran"),
        "source": source,
        "components": components,
        "screenshots": [],  # pas de capture ici : à faire avec Observer pour les outils sans API
    }


def build(registry: list[dict], usage: bool = False) -> dict:
    tools: dict[str, dict] = {}
    perso, apple_skipped = [], 0

    is_win = sys.platform == "win32"
    apps = windows_apps() if is_win else [a for a in (read_app(p) for p in app_bundles()) if a]
    ua = windows_recent_use() if (is_win and usage) else {}
    for a in apps:
        tool = match_app(a["file"], a["bundle_id"], registry) or match_app(a["name"], a["bundle_id"], registry)
        comp = {"name": a["file"], "version": a["version"], "bundle_id": a["bundle_id"]}
        if usage:
            comp.update(windows_usage_for(a, ua) if is_win else recent_use(a["path"]))
        if tool is None and (a["bundle_id"].startswith("com.apple.") or (is_win and WIN_SKIP.search(a["name"]))):
            apple_skipped += 1  # composants système (Apple, ou runtimes et mises à jour Windows) : pas des outils métier
            continue
        if tool is None and (a["declared_category"] in PERSO or (is_win and WIN_PERSO.search(a["name"]))):
            perso.append({**comp, "declared_category": a["declared_category"]})
            continue
        key = tool["name"] if tool else f"app:{a['file']}"
        if key not in tools:
            tools[key] = entry(tool, a["file"], "application", [])
            if tool is None:
                tools[key]["declared_category"] = a["declared_category"] or None
        tools[key]["components"].append(comp)

    for c in cli_tools():
        tool = match_app(c["name"], "", registry)
        key = tool["name"] if tool else f"cli:{c['name']}"
        if key not in tools:
            tools[key] = entry(tool, c["name"], "ligne de commande", [])
        elif tools[key]["source"] != "ligne de commande" and "ligne de commande" not in tools[key]["source"]:
            tools[key]["source"] += " + ligne de commande"
        tools[key]["components"].append({"name": c["name"], "version": c["version"], "via": c["via"]})

    if usage:  # un outil vaut son appli la plus utilisée
        for e in tools.values():
            u = [c.get("usage") for c in e["components"] if c.get("usage")]
            e["usage"] = "récente" if "récente" in u else ("ancienne" if "ancienne" in u else None)
            e["usage_days"] = max([c.get("usage_days", 0) for c in e["components"]] or [0])
    ordered = sorted(tools.values(), key=lambda e: (e["type"] != "connu", e["category"] or "~", e["app"].lower()))
    return {
        "schema": "twiin/audit-poste@1",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "scope": ("métadonnées d'outils uniquement (apps, CLI, extensions) ; ni fichiers, ni historique"
                  + ("; nombre de jours d'utilisation des applis sur 30 jours, à la demande de l'employé" if usage else ", ni activité")),
        "summary": {
            "outils": len(ordered),
            "connus": sum(e["type"] == "connu" for e in ordered),
            "connus_avec_api": sum(e["api"] == "oui" for e in ordered),
            "inconnus": sum(e["type"] == "inconnu" for e in ordered),
            "apps_perso_exclues": len(perso),
            "apps_systeme_apple_ignorees": apple_skipped,
        },
        "tools": ordered,
        "excluded_personal": perso,
        "extensions": {**editor_extensions(), "Chrome": chrome_extensions()},
    }


def markdown(a: dict) -> str:
    s = a["summary"]
    lines = [
        f"# Audit du poste — {a['generated_at'][:16].replace('T', ' ')}",
        "",
        f"_{a['scope']}._",
        "",
        f"**{s['outils']} outils** : {s['connus']} connus (dont {s['connus_avec_api']} avec API), "
        f"{s['inconnus']} inconnus. Exclus : {s['apps_perso_exclues']} apps perso, "
        f"{s['apps_systeme_apple_ignorees']} composants système.",
        "",
        "| Outil | Catégorie | Type | API | Connecteur | Jumeau | Détecté via | Composants |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for e in a["tools"]:
        comps = ", ".join(f"{c['name']} {c['version']}".strip() for c in e["components"])
        cat = e["category"] or (e.get("declared_category") or "—")
        lines.append(f"| {e['app']} | {cat} | {e['type']} | {e['api']} | {e['connector'] or '—'} | "
                     f"{e['twin_strategy']} | {e['source']} | {comps} |")
    if a["excluded_personal"]:
        lines += ["", "**Exclues (catégorie perso déclarée par l'app)** : "
                  + ", ".join(p["name"] for p in a["excluded_personal"])]
    for label, names in a["extensions"].items():
        if names:
            lines += ["", f"**Extensions {label}** ({len(names)}) : " + ", ".join(names)]
    lines += ["", "Outils web (SaaS dans le navigateur) : non devinés ici. Ils apparaissent dans l'audit "
              "d'une capture Observer, quand l'employé montre sa tâche."]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, help="dossier de sortie (défaut : capture/backend/data/audit_poste/<date>)")
    ap.add_argument("--print", action="store_true", help="affiche le tableau markdown")
    ap.add_argument("--usage", action="store_true",
                    help="indique aussi si chaque appli a été ouverte ces 30 derniers jours (choix de l'employé)")
    args = ap.parse_args()
    if sys.platform not in ("darwin", "win32"):
        sys.exit("Audit du poste : macOS ou Windows uniquement.")

    print("Audit du poste Twiin : lecture des métadonnées d'outils uniquement (apps, CLI, extensions).", flush=True)
    audit = build(load_registry(), usage=args.usage)
    out = args.out or OUT_BASE / datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    (out / "audit_poste.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    md = markdown(audit)
    (out / "audit_poste.md").write_text(md, encoding="utf-8")
    s = audit["summary"]
    print(f"{s['outils']} outils : {s['connus']} connus ({s['connus_avec_api']} avec API), {s['inconnus']} inconnus.")
    print(f"→ {out / 'audit_poste.json'}\n→ {out / 'audit_poste.md'}")
    if args.print:
        print("\n" + md)


if __name__ == "__main__":
    main()
