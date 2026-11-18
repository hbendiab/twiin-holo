"""Loads and lists inferred workflow routines ("skills").

A "skill" here is the JSON routine that Ashu's Claude screen-recording
parser is expected to produce: a name, a natural-language description, and
an ordered list of steps to hand to Holo. Until that parser lands, skills
are just entries in SKILLS_FILE.
"""

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

WORKFLOWS_DIR = Path(__file__).parent.parent / "workflows"
SKILLS_FILE = WORKFLOWS_DIR / "skills.json"


@dataclass
class Workflow:
    id: str
    name: str
    description: str
    steps: list[str]

    @classmethod
    def from_dict(cls, data: dict) -> "Workflow":
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            steps=data.get("steps", []),
        )


def list_workflows() -> list[Workflow]:
    if not SKILLS_FILE.exists():
        return []
    data = json.loads(SKILLS_FILE.read_text())
    return sorted((Workflow.from_dict(d) for d in data), key=lambda w: w.id)


def get_workflow(workflow_id: str) -> Workflow:
    for wf in list_workflows():
        if wf.id == workflow_id:
            return wf
    raise FileNotFoundError(f"No workflow named '{workflow_id}' in {SKILLS_FILE}")


def save_workflows(workflows: list[Workflow]) -> None:
    WORKFLOWS_DIR.mkdir(parents=True, exist_ok=True)
    data = [asdict(wf) for wf in sorted(workflows, key=lambda w: w.id)]
    SKILLS_FILE.write_text(json.dumps(data, indent=2) + "\n")


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "skill"


def unique_id(name: str, existing_ids: set[str]) -> str:
    base = slugify(name)
    candidate = base
    n = 2
    while candidate in existing_ids:
        candidate = f"{base}-{n}"
        n += 1
    return candidate


def add_workflow(name: str, description: str, steps: list[str]) -> Workflow:
    workflows = list_workflows()
    new_id = unique_id(name, {wf.id for wf in workflows})
    workflow = Workflow(id=new_id, name=name, description=description, steps=steps)
    workflows.append(workflow)
    save_workflows(workflows)
    return workflow


def update_workflow(workflow_id: str, workflow: Workflow) -> None:
    workflows = list_workflows()
    for i, wf in enumerate(workflows):
        if wf.id == workflow_id:
            workflows[i] = workflow
            save_workflows(workflows)
            return
    raise FileNotFoundError(f"No workflow named '{workflow_id}' in {SKILLS_FILE}")


def delete_workflow(workflow_id: str) -> None:
    workflows = list_workflows()
    remaining = [wf for wf in workflows if wf.id != workflow_id]
    if len(remaining) == len(workflows):
        raise FileNotFoundError(f"No workflow named '{workflow_id}' in {SKILLS_FILE}")
    save_workflows(remaining)
