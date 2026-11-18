"""Garde-fous Twiin pour le pilote d'ordinateur local de H.

En mode local, l'agent de H peut, en plus de la souris et du clavier, exécuter des commandes shell et
lire ou écrire des fichiers sur la machine. Lors d'un essai, il a ainsi listé les apps ouvertes et
l'adresse de tous les onglets Chrome pour retrouver une fenêtre. C'est contraire à la règle de
confiance de Twiin : l'agent rejoue une tâche À L'ÉCRAN, il ne fouille pas le poste.

Ces actions sont exécutées par le pilote DANS notre processus : on les refuse ici, avant qu'elles
n'atteignent le système. Holo reçoit un refus explicite et doit passer par l'écran.

    from twiin.clients.holo import guards
    guards.enable()           # avant de démarrer une session locale
"""
from __future__ import annotations

import logging

log = logging.getLogger("twiin.guards")
REFUSAL = ("Refusé par Twiin : les commandes et l'accès aux fichiers sont désactivés sur ce poste. "
           "Utilise uniquement l'écran (souris, clavier, défilement).")
blocked: list[str] = []
_enabled = False


def enable() -> None:
    global _enabled
    if _enabled:
        return
    from hai_drivers.desktop.local import driver as drv
    from hai_drivers.desktop.models import RunCommandResponse

    D = drv.LocalDesktopDriver

    def run_command(self, command, *args, **kwargs):
        shown = " ".join(command) if isinstance(command, (list, tuple)) else str(command)
        blocked.append(f"commande : {shown[:200]}")
        log.warning("commande refusée : %s", shown[:200])
        return RunCommandResponse(returncode=126, stdout="", stderr=REFUSAL)

    def read_file(self, path):
        blocked.append(f"lecture de fichier : {path}")
        log.warning("lecture refusée : %s", path)
        raise PermissionError(REFUSAL)

    def write_file(self, path, content):
        blocked.append(f"écriture de fichier : {path}")
        log.warning("écriture refusée : %s", path)
        raise PermissionError(REFUSAL)

    D.run_command = run_command
    D.read_file = read_file
    D.write_file = write_file
    _enabled = True
