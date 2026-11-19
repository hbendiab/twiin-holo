# Démo : Holo + n8n pendant que l'employé continue à travailler

Deux scénarios, 100 % fictifs, qui finissent sur n8n + Holo (computer use) dans un **navigateur invisible** : l'écran, la souris
et le clavier restent à l'employé.

| Scénario | Ce qui se passe | Durée mesurée |
|---|---|---|
| 1 · Facture | une facture PDF reçue est lue, Holo la saisit dans QONTA (logiciel web sans API), chaque champ est vérifié, un mail confirme | 92 s (n8n) |
| 2 · Prix | le même casque est relevé sur 3 boutiques (pages locales), 3 lignes sont ajoutées à un Excel du PC, un mail récapitule | 51 s |

## Avant la démo

1. Démarrer n8n (`n8n start`, http://localhost:5678), le serveur Twiin (`node recorder/server.js`, port 3000) et QONTA
   (`python demo/run_qonta.py`, port 8042). Credentials n8n : Gmail autorisé (une fois).
2. `python demo/build_demo.py` : crée les données de test (factures dans `Documents/Twiin demo/Factures reçues`, classeur
   `Veille prix casque.xlsx` vide) et importe les deux workflows dans n8n.
3. **Avant chaque répétition ou démo** : `python demo/build_demo.py --reset` (remet le classeur à zéro et redonne des factures
   non saisies : INV-008, 009, 010. Trois essais possibles ; au-delà, QONTA signale un doublon).

## Pendant la démo

Ouvrir http://localhost:3000/demo/preuve.html : choisir le scénario, « Lancer l'automatisation », puis **taper dans la zone
de texte et déplacer le point** pendant le run. La page affiche le chrono et mesure : caractères tapés, plus longue pause de
frappe, pertes de focus, saccades. Mesure côté PC (Windows) : `python demo/mesure_pc.py <id>` liste les fenêtres visibles
qui apparaissent et les changements de fenêtre au premier plan (aucun sur nos essais).

## Limites connues

- Vérifié **sur Windows seulement**. Sur Mac, le navigateur invisible (Playwright) est le même ; `mesure_pc.py` ne marche pas
  (Windows uniquement) ; le reste n'a pas été testé.
- La facture n'arrive pas par mail : un PDF est déposé dans un dossier (le mail de confirmation, lui, est réel).
- Les lectures de prix de Holo peuvent varier d'une écriture (« 134.00 » ou « 134.00 € TTC » sur la même boutique).
