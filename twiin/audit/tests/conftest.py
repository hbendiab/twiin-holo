import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
FIX = Path(__file__).parent / "fixtures"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


@pytest.fixture
def schema():
    return load(ROOT / "schemas" / "fiche-audit.schema.json")


@pytest.fixture
def exemple_v2():
    return load(ROOT / "schemas" / "fiche-audit.exemple.json")


@pytest.fixture
def exemple_v1():
    return load(FIX / "fiche-audit.v1.exemple.json")


@pytest.fixture
def taches():
    return load(FIX / "taches_alternance.json")
