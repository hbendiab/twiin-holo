#!/usr/bin/env python3
"""Transcription locale de la voix enregistrée pendant une session (faster-whisper, rien ne sort du Mac).

Lancé par server.js à la fin de l'enregistrement, quand « Capture vocale » était activée :

    python transcribe.py --audio session/audio.webm --out session/voice.json --prompt "Excel, Notion, Gmail"

Écrit un fichier JSON :
    {"model": "small", "language": "fr", "audio_duration": 42.3, "elapsed": 12.1,
     "segments": [{"start": 6.2, "end": 9.8, "text": "Je copie le numéro de facture dans Notion"}]}

Les passages sont découpés par pause (> 1,2 s) ou toutes les 12 s au plus, à partir des mots horodatés.
`start` et `end` sont en secondes depuis le début de l'AUDIO ; server.js y ajoute l'heure de départ de l'audio
(envoyée par la page) pour les caler sur les captures et le journal d'actions.

Le premier lancement télécharge le modèle (~500 Mo pour « small »), ensuite il est en cache.
Silence ou parole introuvable : segments vides, code de sortie 0. Échec réel : message sur stderr, code 1.
"""
import argparse
import json
import sys
import time


PAUSE_S = 1.2       # un blanc plus long que ça entre deux mots coupe le passage
MAX_CHUNK_S = 12.0  # un passage ne dure jamais plus que ça (sinon l'heure de début devient imprécise)


def chunk_words(words):
    """Regroupe les mots horodatés en passages courts : coupure à chaque pause ou au bout de MAX_CHUNK_S.
    L'heure d'un passage est celle de son premier mot, donc calée sur ce que l'utilisateur faisait à ce moment-là."""
    chunks, cur = [], []
    for w in words:
        if cur and (w[0] - cur[-1][1] > PAUSE_S or w[1] - cur[0][0] > MAX_CHUNK_S):
            chunks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return [{"start": round(c[0][0], 2), "end": round(c[-1][1], 2), "text": "".join(w[2] for w in c).strip()}
            for c in chunks]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="small")
    ap.add_argument("--language", default="fr")
    ap.add_argument("--prompt", default="", help="vocabulaire attendu (noms d'outils) pour aider Whisper")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper n'est pas installé (pip install -e . dans twiin/)", file=sys.stderr)
        return 1

    t0 = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segs, info = model.transcribe(
        args.audio,
        language=args.language,
        vad_filter=True,                      # ignore les silences
        # Pas de vocabulaire par défaut : Whisper le recopie quand il hésite (« Vectornator, Vectornator… ») et
        # perd la vraie parole. `--prompt` reste disponible pour un essai à la main.
        initial_prompt=args.prompt or None,
        condition_on_previous_text=False,     # évite les boucles de répétition sur les longs silences
        word_timestamps=True,                 # l'heure de chaque mot : Whisper regroupe sinon des blocs de 20-30 s
    )
    words = []
    for s in segs:
        for w in (s.words or []):
            if w.word.strip():
                words.append((w.start, w.end, w.word))
    segments = chunk_words(words)
    out = {
        "model": args.model,
        "language": args.language,
        "audio_duration": round(info.duration, 2),
        "elapsed": round(time.time() - t0, 1),
        "segments": segments,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"{len(segments)} segment(s), {out['audio_duration']} s d'audio, {out['elapsed']} s de calcul", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
