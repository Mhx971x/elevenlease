-- Nouveaux champs du parcours adaptatif Eleven Lease.
-- Les colonnes historiques restent en place pour conserver tous les anciens leads.
alter table public.leads
  add column if not exists recherche_vehicule text,
  add column if not exists motorisation text,
  add column if not exists statut_juridique text,
  add column if not exists siren text,
  add column if not exists chiffre_affaires text,
  add column if not exists anciennete_entreprise text,
  add column if not exists consent_recontact boolean;

comment on column public.leads.recherche_vehicule is
  'Modèle précis, besoin de conseil ou ouvert à plusieurs modèles';
comment on column public.leads.type_vehicule_souhaite is
  'Carrosserie souhaitée pour les recherches sans modèle précis';
comment on column public.leads.consent_recontact is
  'Consentement explicite au rappel donné lors de la soumission';
