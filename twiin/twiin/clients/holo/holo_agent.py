"""
HoloAgent — thin wrapper around the hai-agents SDK.

This is the reusable API surface for the workflow-recorder Holo layer
(component 3 in the engineering spec): it accepts a natural-language workflow
instruction — the shape Ashu's routine-JSON parser emits per step — and runs
it against Holo, either in the cloud sandbox or against the operator's own
logged-in machine.

    from twiin.clients.holo.holo_agent import HoloAgent

    agent = HoloAgent()
    result = agent.run("On Google Flights, find the cheapest SFO -> LAS flight")
    print(result.answer, result.replay_url)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from hai_agents import Client

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

DEFAULT_AGENT = "h/web-surfer-flash"
LOCAL_AGENT_NAME = "local-desktop"
# Modèle utilisé par les agents qu'ImproveMe crée lui-même (local et cloud). Par défaut le modèle gratuit
# Holo 3.1 ; les agents « h/web-surfer-* » de H utilisent Holo 4 (payant). Changeable via HOLO_MODEL dans .env.
HOLO_MODEL = os.environ.get("HOLO_MODEL", "holo3-1-35b-a3b")


@dataclass
class HoloResult:
    session_id: str
    answer: Optional[str]
    status: str
    replay_url: Optional[str] = None


class HoloAgent:
    """Wraps session creation, browser-profile auth, and replay links behind `run()`."""

    def __init__(
        self,
        api_key: str | None = None,
        agent: str = DEFAULT_AGENT,
        browser_profile_id: str | None = None,
    ):
        if not (api_key or os.environ.get("HAI_API_KEY")):
            raise ValueError("HAI_API_KEY not set — pass api_key= or set it in .env")
        base_url = os.environ.get("HAI_BASE_URL")  # relais Twiin sur les postes clients
        kw = {"base_url": base_url} if base_url else {}
        self.client = Client(api_key=api_key, **kw) if api_key else Client(**kw)
        self.agent = agent
        self.browser_profile_id = browser_profile_id or os.environ.get("HOLO_BROWSER_PROFILE_ID")

    def run(self, workflow: str) -> HoloResult:
        """Run a natural-language workflow instruction in the cloud sandbox.

        Uses HOLO_BROWSER_PROFILE_ID (see holo/test/export_profile.py) for auth
        if set, otherwise the session starts logged out.
        """
        run_kwargs = {}
        if self.browser_profile_id:
            run_kwargs["overrides"] = {
                "agent.environments[kind=web].browser_profile_id": self.browser_profile_id,
                "agent.environments[kind=web].persist_browser_profile": True,
            }
        result = self.client.run_session(agent=self.agent, messages=workflow, **run_kwargs)
        return self._to_result(result)

    def run_local(self, workflow: str) -> HoloResult:
        """Run a workflow against the operator's own machine.

        Auto-connects directly from this Python process — no separate
        `hai local desktop` server or session_id needed, since the agent
        object is passed inline to run_session() rather than referenced by
        name. macOS prompts for Accessibility + Screen Recording permissions
        on first run for whatever process is running this script; grant both
        and re-run.
        """
        agent = self.ensure_local_agent()
        result = self.client.run_session(agent=agent, messages=workflow)
        return self._to_result(result)

    def start(self, first_message: str, local: bool = True):
        """Start a multi-turn session and return the raw SessionHandle.

        Use this (with send_message()/wait_for_completion() on the handle,
        each converted via to_result()) instead of run()/run_local() when a
        workflow has multiple discrete steps: a multi-turn session reuses the
        same trajectory across turns instead of creating a new one per call,
        so an N-step workflow costs one concurrency slot instead of N. Local
        desktop mode in particular has a small (currently 3) concurrent
        trajectory limit shared across all local runs, so this matters.
        """
        agent = self.ensure_local_agent() if local else self.ensure_web_agent()
        kwargs = {}
        if not local and self.browser_profile_id:
            # Navigateur cloud déjà connecté aux sites (profil créé sur platform.hcompany.ai, jamais de mot de passe ici)
            kwargs["overrides"] = {
                "agent.environments[kind=web].browser_profile_id": self.browser_profile_id,
                "agent.environments[kind=web].persist_browser_profile": True,
            }
        return self.client.start_session(agent=agent, messages=first_message, **kwargs)

    def ensure_web_agent(self, model: str = HOLO_MODEL):
        """Agent navigateur cloud (environnement h/browser) avec le modèle choisi, créé une fois puis réutilisé."""
        name = f"web-surfer-{model}"
        for agent in self.client.agents.list_agents().items:
            if agent.name == name:
                return agent
        return self.client.agents.create_agent(
            name=name,
            description=f"Navigateur cloud de H piloté par {model} (créé par Twiin).",
            environments=["h/browser"],
            model=model,
        )

    def ensure_local_agent(self, model: str = HOLO_MODEL):
        """Get or create the local-desktop agent (one per model) used by run_local()/start(local=True)."""
        name = f"{LOCAL_AGENT_NAME}-{model}"
        for agent in self.client.agents.list_agents().items:
            if agent.name == name:
                return agent
        return self.client.agents.create_agent(
            name=name,
            description=f"Drives the desktop on the operator's own machine with {model} (no shell).",
            environments=[{"id": "local-machine", "kind": "desktop", "host": "user_device", "shell": False}],
            model=model,
        )

    def _to_result(self, result) -> HoloResult:
        """Convert a raw SDK result to a HoloResult and cancel the session -
        for run()/run_local()'s single-turn case, where the session is done
        the moment we have a result. Multi-turn callers (see start()) must
        NOT cancel between turns - use to_result(..., cancel=False) for those
        and only cancel after the final turn.
        """
        return self.to_result(result, cancel=True)

    def to_result(self, result, *, cancel: bool) -> HoloResult:
        try:
            replay_url = self.client.sessions.share_session(id=result.id).share_url
        except Exception:
            replay_url = None

        if cancel:
            # `idle` (the common "done, no more actions" status a turn ends
            # on) is a non-terminal, concurrency-slot-holding state per
            # H Company's rate-limits docs - it does eventually get reaped
            # server-side, but on an unknown timeout. Explicitly cancelling
            # here frees the slot immediately. Local desktop mode in
            # particular has a small (currently 3) concurrent trajectory
            # limit shared across all local runs, so this matters a lot more
            # there than it does for the cloud sandbox. Safe to call even on
            # an already-terminal session (no-op, no error).
            try:
                self.client.sessions.cancel_session(id=result.id)
            except Exception:
                pass

        return HoloResult(
            session_id=result.id,
            answer=result.answer,
            status=result.status,
            replay_url=replay_url,
        )
