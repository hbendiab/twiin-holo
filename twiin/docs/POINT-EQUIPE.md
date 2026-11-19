# Point équipe : Twiin, où on en est et quoi améliorer

Date : 19/11/2026.

## 1. Quel produit est le plus avancé

**`hbendiab/twiin-holo`, branche `main`** (commit `54bbc7f`). Raisons :
- Il contient le parcours complet : audit, enregistrement, recommandation, tuto vidéo, automatisations, Back.
- Il a une extension Chrome, une app Mac, un audit v2 testé (32 tests), et une base Supabase prête.
- Les blocs Holo peuvent tourner dans le cloud, donc le Mac de l'employé reste libre.
- C'est la seule base qui est sur la voie d'un produit utilisable par un employé, pas seulement d'un test.

Les branches de Lucas (`dev`, `lucas-twiin-decouverte`) et de Louis sont des expérimentations : enregistreur, observer, tests de modèles. Elles sont utiles pour la recherche, mais elles ne forment pas un produit complet.

## 2. Idées produit

### Expérience de l'utilisateur
- **Un seul fil conducteur** : l'employé voit toujours où il en est (audit → enregistrement → reco → automatisation), avec ce qui lui reste à faire.
- **Langage simple partout** : pas de termes techniques (« workflow », « nœud », « JSON »). Un écran d'erreur dit ce qui s'est passé et ce qu'il peut faire, sans jargon.
- **Confiance avant action** : avant de lancer une automatisation, Twiin montre en une phrase ce qu'elle va faire, sur quels outils, et ce qu'elle ne fera pas.
- **Reprise sans perte** : si l'employé ferme la page en pleine analyse, il retrouve son travail et l'état exact de l'analyse.
- **Retour visible** : une fois l'automatisation lancée, la page dit ce qui a été fait, avec les valeurs obtenues, pas seulement « ok ».

### Précision des résultats
- **Vérifier la couverture de l'enregistrement** : chaque option choisie pendant l'enregistrement (taille, filtre, pays, variante) doit se retrouver dans l'automatisation. Si une option manque, Twiin le signale avant le lancement.
- **Score de confiance par valeur** : un prix lu avec une confiance faible est marqué à vérifier, au lieu d'être écrit tel quel.
- **Validation humaine sur les cas limites** : quand une valeur est vide ou incohérente, Twiin demande à l'employé plutôt que de bloquer en silence.
- **Journal de l'enregistrement enrichi** : URL, titre de page, élément cliqué, et captures avant et après chaque action. Plus de contexte = moins d'erreurs d'interprétation.
- **Tests de non-régression sur des enregistrements types** : un enregistrement de référence, rejoué à chaque changement, pour détecter les régressions.

### Performance et coût
- **Temps d'analyse** : un enregistrement de 7 minutes a pris 19 minutes d'analyse, dont 18 pour Holo. Le plafond gratuit (10 requêtes par minute) impose 6,5 s entre deux appels. Piste : analyser seulement les images qui changent vraiment, et regrouper les appels.
- **Choix du modèle** : Louis a comparé holo3 et holo4. Sur son essai, holo3 est au moins aussi bon et gratuit. Piste : un modèle par étape, pas un modèle pour tout.
- **Réutiliser les résultats** : si l'enregistrement n'a pas changé, ne pas le réanalyser.
- **Exécution en parallèle** : les prix de plusieurs produits peuvent être lus en même temps, si le plafond le permet.

### Fiabilité
- **Relancer une seule étape** : quand une valeur manque, on relance ce bloc, pas toute l'automatisation.
- **Écriture idempotente** : mettre à jour la ligne existante au lieu d'ajouter des doublons (on a déjà eu des doublons pendant les tests).
- **Alerte sur variation anormale** : si une valeur change beaucoup d'une exécution à l'autre, Twiin le signale.

### Adoption et suivi
- **Tableau de bord par employé** : nombre de tâches analysées, temps gagné, automatisations actives.
- **Suivi des automatisations** : quand une automatisation échoue, l'employé reçoit une explication et une action proposée.
- **Partage** : une automatisation validée peut être partagée à un collègue sans refaire l'enregistrement.

## 3. Points à trancher
- Quelle branche est la référence : `main` (hbendiab) ou `dev` (Lucas) ?
- Qui rebase la branche `camil-test-amelioration` sur `main` ?
- Licence du code de Jérémy (`capture/`, adapté d'un produit propriétaire) à vérifier avant diffusion.
