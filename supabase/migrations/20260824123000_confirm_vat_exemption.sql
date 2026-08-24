-- Confirme le régime fiscal communiqué par l'exploitant le 24 août 2026.
-- Les factures restent sans TVA tant que la franchise en base s'applique.

update public.invoice_settings
set
  vat_mode = 'exempt',
  vat_number = null,
  default_vat_rate = 0,
  updated_at = now()
where id = 1;

alter table public.invoice_settings
  alter column vat_mode set default 'exempt',
  alter column vat_mode set not null,
  alter column default_vat_rate set default 0,
  alter column default_vat_rate set not null;
