-- Permet à l'admin de récupérer un lien actif sans stocker le jeton en clair.
-- Le jeton reste haché pour l'accès public et une copie AES-GCM chiffrée est
-- conservée uniquement pour la fonction admin utilisant la service_role.
alter table public.document_portals
  add column if not exists token_ciphertext text,
  add column if not exists token_iv text;

comment on column public.document_portals.token_ciphertext is
  'Jeton du portail chiffré en AES-GCM pour récupération par la fonction admin';
comment on column public.document_portals.token_iv is
  'Vecteur d’initialisation AES-GCM associé au jeton chiffré';
