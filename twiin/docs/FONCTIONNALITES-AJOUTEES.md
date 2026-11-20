# Ce qui a été ajouté sur la branche `camil-test-amelioration`

Document de suivi, rédigé le 19/11/2026. Il décrit ce qui marche, comment l'utiliser, et ce qui reste à faire.

## 1. Mes enregistrements

Une page dans le menu « Mes résultats » qui liste tous les enregistrements.

- **Titre et date** : chaque enregistrement affiche un titre (le nom de la tâche s'il est analysé, sinon l'application et la fenêtre les plus utilisées), la date et l'heure.
- **Ouvrir et modifier** : ouvre la tâche sur le même écran qu'après un enregistrement. Les étapes sont modifiables, et chaque modification est **sauvegardée automatiquement** dans l'enregistrement.
- **Analyse à la demande** : un enregistrement non analysé propose « Analyser (utilise Holo) ». L'analyse n'est jamais relancée sans demande, pour limiter les coûts.
- **Mettre à la corbeille** : l'enregistrement disparaît de la liste mais reste récupérable.
- **Corbeille** (onglet dans la même page) : restaurer, supprimer définitivement, ou vider toute la corbeille (avec confirmation). Un avis indique que les enregistrements sont supprimés **au bout de 30 jours**, avec le nombre de jours restants. Les éléments plus vieux sont supprimés automatiquement.
- Chaque analyse est gardée **dans le dossier de son enregistrement** (`analysis.json`), donc elle n'est plus écrasée par la suivante.

## 2. Ajouter une tâche oubliée

Pour compléter une tâche déjà enregistrée sans la refaire.

1. Dans « Mes enregistrements », clique sur **« Ajouter une tâche oubliée »** sur la tâche concernée.
2. L'écran d'enregistrement s'ouvre avec un message qui rappelle la tâche choisie.
3. Clique sur « Enregistrer ma tâche », fais l'action oubliée, puis « Terminer et analyser ».
4. Les nouvelles étapes sont **ajoutées à la fin** de la tâche d'origine.
5. Un **bandeau vert** confirme l'ajout, indique le nombre d'étapes ajoutées et le total, et propose « Ouvrir la tâche complète ».

Ce qui se passe en coulisses :
- L'enregistrement d'ajout n'apparaît pas à part dans la liste. La tâche d'origine affiche le nombre d'ajouts (« 3 ajout(s) de tâche oubliée »).
- Un ajout peut être fait plusieurs fois sur la même tâche.
- La vidéo de la tâche inclut les images de l'enregistrement d'origine **et** celles des ajouts, enchaînées sans trou.

## 3. Pendant l'enregistrement

- **Pause** : un bouton « Pause » met l'enregistrement en pause. Pendant la pause, les clics, les touches et les captures ne sont pas enregistrés. Le bouton devient « Reprendre ».
- **Changer de section** (Audit, Recommandation…) pendant un enregistrement demande une **confirmation**. Si tu confirmes, l'enregistrement est arrêté et analysé. Sinon, tu restes sur l'enregistrement.
- **Quitter la page** pendant un enregistrement affiche un avertissement.
- **Rechargement de la page** : si un journal reste ouvert sur le serveur, il est arrêté automatiquement, pour ne pas continuer à noter les clics en arrière-plan.
- Le journal enregistre aussi **l'adresse de l'onglet Chrome** (par exemple `?size=S` pour une taille choisie). Cela demande l'autorisation macOS « Automatisation → Google Chrome ».

## 4. Automatisations n8n

- **Relancer l'étape échouée** : quand un test ou une automatisation a échoué, un bouton relance la dernière exécution en échec à partir de l'étape qui a planté. Les étapes réussies ne sont pas refaites. Le bouton est disponible sous le plan de création, et dans « Mes automatisations ».
- **Lancer une automatisation existante** : une section liste les plans et les lance sans les regénérer. **Attention** : `main` contient déjà une fonction équivalente, à garder en un seul exemplaire lors de la fusion.
- **Refus du jeton MCP** : un refus de n8n (jeton invalide) est maintenant signalé, au lieu d'être pris pour un succès.
- **Raison d'un blocage** : quand n8n refuse de lancer un test, le message exact s'affiche sous le plan.
- **Contrôle des valeurs Holo** : le contrôle lit maintenant les valeurs rangées dans `data` (corrige un blocage à tort).

## 5. Vidéo de formation

- Les tutos utilisent une voix imposée, réglée par `ELEVENLABS_TUTO_VOICE_ID` (facultatif). Actuellement : une voix du forfait gratuit, en anglais, en attendant l'API payante.
- Le format audio est compatible avec le forfait gratuit (128 kbps).
- Les paquets du montage (Remotion, dans `tuto/video/`) ont été installés : sans eux, le montage échoue.

## 6. Autres corrections

- Une page ouverte avec un enregistrement choisi n'est plus remplacée par la dernière analyse.
- Les étapes d'une tâche se replient et se déplient (le titre « N étapes » sert de menu déroulant). Les tâches d'un enregistrement précédent sont repliées par défaut.
- Le menu latéral ouvre directement « Mes enregistrements ».

## 7. Configuration (fichier `twiin/.env`)

| Variable | Rôle | Remarque |
|---|---|---|
| `N8N_LOCAL_API_KEY` | Clé de l'API publique n8n | Doit être une clé « public-api », pas le jeton MCP |
| `N8N_LOCAL_MCP_TOKEN` | Jeton du serveur MCP n8n | Doit être valide |
| `ELEVENLABS_API_KEY` | Clé ElevenLabs | Permissions synthèse vocale et transcription |
| `ELEVENLABS_AUDIT_VOICE_ID` | Voix de l'audit | Doit être accessible au compte |
| `ELEVENLABS_TUTO_VOICE_ID` | Voix imposée pour les tutos | Facultatif |

Les fichiers `.env` ne sont pas publiés (ignorés par Git).

## 8. Limites connues

- **Relance d'étape** : pas encore testée sur une vraie erreur de bout en bout.
- **Voix** : la voix est en anglais et réservée au forfait gratuit pour l'instant.
- **Analyse des ajouts** : chaque ajout est analysé seul, puis ses étapes sont ajoutées à la fin. Il n'y a pas encore de choix de l'endroit d'insertion.
- **Images des tutos** : elles viennent des enregistrements faits sur ce Mac uniquement.
- **Historique perdu** : l'analyse Supreme d'origine a été écrasée avant la mise en place de l'historique. Elle peut être relancée depuis son enregistrement.
- **Lunchly** (port 3000) n'est pas concerné par ce travail.

## 9. Fichiers de tests

Les anciens enregistrements de test ont été déplacés dans `workflows/sauvegarde-avant-nettoyage-2026-11-19/` (ignoré par Git). Un fichier `LISEZMOI.txt` explique comment les remettre.
