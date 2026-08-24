-- Aligne l'émetteur des factures avec l'identité juridique communiquée.
-- Le régime de TVA reste volontairement non renseigné : il doit être confirmé
-- par l'exploitant avant toute émission.

alter table public.invoice_settings
  add column if not exists siren text,
  alter column default_vat_rate drop not null,
  alter column default_vat_rate drop default;

update public.invoice_settings
set
  business_name = 'ELEVEN LEASE',
  legal_status = 'DJAFFAR Mehdi – Entrepreneur individuel / micro-entreprise',
  address_line1 = '60 rue François 1er',
  postal_code = '75008',
  city = 'Paris',
  country = 'France',
  siren = '931 287 908',
  registration_number = '931 287 908 00020',
  email = 'contact@elevenlease.fr',
  rcs = null,
  vat_mode = null,
  vat_number = null,
  default_vat_rate = null,
  updated_at = now()
where id = 1;
