-- =====================================================================
-- Twiin — tables de la page (Hanine), FUSIONNÉES avec le schéma d'équipe (Alexis, supabase/schema.sql)
-- Texte et chiffres seulement : les captures d'écran, l'audio et les vidéos restent sur le poste de l'employé.
--
-- Validé par Hanine le 18/11 : une seule table de tâches (public.taches) et une seule de recommandations
-- (public.recommendations), celles d'Alexis, auxquelles on AJOUTE les colonnes de la page. Aucune donnée existante
-- n'est modifiée ni supprimée ; les règles RLS d'Alexis (isolation par entreprise) restent celles qui s'appliquent.
-- Correspondances utilisées par recorder/server.js :
--   tasks.name -> taches.title · tasks.session -> taches.source_session_id · tasks.user_id -> taches.recorded_by
--   recommendations.verdict (accélérer/automatiser) -> aussi recommendations.kind (accelerate/automate)
-- Rejouable : uniquement des « if not exists ».
-- =====================================================================

-- ── 1. Colonnes de la page ajoutées aux tables d'équipe ─────────────────────────────────────────────────
alter table public.taches
  add column if not exists why    text,                                -- pourquoi la tâche est faite (analyse)
  add column if not exists source text not null default 'analyse',     -- analyse | exemple
  add column if not exists meta   jsonb;                               -- modèle, tokens, coût, images (sans les images)

alter table public.recommendations
  add column if not exists verdict    text,                            -- accélérer | automatiser (libellé de la page)
  add column if not exists advice     jsonb,                           -- conseils « accélérer »
  add column if not exists stats      jsonb,                           -- durée, clics, applis (mesures du journal)
  add column if not exists time_saved text;

-- ── 2. Tables propres à la page (chacun ses lignes) ─────────────────────────────────────────────────────
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

create table if not exists public.tutos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id     uuid references public.taches (id) on delete set null,
  created_at  timestamptz not null default now(),
  name        text not null,                  -- nom du fichier vidéo (la vidéo reste sur le poste)
  title       text,
  seconds     integer,
  steps       jsonb
);

create table if not exists public.automations (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id     uuid references public.taches (id) on delete set null,
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

create table if not exists public.back_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  t           timestamptz not null default now(),
  kind        text not null,
  cost_usd    numeric(10, 6),
  data        jsonb
);

create index if not exists audits_user_idx   on public.audits (user_id, created_at desc);
create index if not exists tutos_user_idx    on public.tutos (user_id, created_at desc);
create index if not exists runs_user_idx     on public.automation_runs (user_id, n8n_id, started_at desc);
create index if not exists back_log_user_idx on public.back_log (user_id, t desc);
create index if not exists taches_source_idx on public.taches (recorded_by, source, created_at desc);

-- ── 3. Sécurité : chacun ses lignes (taches et recommendations gardent les règles d'équipe d'Alexis) ──────
alter table public.profiles        enable row level security;
alter table public.audits          enable row level security;
alter table public.tutos           enable row level security;
alter table public.automations     enable row level security;
alter table public.automation_runs enable row level security;
alter table public.back_log        enable row level security;

do $$
declare t text;
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profil : le sien') then
    create policy "profil : le sien" on public.profiles
      for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
  end if;
  foreach t in array array['audits', 'tutos', 'automations', 'automation_runs', 'back_log'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || ' : les siens') then
      execute format(
        'create policy "%1$s : les siens" on public.%1$I for all to authenticated
           using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    end if;
  end loop;
end $$;
