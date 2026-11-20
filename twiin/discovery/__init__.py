# Certificats HTTPS : le Python de python.org sur Mac n'en a pas par défaut (urllib échoue alors sur Supabase et n8n).
# On utilise ceux de certifi (installé avec le projet) si aucun autre n'est configuré. Sans effet sous Windows.
import os as _os
try:
    import certifi as _certifi
    _os.environ.setdefault("SSL_CERT_FILE", _certifi.where())
except ImportError:
    pass
