"""Tests de la capture vocale : transcription calée dans le temps, échec propre, fusion dans le journal.

Lancer depuis twiin/ :   .venv/bin/python -m unittest recorder/test_voice.py -v
Prérequis : macOS (commande `say`), ffmpeg, modèle Whisper « small » déjà en cache (téléchargé au premier usage).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TRANSCRIBE = os.path.join(HERE, "transcribe.py")
PHRASE = "Je copie le numéro de facture dans Notion, parce que le client veut le suivre."
DELAY_S = 6


class Transcription(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (shutil.which("say") and shutil.which("ffmpeg")):
            raise unittest.SkipTest("`say` et ffmpeg sont nécessaires pour fabriquer l'audio de test")
        cls.tmp = tempfile.mkdtemp(prefix="twiin-voice-")
        aiff = os.path.join(cls.tmp, "phrase.aiff")
        cls.webm = os.path.join(cls.tmp, "test.webm")
        subprocess.run(["say", "-v", "Thomas", "-o", aiff, PHRASE], check=True)
        # 6 s de silence puis la phrase, au format que Chrome produit (webm/opus)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-af",
                        f"adelay={DELAY_S * 1000}|{DELAY_S * 1000},apad=pad_dur=10", "-t", "20", "-c:a", "libopus", cls.webm], check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_segment_cale_sur_le_decalage(self):
        out = os.path.join(self.tmp, "voice.json")
        r = subprocess.run([sys.executable, TRANSCRIBE, "--audio", self.webm, "--out", out],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        seg = json.load(open(out, encoding="utf-8"))["segments"]
        self.assertTrue(seg, "aucun segment transcrit")
        self.assertLessEqual(abs(seg[0]["start"] - DELAY_S), 1.5, f"début à {seg[0]['start']} s au lieu de ~{DELAY_S} s")
        text = " ".join(s["text"] for s in seg).lower()
        self.assertIn("facture", text)
        self.assertIn("notion", text)

    def test_pause_longue_coupe_le_passage(self):
        """Deux phrases séparées par 8 s de silence : deux passages, le second à son heure réelle (pas un bloc unique)."""
        aiff = os.path.join(self.tmp, "phrase.aiff")
        aiff2 = os.path.join(self.tmp, "phrase2.aiff")  # une phrase DIFFÉRENTE : Whisper n'écrit pas deux fois la même de suite
        subprocess.run(["say", "-v", "Thomas", "-o", aiff2, "Ensuite je vérifie le montant dans le tableau."], check=True)
        two = os.path.join(self.tmp, "two.webm")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-i", aiff2, "-filter_complex",
                        "[1:a]adelay=9000|9000[b];[0:a][b]amix=inputs=2:duration=longest:normalize=0", "-t", "30", "-c:a", "libopus", two], check=True)
        out = os.path.join(self.tmp, "two.json")
        r = subprocess.run([sys.executable, TRANSCRIBE, "--audio", two, "--out", out], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        seg = json.load(open(out, encoding="utf-8"))["segments"]
        self.assertGreaterEqual(len(seg), 2, f"un seul passage : {seg}")
        self.assertGreaterEqual(seg[-1]["start"], 8.5, f"le 2e passage commence trop tôt : {seg[-1]}")

    def test_audio_corrompu_sort_en_erreur(self):
        junk = os.path.join(self.tmp, "junk.webm")
        with open(junk, "wb") as f:
            f.write(os.urandom(5000))
        r = subprocess.run([sys.executable, TRANSCRIBE, "--audio", junk, "--out", os.path.join(self.tmp, "x.json")],
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)


class Fusion(unittest.TestCase):
    def merge(self, actions, voice):
        js = ("import { mergeVoice } from './voice.js';"
              f"console.log(JSON.stringify(mergeVoice({json.dumps(actions)}, {json.dumps(voice)}).map(e => e.id)));")
        r = subprocess.run(["node", "--input-type=module", "-e", js], cwd=HERE, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    # Le journal écrit les saisies APRÈS coup avec l'heure de leur début : l'ordre du fichier n'est pas l'ordre des ts.
    ACTIONS = [{"id": "a", "ts": 2}, {"id": "b", "ts": 10}, {"id": "typing", "ts": 6}]

    def test_sans_voix_ordre_inchange(self):
        self.assertEqual(self.merge(self.ACTIONS, []), ["a", "b", "typing"])

    def test_voix_inseree_a_sa_place_sans_reordonner_les_actions(self):
        voice = [{"id": "v2", "ts": 8}, {"id": "v1", "ts": 7}]
        self.assertEqual(self.merge(self.ACTIONS, voice), ["a", "v1", "v2", "b", "typing"])


if __name__ == "__main__":
    unittest.main()
