-- Suivi idempotent des confirmations Brevo envoyées après une simulation.
-- Les anciennes demandes restent inchangées : les nouveaux champs sont nuls.
alter table public.leads
  add column if not exists submission_id uuid,
  add column if not exists confirmation_email_status text,
  add column if not exists confirmation_email_id text,
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_error text;

create unique index if not exists leads_submission_id_unique
  on public.leads (submission_id)
  where submission_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_confirmation_email_status_check'
  ) then
    alter table public.leads
      add constraint leads_confirmation_email_status_check
      check (
        confirmation_email_status is null
        or confirmation_email_status in ('pending', 'sent', 'failed')
      );
  end if;
end
$$;

comment on column public.leads.submission_id is
  'Identifiant généré par le formulaire pour empêcher les doubles soumissions';
comment on column public.leads.confirmation_email_status is
  'État de la confirmation Brevo : pending, sent ou failed';
comment on column public.leads.confirmation_email_id is
  'Identifiant du message transactionnel renvoyé par Brevo';

-- Limitation anti-abus du point d'entrée public. Aucune politique RLS n'est
-- créée : seule la fonction Edge utilisant la clé service_role y accède.
create table if not exists public.simulation_submission_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists simulation_submission_attempts_ip_created_idx
  on public.simulation_submission_attempts (ip_hash, created_at desc);

alter table public.simulation_submission_attempts enable row level security;
revoke all on table public.simulation_submission_attempts from anon, authenticated;
