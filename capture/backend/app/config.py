import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DATA_DIR = Path(os.getenv("TWIIN_DATA_DIR", Path(__file__).resolve().parent.parent / "data" / "recordings"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Clé optionnelle pour protéger l'endpoint d'upload (header X-Twiin-Key)
TWIIN_API_KEY = os.getenv("TWIIN_API_KEY", "")

GLADIA_API_KEY = os.getenv("GLADIA_API_KEY", "")
GLADIA_BASE_URL = os.getenv("GLADIA_BASE_URL", "https://api.gladia.io/v2")
GLADIA_LANGUAGES = [l.strip() for l in os.getenv("GLADIA_LANGUAGES", "fr,en").split(",") if l.strip()]
GLADIA_SUMMARIZE = os.getenv("GLADIA_SUMMARIZE", "true").lower() == "true"

HAI_API_KEY = os.getenv("HAI_API_KEY", "")
HAI_BASE_URL = os.getenv("HAI_BASE_URL", "https://agp.eu.hcompany.ai/api/v2")
HAI_DEFAULT_AGENT = os.getenv("HAI_DEFAULT_AGENT", "h/web-surfer-flash")
HAI_SKILL_NAMESPACE = os.getenv("HAI_SKILL_NAMESPACE", "")  # ex: "acme" → skills "acme/twiin-xxx"

# Connexion aux sites (Stripe, Shopify…) dans le navigateur cloud de H :
# - HAI_VAULT_ID : vault H (identifiants + TOTP) lié au navigateur de l'agent
# - HAI_USE_DEFAULT_PROFILE : réutilise ton profil navigateur par défaut (cookies conservés d'une session à l'autre)
# - HAI_BROWSER_PROFILE_ID : profil navigateur uploadé (prioritaire sur le profil par défaut)
HAI_VAULT_ID = os.getenv("HAI_VAULT_ID", "")
HAI_USE_DEFAULT_PROFILE = os.getenv("HAI_USE_DEFAULT_PROFILE", "true").lower() == "true"
HAI_BROWSER_PROFILE_ID = os.getenv("HAI_BROWSER_PROFILE_ID", "")

# Réécriture d'URL au moment d'envoyer à H : le navigateur cloud de H ne voit pas localhost.
# Format : "http://127.0.0.1:8042=https://xxx.trycloudflare.com" (plusieurs paires séparées par des virgules).
TWIIN_URL_REWRITE = [tuple(x.strip().rstrip("/") for x in pair.split("=", 1))
                     for pair in os.getenv("TWIIN_URL_REWRITE", "").split(",") if "=" in pair]


def rewrite_urls(text: str | None) -> str | None:
    if not text:
        return text
    for src, dst in TWIIN_URL_REWRITE:
        text = text.replace(src, dst)
    return text


def rewrite_host(app_host: str) -> str:
    from urllib.parse import urlparse
    for src, dst in TWIIN_URL_REWRITE:
        if urlparse(src).hostname == app_host:
            return urlparse(dst).hostname or app_host
    return app_host
