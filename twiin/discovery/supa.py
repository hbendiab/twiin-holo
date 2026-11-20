"""Client Supabase minimal (bibliothèque standard) : connexion avec le compte de l'employé (clé publique + RLS)."""
import json
import os
import urllib.parse
import urllib.request


class Supa:
    def __init__(self):
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        self.key = os.environ["SUPABASE_PUBLISHABLE_KEY"]
        relais = os.environ.get("TWIIN_RELAIS", "").rstrip("/")
        if relais and not os.environ.get("SUPABASE_PASSWORD"):
            # poste client : le mot de passe du compte reste sur le relais Twiin, qui renvoie la session
            req = urllib.request.Request(relais + "/sb/session", data=b"{}", method="POST",
                                         headers={"Authorization": f"Bearer {os.environ.get('TWIIN_CLE', '')}",
                                                  "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                r = json.loads(resp.read())
        else:
            r = self._req("POST", "/auth/v1/token?grant_type=password",
                          {"email": os.environ["SUPABASE_EMAIL"], "password": os.environ["SUPABASE_PASSWORD"]}, auth=False)
        self.token = r["access_token"]
        self.user = r["user"]
        self.company_id = (self.user.get("app_metadata") or {}).get("company_id")
        if not self.company_id:
            raise RuntimeError("company_id absent de app_metadata : le compte doit être rattaché à une entreprise")

    def _req(self, method, path, body=None, headers=None, raw=False, auth=True):
        h = {"apikey": self.key}
        if auth:
            h["Authorization"] = f"Bearer {self.token}"
        data = None
        if raw:
            data = body
        elif body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
                return json.loads(b) if b else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Supabase {method} {path.split('?')[0]} : {e.code} {e.read()[:300]!r}") from None

    def select(self, table, query):
        return self._req("GET", f"/rest/v1/{table}?{query}")

    def insert(self, table, row):
        return self._req("POST", f"/rest/v1/{table}", row, {"Prefer": "return=representation"})[0]

    def update(self, table, match, row):
        return self._req("PATCH", f"/rest/v1/{table}?{match}", row, {"Prefer": "return=minimal"})

    def upload(self, bucket, path, data: bytes, content_type):
        return self._req("POST", f"/storage/v1/object/{bucket}/{urllib.parse.quote(path)}", data,
                         {"Content-Type": content_type, "x-upsert": "true"}, raw=True)
