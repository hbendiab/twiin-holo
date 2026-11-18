-- Twiin · schéma initial (18/11/2026)
-- Texte et chiffres seulement : les captures d'écran, l'audio et les vidéos restent sur le Mac de l'employé.
-- Chaque table est protégée par RLS : un employé connecté (Supabase Auth) ne lit et n'écrit que SES lignes.

-- ── Étape 1 · Audit ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  prenom            text,
  nom               text,
  poste             text,
  service           text,
  anciennete        text,
  taches_frequentes text[]  default '{}',
  tache_prioritaire jsonb,               -- { tache, frequence, pourquoi }
  outils_declares   text[]  default '{}',
  attentes          text,
  resume            text,
  answers           jsonb   default '[]', -- réponses (nettoyées) à l'accueil vocal
  corrections       jsonb   default '[]', -- corrections faites à partir du dictionnaire
  updated_at        timestamptz not null default now()
);

create table if not exists public.audits (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  with_usage  boolean not null default false, -- l'employé a accepté le classement par utilisation
  scope       text,
  summary     jsonb,
  tools       jsonb                           -- outils, composants, API, jours d'utilisation (si accepté)
);

-- ── Étapes 2 et 3 · Tâches et recommandations ────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  name        text not null,
  summary     text,
  why         text,
  steps       jsonb not null default '[]',
  session     text,                           -- dossier de l'enregistrement sur le Mac (les images y restent)
  source      text not null default 'analyse', -- analyse | exemple
  meta        jsonb                           -- modèle, tokens, coût, nombre d'images (sans les images)
);

create table if not exists public.recommendations (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id        uuid references public.tasks (id) on delete cascade,
  created_at     timestamptz not null default now(),
  verdict        text,                        -- accélérer | automatiser
  confidence     text,
  reasons        jsonb,
  frequency_hint text,
  time_saved     text,
  plan           jsonb,
  advice         jsonb,                       -- conseils « accélérer »
  stats          jsonb                        -- durée, clics, applis… (mesures du journal)
);

-- ── Étape 3 · Ce qui est créé ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.tutos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete set null,
  created_at  timestamptz not null default now(),
  name        text not null,                  -- nom du fichier vidéo (la vidéo reste sur le Mac)
  title       text,
  seconds     integer,
  steps       jsonb
);

create table if not exists public.automations (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete set null,
  created_at  timestamptz not null default now(),
  n8n_id      text not null,
  name        text,
  blocks      jsonb,
  freq        text default 'manual',          -- manual | daily | weekly | monthly
  active      boolean default false,
  unique (user_id, n8n_id)
);

create table if not exists public.automation_runs (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  n8n_id           text not null,
  n8n_execution_id text not null,
  status           text,
  mode             text,
  started_at       timestamptz,
  stopped_at       timestamptz,
  unique (user_id, n8n_execution_id)
);

-- ── Back · journal technique et coûts ────────────────────────────────────────────────────────────────────────
create table if not exists public.back_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  t           timestamptz not null default now(),
  kind        text not null,
  cost_usd    numeric(10, 6),
  data        jsonb
);

create index if not exists audits_user_idx on public.audits (user_id, created_at desc);
create index if not exists tasks_user_idx on public.tasks (user_id, created_at desc);
create index if not exists reco_task_idx on public.recommendations (task_id, created_at desc);
create index if not exists tutos_user_idx on public.tutos (user_id, created_at desc);
create index if not exists runs_user_idx on public.automation_runs (user_id, n8n_id, started_at desc);
create index if not exists back_log_user_idx on public.back_log (user_id, t desc);

-- ── Sécurité : chacun ses lignes ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles        enable row level security;
alter table public.audits          enable row level security;
alter table public.tasks           enable row level security;
alter table public.recommendations enable row level security;
alter table public.tutos           enable row level security;
alter table public.automations     enable row level security;
alter table public.automation_runs enable row level security;
alter table public.back_log        enable row level security;

create policy "profil : le sien" on public.profiles
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['audits', 'tasks', 'recommendations', 'tutos', 'automations', 'automation_runs', 'back_log'] loop
    execute format(
      'create policy "%1$s : les siens" on public.%1$I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
