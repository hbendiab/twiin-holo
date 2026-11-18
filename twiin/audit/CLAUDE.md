# CLAUDE.md — Twiin, brique Audit v2

> Lis ce fichier en entier avant de coder. Il remplace l'« ordre de travail » de `BRIEF_CLAUDE_CODE.md` ; le reste du brief (inventaire macOS, filtre métier 3 couches, détection d'API) reste valable.

## Contexte produit
Twiin s'installe dans une PME/TPE (pas de DSI, acheteur = dirigeant ou DAF). Il audite le poste, observe un process, crée un jumeau des applis traversées, teste le process sur le jumeau et ne certifie la carte qu'après un seuil de réussite.
**But de la brique Audit** : sortir le **top 3 des process à automatiser**, chiffré en heures/semaine, pour décider quoi observer ensuite. Une liste d'applis seule ne suffit pas.

## Le changement clé de la v2
Avant : questions vocales, puis liste des applis les plus utilisées. Les deux ne se croisaient pas.
Maintenant : **l'audit passif tourne AVANT les questions**, pour que l'employé **reconnaisse et confirme** au lieu de devoir se souvenir et tout déclarer.

## Parcours en 4 temps

### Temps 0 — Dirigeant (≈ 3 min, une seule fois par entreprise)
- Objectif principal (choix unique) : gagner du temps / réduire les erreurs / absorber plus de volume sans recruter / préparer la facturation électronique.
- Irritants connus (multi-choix + champ libre).
- Coût horaire chargé moyen (curseur, défaut 35 €/h) : sert au calcul des euros.
- Consentement entreprise + sources autorisées.

### Temps 1 — Audit outils passif (automatique, aucun effort employé)
- Ce qui est déjà spécifié : logiciels installés, téléchargements, historique navigateur (domaines agrégés uniquement), filtre métier, détection d'API.
- **Ajout** : connecteur Google Workspace ou Microsoft 365 (si l'admin accepte) pour lister les applis tierces connectées aux comptes pro. C'est une source prioritaire, plus fiable et moins intrusive que l'historique.
- Sortie : la liste des applis métier avec fréquence d'usage. **Elle alimente les écrans du temps 2.**

### Temps 2 — Onboarding employé guidé (objectif < 7 min)
Interface **hybride : clic pour le structuré, voix pour le qualitatif.** La voix lit les questions ; l'employé peut répondre en cliquant ou en parlant.

| # | Question | Composant UI | Pré-remplissage |
|---|---|---|---|
| 1 | « Voici les outils que vous utilisez le plus. Lesquels servent à votre travail ? » | Grille d'icônes d'applis, cochées par défaut ; bouton « + ajouter » | Top applis du temps 1 |
| 2 | « Quelles tâches faites-vous au moins une fois par semaine ? » | Cartes de tâches à cocher + « Autre (dicter) » | Bibliothèque de tâches selon le rôle et les applis détectées (voir plus bas) |
| 3 | Pour chaque tâche cochée : « Combien de fois par semaine ? » | Puces : 1 / 2-5 / 6-20 / 20+ | — |
| 4 | « Combien de temps à chaque fois ? » | Puces : < 5 min / 5-15 / 15-30 / 30-60 / > 1 h | — |
| 5 | « Quels outils ouvrez-vous pour cette tâche ? Recopiez-vous des infos de l'un à l'autre ? » | Glisser les icônes de la Q1 dans l'ordre + interrupteur « je recopie » | Applis de la Q1 |
| 6 | « Qu'est-ce qui la déclenche ? » | Puces : un mail / une date / une demande d'un collègue / un document reçu / autre | — |
| 7 | « Que se passe-t-il quand ça ne se passe pas comme d'habitude ? » | **Voix libre** (transcription), facultatif | — |
| 8 | « Si vous pouviez déléguer une seule tâche demain, laquelle ? » | Choix unique parmi les tâches cochées | — |

Règles UX non négociables :
- **Toujours une option « Autre » / « Je ne sais pas »** : ne jamais forcer à choisir une suggestion.
- Les suggestions viennent des **données réelles** (temps 1) ou d'une bibliothèque par rôle, **pas d'un LLM qui invente**.
- Les questions 3 à 7 ne portent que sur **les 3 tâches les plus lourdes** (fréquence × durée calculées en direct), pas sur toutes.
- Barre de progression visible, reprise possible plus tard, temps estimé affiché au début.
- Écran final : « Voici ce qu'on a compris » (récap modifiable) **avant** l'envoi.

### Temps 3 — Croisement + score (automatique)
1. **Croiser déclaratif et observé** :
   - tâche déclarée mais outil associé jamais observé en 30 jours → `alerte: "outil_non_observe"` ;
   - appli métier très utilisée mais rattachée à aucune tâche → `alerte: "tache_cachee_possible"` (question de relance optionnelle) ;
   - durée déclarée × fréquence > temps d'usage observé de l'outil → `alerte: "surestimation_possible"`.
2. **Scorer chaque tâche** (v1, pondérations à calibrer, documente-les dans `scoring.py`) :
   - `cout_hebdo_min = frequence_semaine (milieu de la tranche) × duree_min (milieu de la tranche)`
   - `potentiel` (0-100) : moyenne de 3 critères 0-100 : entrées numériques et structurées, peu de variantes, peu de décisions subjectives (inféré des Q5 à Q7).
   - `facilite` (0-100) : nombre d'applis traversées (moins = mieux), part d'applis avec API, process stable (pas d'exceptions fréquentes en Q7), recopie entre applis (bonus : cible idéale pour le computer use).
   - Tranches facilité : facile ≥ 65, moyen 35-65, difficile < 35 (reprend la logique UiPath Automation Hub).
   - `priorite = cout_hebdo_min × potentiel/100 × facilite/100`
   - **Règle « ne pas automatiser »** : `cout_hebdo_min < 60` OU `potentiel < 35` → `recommandation: "ne_pas_automatiser"` ou `"simplifier_d_abord"`.
3. **Sortie** : `opportunites[]` triées par priorité, top 3 marqués `a_observer: true`, avec heures/semaine et €/an (`cout_hebdo_min/60 × cout_horaire × 47 semaines`).

## Modèle de données
Étendre `fiche-audit.schema.json` en **v2.0** (garder la compatibilité avec les champs existants) :
- `dirigeant` : `{objectif, irritants[], cout_horaire}`
- `taches[]` : `{id, libelle, source: "suggestion"|"saisie_libre", frequence_tranche, duree_tranche, applis_ids[], recopie, declencheur, exceptions_transcript, deleguer_en_premier}`
- `alertes[]` : `{type, tache_id?, application_id?, message}`
- `opportunites[]` : `{tache_id, cout_hebdo_min, potentiel, facilite, tranche_facilite, priorite, recommandation, a_observer, gain_heures_semaine, gain_euros_an}`
- Mettre à jour `fiche-audit.exemple.json` avec un exemple cohérent (assistant(e) de direction, process contrats d'alternance).

## Bibliothèque de tâches suggérées
`data/taches_par_role.yaml` : ~10 tâches par rôle (assistant(e) de direction, comptable, RH, commercial, gestion scolarité). Chaque tâche liste les applis typiques ; une tâche est proposée si son rôle correspond OU si ≥ 1 de ses applis a été détectée au temps 1. Commencer par le rôle « assistant(e) de direction / scolarité » (cas de démo : contrats d'alternance).

## Confidentialité (bloquant)
- Historique navigateur : domaines agrégés uniquement, jamais d'URL ni de titre de page.
- Transcription vocale de la Q7 : stockée sur le poste, jamais envoyée au LLM avec un nom de personne ; identifiant de poste pseudonymisé.
- Le dirigeant voit les tâches et les scores **agrégés par rôle**, pas les réponses individuelles nominatives.

## Tests à écrire en premier
- Calcul du score sur 5 tâches fixtures (dont une sous le seuil « ne pas automatiser »).
- Les 3 alertes de croisement se déclenchent sur des fixtures dédiées.
- Le temps 2 ne propose que des applis issues du temps 1 ou de la bibliothèque (jamais de suggestion inventée).
- La fiche v2 d'exemple valide le schéma v2.

## Hors périmètre hackathon
Windows, connecteur Microsoft 365 (garder Google Workspace en simulé si besoin), synthèse vocale de qualité production. La voix peut être un simple TTS ; le clic doit fonctionner sans la voix.

## Ordre de travail
1. Schéma v2 + exemple + tests de score → 2. `scoring.py` + croisement → 3. Bibliothèque de tâches → 4. API back exposant `/audit/outils`, `/onboarding/questions` (pré-remplies), `/onboarding/reponses`, `/audit/resultat` → 5. Front du temps 2 (grille d'icônes, puces, récap) → 6. Écran résultat : top 3 avec heures et euros.
