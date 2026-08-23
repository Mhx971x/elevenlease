-- Facturation clients Eleven Lease.
-- Les tables restent privees : seules les fonctions Edge utilisant la cle
-- service_role peuvent les lire ou les modifier.

create table if not exists public.invoice_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default 'Eleven Lease',
  legal_status text not null default 'Société en cours d''immatriculation',
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text not null default 'France',
  registration_number text not null default 'SIRET en cours d''attribution',
  rcs text,
  vat_mode text check (vat_mode in ('standard', 'exempt')),
  vat_number text,
  default_vat_rate numeric(5,2) not null default 20,
  email text not null default 'contact@elevenlease.fr',
  phone text,
  iban text,
  bic text,
  payment_terms_days integer not null default 0 check (payment_terms_days between 0 and 120),
  updated_at timestamptz not null default now()
);

insert into public.invoice_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.invoice_counters (
  document_type text not null check (document_type in ('invoice', 'credit_note')),
  sequence_year integer not null,
  next_value integer not null default 1 check (next_value > 0),
  primary key (document_type, sequence_year)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  document_type text not null default 'invoice' check (document_type in ('invoice', 'credit_note')),
  invoice_number text unique,
  sequence_year integer,
  sequence_number integer,
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'credited')),
  lead_id text,
  related_invoice_id uuid references public.invoices(id),
  issue_date date,
  service_date date,
  due_date date,
  customer_name text not null,
  customer_email text,
  customer_address_line1 text,
  customer_address_line2 text,
  customer_postal_code text,
  customer_city text,
  customer_country text not null default 'France',
  service_label text not null,
  quantity numeric(10,2) not null default 1,
  unit_price_ht numeric(12,2) not null,
  vat_rate numeric(5,2) not null default 0,
  total_ht numeric(12,2) not null,
  vat_amount numeric(12,2) not null,
  total_ttc numeric(12,2) not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  payment_method text,
  notes text,
  issuer_snapshot jsonb not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz,
  constraint invoices_sequence_unique unique (document_type, sequence_year, sequence_number),
  constraint invoices_number_when_issued check (
    (status = 'draft' and invoice_number is null)
    or (status <> 'draft' and invoice_number is not null)
  )
);

create index if not exists invoices_created_at_idx on public.invoices (created_at desc);
create index if not exists invoices_lead_id_idx on public.invoices (lead_id);

alter table public.invoice_settings enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;

revoke all on public.invoice_settings from anon, authenticated;
revoke all on public.invoice_counters from anon, authenticated;
revoke all on public.invoices from anon, authenticated;

create or replace function public.issue_client_invoice(payload jsonb, draft_id uuid default null)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_year integer;
  v_sequence integer;
  v_number text;
  v_issue_date date;
  v_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_vat_rate numeric(5,2);
  v_total_ht numeric(12,2);
  v_vat_amount numeric(12,2);
  v_total_ttc numeric(12,2);
begin
  v_issue_date := coalesce(nullif(payload->>'issue_date', '')::date, current_date);
  v_year := extract(year from v_issue_date)::integer;
  v_quantity := round(coalesce(nullif(payload->>'quantity', '')::numeric, 1), 2);
  v_unit_price := round((payload->>'unit_price_ht')::numeric, 2);
  v_vat_rate := round(coalesce(nullif(payload->>'vat_rate', '')::numeric, 0), 2);
  v_total_ht := round(v_quantity * v_unit_price, 2);
  v_vat_amount := round(v_total_ht * v_vat_rate / 100, 2);
  v_total_ttc := v_total_ht + v_vat_amount;

  if trim(coalesce(payload->>'customer_name', '')) = ''
    or trim(coalesce(payload->>'customer_address_line1', '')) = ''
    or trim(coalesce(payload->>'customer_postal_code', '')) = ''
    or trim(coalesce(payload->>'customer_city', '')) = ''
    or trim(coalesce(payload->>'service_label', '')) = ''
    or v_quantity <= 0
    or v_unit_price <= 0
    or v_vat_rate < 0 then
    raise exception 'Informations de facture invalides';
  end if;

  insert into public.invoice_counters (document_type, sequence_year, next_value)
  values ('invoice', v_year, 2)
  on conflict (document_type, sequence_year)
  do update set next_value = public.invoice_counters.next_value + 1
  returning next_value - 1 into v_sequence;

  v_number := 'EL-' || v_year || '-' || lpad(v_sequence::text, 4, '0');

  if draft_id is not null then
    update public.invoices
    set
      invoice_number = v_number,
      sequence_year = v_year,
      sequence_number = v_sequence,
      status = 'issued',
      issue_date = v_issue_date,
      service_date = nullif(payload->>'service_date', '')::date,
      due_date = nullif(payload->>'due_date', '')::date,
      lead_id = nullif(payload->>'lead_id', ''),
      customer_name = trim(payload->>'customer_name'),
      customer_email = nullif(trim(payload->>'customer_email'), ''),
      customer_address_line1 = trim(payload->>'customer_address_line1'),
      customer_address_line2 = nullif(trim(payload->>'customer_address_line2'), ''),
      customer_postal_code = trim(payload->>'customer_postal_code'),
      customer_city = trim(payload->>'customer_city'),
      customer_country = coalesce(nullif(trim(payload->>'customer_country'), ''), 'France'),
      service_label = trim(payload->>'service_label'),
      quantity = v_quantity,
      unit_price_ht = v_unit_price,
      vat_rate = v_vat_rate,
      total_ht = v_total_ht,
      vat_amount = v_vat_amount,
      total_ttc = v_total_ttc,
      payment_method = nullif(trim(payload->>'payment_method'), ''),
      notes = nullif(trim(payload->>'notes'), ''),
      issuer_snapshot = payload->'issuer_snapshot',
      issued_at = now(),
      updated_at = now()
    where id = draft_id and status = 'draft' and document_type = 'invoice'
    returning * into v_invoice;

    if v_invoice.id is null then
      raise exception 'Brouillon introuvable ou déjà émis';
    end if;
  else
    insert into public.invoices (
      document_type, invoice_number, sequence_year, sequence_number, status,
      lead_id, issue_date, service_date, due_date,
      customer_name, customer_email, customer_address_line1, customer_address_line2,
      customer_postal_code, customer_city, customer_country,
      service_label, quantity, unit_price_ht, vat_rate, total_ht, vat_amount, total_ttc,
      payment_method, notes, issuer_snapshot, issued_at
    ) values (
      'invoice', v_number, v_year, v_sequence, 'issued',
      nullif(payload->>'lead_id', ''), v_issue_date, nullif(payload->>'service_date', '')::date,
      nullif(payload->>'due_date', '')::date,
      trim(payload->>'customer_name'), nullif(trim(payload->>'customer_email'), ''),
      trim(payload->>'customer_address_line1'), nullif(trim(payload->>'customer_address_line2'), ''),
      trim(payload->>'customer_postal_code'), trim(payload->>'customer_city'),
      coalesce(nullif(trim(payload->>'customer_country'), ''), 'France'),
      trim(payload->>'service_label'), v_quantity, v_unit_price, v_vat_rate,
      v_total_ht, v_vat_amount, v_total_ttc,
      nullif(trim(payload->>'payment_method'), ''), nullif(trim(payload->>'notes'), ''),
      payload->'issuer_snapshot', now()
    ) returning * into v_invoice;
  end if;

  return v_invoice;
end;
$$;

create or replace function public.create_invoice_credit(source_invoice_id uuid, credit_date date default current_date)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.invoices;
  v_credit public.invoices;
  v_year integer;
  v_sequence integer;
  v_number text;
begin
  select * into v_source
  from public.invoices
  where id = source_invoice_id and document_type = 'invoice'
  for update;

  if v_source.id is null or v_source.status not in ('issued', 'paid') then
    raise exception 'Cette facture ne peut pas faire l''objet d''un avoir';
  end if;

  if exists (select 1 from public.invoices where related_invoice_id = v_source.id and document_type = 'credit_note') then
    raise exception 'Un avoir existe déjà pour cette facture';
  end if;

  v_year := extract(year from credit_date)::integer;
  insert into public.invoice_counters (document_type, sequence_year, next_value)
  values ('credit_note', v_year, 2)
  on conflict (document_type, sequence_year)
  do update set next_value = public.invoice_counters.next_value + 1
  returning next_value - 1 into v_sequence;

  v_number := 'AV-EL-' || v_year || '-' || lpad(v_sequence::text, 4, '0');

  insert into public.invoices (
    document_type, invoice_number, sequence_year, sequence_number, status,
    lead_id, related_invoice_id, issue_date, service_date, due_date,
    customer_name, customer_email, customer_address_line1, customer_address_line2,
    customer_postal_code, customer_city, customer_country,
    service_label, quantity, unit_price_ht, vat_rate, total_ht, vat_amount, total_ttc,
    payment_method, notes, issuer_snapshot, issued_at
  ) values (
    'credit_note', v_number, v_year, v_sequence, 'issued',
    v_source.lead_id, v_source.id, credit_date, v_source.service_date, credit_date,
    v_source.customer_name, v_source.customer_email, v_source.customer_address_line1,
    v_source.customer_address_line2, v_source.customer_postal_code, v_source.customer_city,
    v_source.customer_country,
    'Annulation - ' || v_source.service_label, v_source.quantity,
    -abs(v_source.unit_price_ht), v_source.vat_rate, -abs(v_source.total_ht),
    -abs(v_source.vat_amount), -abs(v_source.total_ttc),
    v_source.payment_method, 'Avoir intégral relatif à la facture ' || v_source.invoice_number,
    v_source.issuer_snapshot, now()
  ) returning * into v_credit;

  update public.invoices
  set status = 'credited', updated_at = now()
  where id = v_source.id;

  return v_credit;
end;
$$;

revoke execute on function public.issue_client_invoice(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.create_invoice_credit(uuid, date) from public, anon, authenticated;
grant execute on function public.issue_client_invoice(jsonb, uuid) to service_role;
grant execute on function public.create_invoice_credit(uuid, date) to service_role;
