"""Lance QONTA (le faux logiciel comptable `comptarex`) avec le Python de Twiin, sans uv.

    python demo/run_qonta.py          -> http://127.0.0.1:8042  (identifiants dans comptarex/.env)
"""
import os
import sys
from pathlib import Path

COMPTAREX = Path(os.environ.get("COMPTAREX_DIR") or Path(__file__).resolve().parents[3] / "comptarex")
sys.path.insert(0, str(COMPTAREX))
os.chdir(COMPTAREX)
from comptarex.web.app import main  # noqa: E402

main()
