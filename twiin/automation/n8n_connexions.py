"""Crée ou met à jour des connexions (credentials) du n8n local à partir de Twiin, sans passer par l'interface de n8n.

Lit sur l'entrée standard une liste JSON : [{"type": "gmailOAuth2", "name": "Google · ...", "data": {...}}, ...]
Si une connexion de ce type et de ce nom existe déjà, elle est remplacée (même id) ; sinon elle est créée.
`n8n import:credentials` chiffre lui-même les données avec la clé de n8n. Le fichier temporaire (droits 600, dossier privé)
est supprimé juste après l'import. Aucun secret n'est affiché : la sortie ne contient que les types, noms et ids.
"""
import json
import os
import secrets
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from n8n_twiin import N8N_DB, run_cli  # noqa: E402


def id_existant(ctype, name):
    con = sqlite3.connect(N8N_DB)
    row = con.execute("select id from credentials_entity where type=? and name=? limit 1", (ctype, name)).fetchone()
    con.close()
    return row[0] if row else None


def main():
    demandes = json.load(sys.stdin)
    lot = []
    for c in demandes:
        cid = id_existant(c["type"], c["name"]) or secrets.token_urlsafe(12).replace("-", "a").replace("_", "b")[:16]
        lot.append({"id": cid, "name": c["name"], "type": c["type"], "data": c["data"]})
    dossier = tempfile.mkdtemp(prefix="twiin-cred-")
    fichier = os.path.join(dossier, "c.json")
    try:
        fd = os.open(fichier, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(lot, f)
        code, out, err = run_cli(["import:credentials", f"--input={fichier}"], timeout=180)
    finally:
        shutil.rmtree(dossier, ignore_errors=True)
    if code != 0:
        # le message d'erreur de n8n ne contient pas les données importées
        print(json.dumps({"ok": False, "error": (err or out)[-400:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "connexions": [{"id": x["id"], "type": x["type"], "name": x["name"]} for x in lot]}))


if __name__ == "__main__":
    main()
