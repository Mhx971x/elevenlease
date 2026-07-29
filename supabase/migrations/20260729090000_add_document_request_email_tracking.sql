-- Suivi des emails Brevo envoyés manuellement depuis le mini-CRM
-- pour demander les justificatifs d'un dossier qualifié.
alter table public.leads
  add column if not exists document_request_email_status text,
  add column if not exists document_request_email_id text,
  add column if not exists document_request_email_sent_at timestamptz,
  add column if not exists document_request_email_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_document_request_email_status_check'
  ) then
    alter table public.leads
      add constraint leads_document_request_email_status_check
      check (
        document_request_email_status is null
        or document_request_email_status in ('sent', 'failed')
      );
  end if;
end
$$;

comment on column public.leads.document_request_email_status is
  'État du dernier email Brevo de demande de documents : sent ou failed';
comment on column public.leads.document_request_email_id is
  'Identifiant Brevo du dernier email de demande de documents';
comment on column public.leads.document_request_email_sent_at is
  'Date du dernier envoi réussi de demande de documents';
