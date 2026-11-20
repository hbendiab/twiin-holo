# Preuves de travail : Holo dans une machine virtuelle (19 et 20 novembre 2026)

Ce dossier rassemble les données brutes de la partie « VM » du projet Twiin : Holo pilote un logiciel de bureau sans API (CompTaPro, mini logiciel de comptabilité) à l'intérieur d'une machine virtuelle VirtualBox, pendant que l'utilisateur garde son écran, sa souris et son clavier.

Toutes les données viennent de la table Supabase `vm_jobs` (une ligne par tâche envoyée à la VM) et des journaux locaux. Aucune clé ni aucun mot de passe n'est dans ces fichiers ; les chemins personnels sont remplacés par `%USERPROFILE%`.

## Chiffres clés

| Mesure | Valeur |
|---|---|
| Tâches envoyées à la VM | 33 |
| Tâches terminées par Holo | 24 (les 9 autres : 3 annulées volontairement, 5 essais de recopie vers un 2e logiciel abandonnés, 1 limite de 40 étapes) |
| Durée médiane d'une lecture complète | 39 s (de 9 s à 191 s, moyenne 49 s) |
| Étapes médianes de Holo | 6 (capture d'écran → décision → action) |
| Lignes de factures lues au total | 272 |
| Lignes exactes (fournisseur, date, total TTC) | 239 sur 288 attendues, soit 83 % |
| Runs à 11 ou 12 lignes exactes sur 12 | 17 sur 24 |
| Runs parfaits (12/12) | 3 |
| Mesure « poste libre » (19/11, 300 s pendant un run) | 581 mouvements de souris et 1 289 frappes clavier de l'utilisateur sur son PC ; aucun mouvement du curseur de l'utilisateur causé par Holo |

Deux runs à 0 ligne exacte expliquent la moyenne : le 19/11 à 18:25 (la console du travailleur cachait le tableau, Holo a inventé des lignes : corrigé en mettant CompTaPro au premier plan avant chaque tâche) et le 20/11 à 07:49 (version de test de l'agent cassée, retirée aussitôt).

## Fichiers

| Fichier | Contenu |
|---|---|
| `runs_vm.csv` | Une ligne par tâche : date de création et de fin (UTC), statut, type, issue renvoyée par Holo, nombre d'étapes, durée, lignes rendues, lignes exactes sur 12, erreur éventuelle |
| `runs_vm_details.json` | Le détail de chaque tâche : mission donnée à Holo, paramètres, lignes lues, et le journal pas à pas de Holo (action choisie, raison donnée par Holo, temps écoulé). Les captures d'écran sont retirées pour garder un fichier léger |
| `mesure_poste_libre.json` | Activité clavier et souris de l'utilisateur sur son PC pendant 300 s de run, par tranches de 10 s (les touches ne sont pas enregistrées, seulement comptées) |
| `logs/1_premier_run_lecture_19-11.log` | Premier run de lecture complet : 27 étapes, 191 s, 11/12 lignes exactes |
| `logs/2_evaluation_exactitude_19-11.log` | Contrôle ligne à ligne du premier run |
| `logs/3_controle_run_19-11.log` | Run après ajout de la fin automatique : 6 étapes, 40 s, 11/12 |
| `logs/4_dernier_job_19-11.json` | Résumé du dernier run du 19/11 au soir |
| `logs/5_lancement_bouton_n8n.log` | Lancement par le bouton : page de trace créée, workflow n8n démarré |
| `logs/6_serveur_twiin_clics_lancer_automatisation_20-11.log` | Journal du serveur Twiin la nuit du 19 au 20/11 : enregistrements, analyse, recommandation n8n + Holo, puis clics sur « Lancer l'automatisation » envoyés à la VM (mission déduite de l'enregistrement, workflow n8n appelé, réponse 200) |

## Comment lire l'exactitude

Une ligne est exacte si le fournisseur, la date et le total TTC lus par Holo sont identiques à ceux de la base de CompTaPro (12 factures, dont un avoir négatif AV-504). L'erreur la plus fréquente : « Services Informatiques Girard » lu « Services Informatique », car la colonne du logiciel coupe le nom à l'écran. Holo lit ce qui est affiché.

## Chaîne technique mesurée

Twiin (bouton « Lancer l'automatisation ») → mission déduite de l'enregistrement → workflow n8n → table Supabase `vm_jobs` → la VM réveillée à la demande → travailleur dans la VM → Holo (modèle `holo3-1-35b-a3b`) lit CompTaPro à l'écran → lignes renvoyées dans Supabase → n8n les range dans `suivi_factures` → page de trace.
