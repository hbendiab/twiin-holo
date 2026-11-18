"""Audit Twiin : inventaire des plateformes vues pendant une capture.

Règle de confiance : l'audit ne lit que les noms d'hôtes des pages visitées pendant la capture
déclenchée par l'employé, et réutilise les captures d'écran de cette même capture.
Il ne lit ni le contenu des fichiers, ni l'activité en dehors de la capture.

Sortie (audit.json) : [{app, type: connu|inconnu, api: oui|non, connector, screenshots: [...]}]
"""
import json
import re
import shutil
from pathlib import Path

REGISTRY_PATH = Path(__file__).with_name("known_tools.json")


def load_registry(path: Path = REGISTRY_PATH) -> list[dict]:
    return json.loads(path.read_text())["tools"]


def match_tool(app_host: str, registry: list[dict]) -> dict | None:
    h = (app_host or "").lower()
    for tool in registry:
        if any(h == d or h.endswith("." + d) for d in tool["domains"]):
            return tool
    return None


def match_app(name: str, bundle_id: str, registry: list[dict]) -> dict | None:
    """Audit du poste : reconnaît une app installée ou une commande CLI.
    Une entrée de `apps` qui finit par « . » est un préfixe de bundle id ; sinon elle doit être
    égale (sans casse) au nom de l'app, au bundle id ou au nom de la commande."""
    n, b = (name or "").lower(), (bundle_id or "").lower()
    for tool in registry:
        for a in tool.get("apps", []):
            a = a.lower()
            if (a.endswith(".") and b.startswith(a)) or a in (n, b):
                return tool
    return None


def _slug(host: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", host) or "app"


def build_audit(steps: list[dict], apps: list[str], accounts: list[dict] | None = None,
                rec_dir: Path | None = None, registry: list[dict] | None = None) -> list[dict]:
    """Classe chaque app vue (dans l'ordre d'apparition) et, pour les apps inconnues,
    copie leurs captures dans audit/<hôte>/ pour reconstruire leur interface dans le jumeau."""
    registry = registry if registry is not None else load_registry()
    login = {a["app"]: a.get("login_seen", False) for a in accounts or []}
    out = []
    for app in dict.fromkeys(a for a in apps if a):
        app_steps = [s for s in steps if s.get("app") == app]
        shots = list(dict.fromkeys(
            f for s in app_steps for f in (s.get("screenshot"), s.get("screenshot_after")) if f))
        if rec_dir is not None:
            shots = [f for f in shots if (rec_dir / "screenshots" / f).exists()]
        tool = match_tool(app, registry)
        entry = {
            "app": app,
            "type": "connu" if tool else "inconnu",
            "api": "oui" if tool and tool.get("api") else "non",
            "connector": tool.get("connector") if tool else None,
            "name": tool["name"] if tool else None,
            "category": tool.get("category") if tool else None,
            "twin_strategy": ("connecteur API" if tool and tool.get("api") else "jumeau par captures d'écran"),
            "steps": len(app_steps),
            "login_seen": login.get(app, False),
            "screenshots": [],
        }
        if tool is None:
            # App inconnue : on garde ses captures pour reconstruire son interface dans le jumeau.
            if rec_dir is not None and shots:
                dest = rec_dir / "audit" / _slug(app)
                dest.mkdir(parents=True, exist_ok=True)
                for f in shots:
                    shutil.copy2(rec_dir / "screenshots" / f, dest / f)
                entry["screenshots"] = [f"audit/{_slug(app)}/{f}" for f in shots]
            else:
                entry["screenshots"] = [f"screenshots/{f}" for f in shots]
        out.append(entry)
    return out


def audit_markdown(audit: list[dict]) -> str:
    lines = ["| App | Type | API | Connecteur | Jumeau | Captures |", "|---|---|---|---|---|---|"]
    for a in audit:
        lines.append(f"| {a['app']} | {a['type']} | {a['api']} | {a['connector'] or '—'} | "
                     f"{a['twin_strategy']} | {len(a['screenshots'])} |")
    return "\n".join(lines)
