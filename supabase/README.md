# Twiin — base de données Supabase

Base Postgres (Supabase) qui stocke ce que Twiin observe et recommande, **séparée par entreprise**.

- Projet Supabase : **Hackathon H Project** — `yazaogxmsknjxbgabnrq`, région `eu-central-1`, Postgres 17
- Dashboard : https://supabase.com/dashboard/project/yazaogxmsknjxbgabnrq
- Schéma complet : [`schema.sql`](schema.sql) (version 0.2)

```
 dictionnaire ──(software_ids)──►  taches ──┬──►  tests
 (logiciels)                      (1 tâche) │       │
                                            └──►  recommendations ◄─(test_id)
```

| Table | Rôle |
|---|---|
| `dictionnaire` | Les logiciels connus de Twiin, publics ou internes à une entreprise |
| `taches` | Une tâche observée : étapes, captures d'écran, transcription audio, contexte |
| `tests` | Le récap de chaque essai fait sur une tâche (rejeu Holo, exécution n8n) |
| `recommendations` | Les recommandations de l'agent après les tests |

Il n'y a **pas de table `companies` ni `profiles`** : l'entreprise et le rôle de chaque utilisateur sont lus dans son jeton de connexion (voir [Entreprises et rôles](#entreprises-et-rôles)).

---

## 1. Les tables en détail

### `dictionnaire` — les logiciels

Un logiciel est **public** (`company_id` vide : Excel, Power BI…, visible par toutes les entreprises) ou **interne** (`company_id` renseigné : visible uniquement par cette entreprise).

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid | Identifiant |
| `company_id` | uuid, nullable | `NULL` = logiciel public ; sinon l'entreprise propriétaire |
| `name` | text | Nom affiché (« Excel », « Logiciel Interne A »). Unique, sans tenir compte des majuscules : parmi les logiciels publics, et par entreprise parmi les internes |
| `has_api` | boolean | `true` : API ou connecteur officiel, donc automatisable par n8n. `false` : il faudra l'agent Holo (qui agit à l'écran) |
| `connector` | text | Connecteur n8n/Twiin (`microsoft-graph`, `google-workspace`…) |
| `domains` | text[] | Domaines web pour reconnaître le logiciel dans une capture |
| `app_names` | text[] | Noms d'application pour le reconnaître sur le poste |
| `created_at` | timestamptz | |

Catalogue public chargé au départ : Excel, Outlook, Word, Power BI, Google Sheets, Gmail, LinkedIn. Ces colonnes reprennent le registre `capture/backend/app/known_tools.json`, sans les champs que le code n'utilise pas (catégorie, éditeur, identifiant court).

> Pourquoi un seul catalogue plutôt qu'une copie par entreprise ? Excel n'existe qu'une fois, plusieurs entreprises l'utilisent, et la règle d'isolation tient en une ligne.

### `taches` — une tâche observée

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid | Identifiant de la tâche |
| `company_id` | uuid | Entreprise (obligatoire, sert à la RLS) |
| `recorded_by` | uuid | Utilisateur qui a enregistré (par défaut `auth.uid()`) |
| `title` | text | Titre |
| `summary` | text | Résumé produit par l'analyse |
| `context` | text | Contexte métier (pourquoi, quand, pour qui) |
| `status` | text | `recording` → `processing` → `analysed` → `tested`, ou `failed` / `archived` |
| `frequency` | text | Déclarée par l'employé : `rare`, `monthly`, `weekly`, `daily`, `multiple_daily` |
| `software_ids` | uuid[] | Logiciels utilisés (ids du `dictionnaire`) |
| `steps` | jsonb | Étapes ordonnées, voir ci-dessous |
| `screenshots` | jsonb | Captures d'écran (chemins Storage + texte OCR), voir ci-dessous |
| `transcript` | text | Transcription de l'audio |
| `audio_path` | text | Fichier audio dans Storage, si conservé |
| `stats` | jsonb | Mesures du journal d'actions (clics, changements d'application…) |
| `started_at`, `ended_at`, `duration_s` | | Chronologie de l'enregistrement |
| `source_session_id` | text | Id de la session locale du recorder. `unique (company_id, source_session_id)` : renvoyer deux fois la même session ne crée pas de doublon |
| `expires_at` | timestamptz | Date de purge (RGPD : les captures sont des données personnelles) |
| `created_at`, `updated_at` | timestamptz | `updated_at` est mis à jour automatiquement |

Format conseillé des colonnes `jsonb` :

```jsonc
// steps
[{ "position": 1, "instruction": "Ouvrir Excel…", "software_id": "<uuid dictionnaire>", "at_ms": 4200 }]

// screenshots  (les fichiers sont dans le bucket Storage, jamais dans la base)
[{ "storage_path": "<company_id>/<task_id>/frame-0001.png", "screen_index": 0, "at_ms": 4200, "step": 1, "ocr_text": "…" }]
```

### `tests` — récap des essais

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid | |
| `task_id` | uuid | Tâche testée (suppression en cascade) |
| `kind` | text | `holo_replay` (rejeu par Holo) ou `n8n_run` (exécution d'une automatisation) |
| `status` | text | `running`, `succeeded`, `failed`, `stopped` |
| `success_rate` | numeric | Entre 0 et 1 |
| `summary` | text | Récap lisible de l'essai |
| `steps_log` | jsonb | Journal détaillé, étape par étape |
| `error` | text | Message d'erreur éventuel |
| `cost_usd` | numeric | Coût de l'essai |
| `started_at`, `ended_at` | timestamptz | |

### `recommendations` — après les tests

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid | |
| `task_id` | uuid | Tâche concernée (suppression en cascade) |
| `test_id` | uuid, nullable | Essai qui justifie la recommandation |
| `kind` | text | `accelerate` (tuto vidéo) ou `automate` (n8n + Holo) : le verdict |
| `confidence` | text | `high`, `medium`, `low` |
| `summary` | text | |
| `reasons` | text[] | Raisons du verdict |
| `frequency_hint` | text | Fréquence probable, à confirmer par l'employé |
| `time_saved_label` | text | Gain estimé en texte libre |
| `time_saved_minutes_per_month` | integer | Gain chiffré, si estimable |
| `plan` | jsonb | Étapes du plan et conseils, voir ci-dessous |
| `status` | text | `proposed` → `accepted` / `rejected` → `implemented` |
| `decided_by`, `decided_at` | | Qui a tranché, et quand |
| `deliverable_type` | text | `video_tuto` ou `n8n_workflow` |
| `deliverable_ref` | text | Id du workflow n8n ou chemin de la vidéo |
| `model`, `cost_usd` | | Modèle utilisé et coût de l'analyse |
| `created_at` | timestamptz | |

```jsonc
// plan
[{ "position": 1, "item_type": "plan_step",            // ou "advice"
   "software_id": "<uuid dictionnaire>", "method": "holo",   // "n8n_api" | "holo" | "manual"
   "description": "Saisir la facture dans comptarex" }]
```

Une tâche peut avoir plusieurs recommandations (par exemple après une nouvelle analyse).

---

## 2. Entreprises et rôles

Chaque utilisateur est un compte **Supabase Auth**. Son entreprise et son rôle sont portés par son jeton de connexion, dans `app_metadata` :

```json
{ "company_id": "aaaaaaaa-0000-0000-0000-000000000000", "role": "admin" }
```

| Champ | Valeurs | Effet |
|---|---|---|
| `company_id` | uuid de l'entreprise (tu le choisis, par ex. `select gen_random_uuid();`) | Détermine ce que l'utilisateur voit |
| `role` | `admin` ou `member` | `admin` : voit toutes les tâches de son entreprise et gère ses logiciels internes |

Points importants :

- `app_metadata` n'est modifiable que **côté serveur** (dashboard, clé `service_role`). Un utilisateur ne peut pas l'éditer lui-même. **`user_metadata` est ignoré** : il est modifiable par l'utilisateur, donc non fiable. C'est testé (voir plus bas).
- Les valeurs sont recopiées dans le jeton à la connexion. Après un changement d'entreprise ou de rôle, **la personne doit se reconnecter**.
- Sans `company_id` dans `app_metadata`, un utilisateur ne voit que les logiciels publics et aucune tâche.

Pour renseigner un utilisateur : dashboard → Authentication → Users → l'utilisateur → modifier `app_metadata`. En SQL (à lancer dans l'éditeur SQL du dashboard) :

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"company_id": "aaaaaaaa-0000-0000-0000-000000000000", "role": "admin"}'
where email = 'prenom.nom@entreprise.fr';
```

---

## 3. Isolation entre entreprises (RLS)

La **Row Level Security** est activée sur les 4 tables. Les règles lisent l'entreprise et le rôle du jeton via deux petites fonctions du schéma `private` (non exposé par l'API) : `private.company_id()` et `private.is_admin()`.

| Table | Lecture | Écriture |
|---|---|---|
| `dictionnaire` | Logiciels publics **+** logiciels internes de **son** entreprise | **Admin** uniquement, et uniquement pour son entreprise. Le catalogue public n'est modifiable que par `service_role` |
| `taches` | Ses propres tâches ; un **admin** voit toutes celles de son entreprise | Créer pour son entreprise et à son nom ; modifier/supprimer les siennes (ou toutes pour un admin) |
| `tests` | Mêmes tâches que ci-dessus | Seulement sur une tâche qu'on peut voir |
| `recommendations` | Mêmes tâches que ci-dessus | Seulement sur une tâche qu'on peut voir |
| Storage `task-captures` | Dossier de son entreprise uniquement | Idem |
| Accès anonyme | Refusé sur toutes les tables | Refusé |

`tests` et `recommendations` n'ont pas de colonne d'entreprise : leur règle demande « puis-je voir la tâche parente ? », donc elles héritent des règles de `taches`.

### Fichiers (captures, audio)

Les fichiers vont dans le bucket **privé** `task-captures`, rangés par dossier :

```
task-captures/<company_id>/<task_id>/<fichier>
```

Le premier dossier **doit** être le `company_id` : c'est ce que vérifie la règle de Storage. La base ne garde que les chemins. Pour afficher une image, utiliser une URL signée temporaire.

---

## 4. Appliquer le schéma

`schema.sql` correspond à l'état actuel de la base et s'applique sur une base **vide** (il n'est pas rejouable : pas de `if not exists`). Sur le projet Supabase, il a été appliqué en migrations successives : `twiin_schema_v0_1`, `twiin_noms_francais`, `twiin_schema_v0_2_quatre_tables` (qui remplace l'ancien découpage en 13 tables, vides à ce moment-là), puis `dictionnaire_retire_colonnes_inutiles` (retrait de `category`, `vendor` et `slug`).

Pour un autre projet : coller `schema.sql` dans l'éditeur SQL du dashboard, ou le passer en migration.

---

## 5. Écrire depuis le recorder Twiin

Chaque membre de l'équipe écrit dans la base **avec son propre compte** et la clé **publique** : la RLS s'applique donc à chacun, et chaque tâche est enregistrée à son nom.

1. L'admin crée le compte : dashboard → Authentication → Users → Add user, avec « Auto Confirm User » coché, puis renseigne son `company_id` et son `role` dans `app_metadata` (voir section 2). Le mot de passe est transmis en privé.
2. Chaque membre copie `twiin/.env.example` en `twiin/.env` (non versionné) et remplit :
   - `SUPABASE_URL` (déjà indiquée dans le modèle) ;
   - `SUPABASE_PUBLISHABLE_KEY` : la clé publique `sb_publishable_…`, dashboard → Settings → API Keys ;
   - `SUPABASE_EMAIL` et `SUPABASE_PASSWORD` : son compte.
3. Le recorder se connecte avec ce compte avant d'écrire : `recorded_by` se remplit tout seul, et il est impossible d'écrire dans une autre entreprise.

**La clé `service_role` (`sb_secret_…`) ne doit pas être distribuée ni mise dans un `.env` d'équipe** : elle contourne toute la RLS et donne un accès complet à la base. Elle reste réservée à l'administrateur, pour les opérations d'administration (par exemple modifier le catalogue public).

Test de la connexion, depuis `twiin/recorder` :

```bash
npm install @supabase/supabase-js     # une seule fois
node test-supabase.mjs
```

Le script se connecte avec le compte du `.env`, crée une tâche de test avec une image, un essai et une recommandation, vérifie que les accès interdits sont refusés, puis supprime tout.

---

## 6. Ce qui a été testé

Le test a été fait **en local** sur un Postgres 16 avec le même SQL (Supabase est en Postgres 17), avec deux entreprises, un admin, un employé et un compte avec jeton falsifié. Pour vérifier la même chose sur le vrai projet, utiliser `twiin/recorder/test-supabase.mjs` (section 5). Sur le projet, l'analyse de sécurité de Supabase ne remonte aucune alerte.

| Cas | Résultat |
|---|---|
| Admin A voit les 7 logiciels publics + les internes de A, jamais ceux de B | ✅ |
| Noms de logiciels : doublon public (même avec une casse différente) ou doublon dans une même entreprise refusés ; même nom dans deux entreprises accepté | ✅ |
| Admin A voit les tâches de A uniquement ; employé A voit seulement les siennes | ✅ |
| B ne voit ni les tests, ni les recommandations, ni les fichiers de A | ✅ |
| Employé : créer un logiciel interne | ✅ refusé |
| Créer une tâche au nom d'un collègue, ou dans une autre entreprise | ✅ refusé |
| Ajouter un test sur la tâche d'une autre entreprise | ✅ refusé |
| B modifie ou supprime une tâche de A, un logiciel public ou un logiciel de A | ✅ aucune ligne touchée |
| Admin crée un logiciel « public » | ✅ refusé |
| Jeton avec `company_id` placé dans `user_metadata` (falsifié) | ✅ ne donne accès à rien |
| Accès anonyme | ✅ refusé |

Un défaut a été trouvé et corrigé pendant la conception de la v0.1 (un logiciel interne rattachable à une autre entreprise) ; il n'existe plus dans le modèle actuel, qui n'a plus de table de rattachement.

---

## 7. Limites connues et pistes d'amélioration

- **Pas de nom d'entreprise en base** : seul son identifiant existe, dans les jetons. Si besoin d'un nom, d'une facturation ou d'une liste de membres, ajouter une table `companies` (et éventuellement `profiles`).
- **Pas de contrôle fin des logiciels par entreprise** : un logiciel public est visible de tous. Si une entreprise ne doit pas avoir accès à Excel, il faudra une table de liaison `dictionnaire_entreprises`.
- **Liens non vérifiés** : `taches.software_ids` et les `software_id` dans les `jsonb` ne sont pas des clés étrangères (un logiciel supprimé laisse un identifiant orphelin).
- **Les `jsonb` limitent les requêtes** : « toutes les tâches qui utilisent Excel » est possible (`software_ids @> …`), mais pas les statistiques fines par étape. Si besoin, extraire `steps` dans une table à part.
- **Droits larges sur les statuts** : un employé peut modifier les champs de ses tâches, et tout utilisateur qui voit une tâche peut modifier ses recommandations, y compris `status`, `decided_by` et `decided_at`. À durcir si la décision doit être réservée aux admins.
- **Données personnelles** : un admin voit toutes les captures d'écran de son entreprise. Prévoir la durée de conservation (`expires_at`, purge à mettre en place), l'information des salariés et le consentement avant un usage réel.
- **Journal d'actions brut** : non stocké dans la base. À garder en fichier (Storage) tant qu'on n'a pas besoin de l'interroger en SQL.
