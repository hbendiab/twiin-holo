-- Migration 0004 : découverte automatique d'une tâche (environnement de test interne + confirmation utilisateur)
--   status 'confirmed'  : l'utilisateur a validé « Ai-je bien compris votre problème ? » -> on peut lancer les casses
--   confirmation jsonb  : la question posée, la réponse, la correction éventuelle, la date
--   twin jsonb          : description interne du jumeau (jamais montrée à l'utilisateur)
alter table public.taches drop constraint if exists taches_status_check;
alter table public.taches add constraint taches_status_check
  check (status in ('recording', 'processing', 'analysed', 'confirmed', 'tested', 'failed', 'archived'));
alter table public.taches
  add column if not exists confirmation jsonb not null default '{}',
  add column if not exists twin         jsonb not null default '{}';
