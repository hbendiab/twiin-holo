"""Pitch vidéo de Twiin (2 min) : voix off ElevenLabs par scène + données pour Remotion (composition « TwiinPitch »).

    .venv/bin/python tuto/build_pitch.py            # voix + props
    cd tuto/video && npx remotion render TwiinPitch out/twiin-pitch.mp4

Le texte de chaque scène est ici ; les visuels sont dans tuto/video/src/pitch/. Les captures de l'app sont copiées depuis
le dossier --captures (images de Twiin, sans données personnelles).
"""
import argparse
import json
import shutil
from pathlib import Path

import requests
from mutagen.mp3 import MP3

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "tuto" / "video" / "public" / "pitch"
ENV = {k.strip(): v.split("#")[0].strip().strip('"').strip("'") for k, v in
       (l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if "=" in l and not l.lstrip().startswith("#"))}
VOIX = "6vTyAgAT8PncODBcLjRf"  # Claire : chaleureuse et posée (bibliothèque ElevenLabs, qualité studio)
FPS = 30
PAUSE_S = 0.5  # respiration après chaque phrase

# id de scène → texte dit (le visuel correspondant porte le même id dans src/pitch/Pitch.tsx)
SCENES = [
    ("hook", "Dans une PME, chaque salarié perd des heures par semaine à recopier des informations d'un logiciel à l'autre. "
             "Tout le monde le sait. Personne ne sait par où commencer."),
    ("probleme", "Celonis dit où ça coince. UiPath dit comment vous travaillez. "
                 "Mais personne ne prouve qu'une automatisation tient, avant de la déployer."),
    ("parcours", "Twiin, c'est le jumeau de vos tâches. Quatre étapes : auditer, observer, tester, déployer."),
    ("audit", "D'abord l'audit. Twiin repère les outils vraiment utilisés sur le poste, pose quelques questions en quelques clics, "
              "et sort les trois tâches qui coûtent le plus de temps, en heures et en euros."),
    ("observer", "Ensuite, l'employé fait sa tâche une fois, comme d'habitude. Twiin enregistre l'écran, lit le texte en local, "
                 "et en tire les étapes. Depuis le navigateur, l'extension Chrome, ou l'app Mac, par-dessus n'importe quel logiciel."),
    ("reco", "Twiin recommande la bonne option. Accélérer, avec une vidéo de formation générée automatiquement. "
             "Ou automatiser, avec n8n quand il y a une API, et l'agent Holo quand il n'y en a pas."),
    ("tester", "Le cœur de Twiin : le crash test. Twiin reconstruit la tâche dans un jumeau, avec de fausses données, "
               "puis lance trois essais en parallèle avec Holo et deux essais d'automatisation. Au-dessus de 90 % de réussite, on automatise."),
    ("resultats", "Testé sur deux tâches réelles. Un comparatif d'achat sur trois sites, automatisé en 51 secondes. "
                  "Et une facture saisie dans un logiciel sans API, en 79 secondes, toutes les valeurs justes. "
                  "La fiabilité de Holo est passée de 30 à 100 %."),
    ("archi", "Côté technique : capture et lecture de l'écran en local, sur Mac ou Windows. Qwen pour comprendre la tâche et bâtir le jumeau, "
              "Holo et n8n pour tester et exécuter, ElevenLabs et Remotion pour les vidéos, Supabase pour les données de chaque entreprise."),
    ("avancement", "Aujourd'hui, chaque brique fonctionne : audit, capture, recommandation, jumeau et essais, vidéos et automatisations. "
                   "Il reste à tout réunir dans une seule version."),
    ("roadmap", "En quatre jours, du premier test de Holo au crash test. D'ici ce soir : réunir les deux branches, "
                "tester de A à Z sur de nouveaux cas, et comparer les modèles Holo."),
    ("outro", "Twiin. Analyse tes tâches. Automatise tes process."),
]


def tts(text, out: Path):
    r = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/{VOIX}?output_format=mp3_44100_128",
                      headers={"xi-api-key": ENV["ELEVENLABS_API_KEY"], "Content-Type": "application/json"},
                      json={"text": text, "model_id": "eleven_multilingual_v2",
                            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "speed": 1.03}}, timeout=120)
    if not r.ok:
        raise SystemExit(f"ElevenLabs : {r.status_code} {r.text[:200]}")
    out.write_bytes(r.content)
    return MP3(out).info.length


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--captures", type=Path, required=True, help="dossier des captures de l'app (noms attendus dans IMAGES)")
    ap.add_argument("--logo", type=Path, required=True, help="dossier des images du logo animé (k0000.png…)")
    ap.add_argument("--reuse-voice", action="store_true", help="ne pas régénérer les voix déjà faites")
    a = ap.parse_args()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "img").mkdir(exist_ok=True)
    (PUBLIC / "logo").mkdir(exist_ok=True)
    for f in a.captures.glob("*.png"):
        shutil.copy(f, PUBLIC / "img" / f.name)
    logo = sorted(a.logo.glob("k*.png"))[::2]  # 12,5 images/s
    for i, f in enumerate(logo):
        shutil.copy(f, PUBLIC / "logo" / f"l{i:03d}.png")

    scenes, total = [], 0
    for sid, text in SCENES:
        mp3 = PUBLIC / f"{sid}.mp3"
        sec = MP3(mp3).info.length if a.reuse_voice and mp3.exists() else tts(text, mp3)
        frames = round((sec + PAUSE_S) * FPS)
        scenes.append({"id": sid, "text": text, "audio": f"pitch/{sid}.mp3", "frames": frames})
        total += frames
        print(f"{sid:11s} {sec:5.1f} s", flush=True)
    (PUBLIC / "props.json").write_text(json.dumps({"scenes": scenes, "logoFrames": len(logo)}, ensure_ascii=False, indent=2))
    print(f"→ {PUBLIC / 'props.json'} · ≈ {total / FPS:.0f} s")


if __name__ == "__main__":
    main()
