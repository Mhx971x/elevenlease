-- Portails documentaires privés pour les leads qualifiés.
-- Le jeton transmis au client n'est jamais stocké en clair : seul son hash
-- SHA-256 est conservé. Les fichiers résident dans un bucket non public.

create table if not exists public.document_portals (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  completed_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists document_portals_lead_created_idx
  on public.document_portals (lead_id, created_at desc);

create index if not exists document_portals_active_token_idx
  on public.document_portals (token_hash, expires_at)
  where revoked_at is null;

create table if not exists public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references public.document_portals(id) on delete cascade,
  lead_id text not null,
  document_type text not null,
  original_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  uploaded_at timestamptz not null default now()
);

create index if not exists lead_documents_portal_uploaded_idx
  on public.lead_documents (portal_id, uploaded_at desc);

alter table public.document_portals enable row level security;
alter table public.lead_documents enable row level security;

revoke all on table public.document_portals from anon, authenticated;
revoke all on table public.lead_documents from anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'lead-documents',
  'lead-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.document_portals is
  'Liens temporaires et révocables permettant aux leads de déposer leurs justificatifs';
comment on table public.lead_documents is
  'Métadonnées des justificatifs stockés dans le bucket privé lead-documents';
