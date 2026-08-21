-- PostgreSQL/Supabase production schema for the multi-tenant loyalty system.
-- Authentication, Turnstile verification, OTP delivery, and mutations run server-side.

create extension if not exists pgcrypto;

create type public.profile_role as enum ('customer', 'staff', 'owner');
create type public.program_type as enum ('stamps', 'points');
create type public.barcode_kind as enum ('identifier', 'redemption');
create type public.transaction_kind as enum ('visit', 'points', 'redeem', 'adjustment', 'undo');
create type public.transaction_source as enum ('scan', 'manual', 'owner', 'undo');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  program_type public.program_type not null default 'stamps',
  stamp_goal smallint not null default 10 check (stamp_goal between 1 and 50),
  points_per_dollar numeric(8,2) not null default 1 check (points_per_dollar > 0),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.profile_role not null,
  first_name text not null,
  last_name text not null default '',
  phone_e164 text,
  stamps integer not null default 0 check (stamps >= 0),
  points integer not null default 0 check (points >= 0),
  staff_code text,
  pin_hash text,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone_e164),
  check ((role = 'customer' and phone_e164 is not null) or role <> 'customer'),
  check ((role in ('staff', 'owner') and pin_hash is not null) or role = 'customer')
);

create index profiles_tenant_name_idx on public.profiles (tenant_id, lower(first_name), lower(last_name));
create index profiles_tenant_phone_idx on public.profiles (tenant_id, phone_e164);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text not null default '',
  stamp_cost integer not null default 1 check (stamp_cost > 0),
  point_cost integer not null default 1 check (point_cost > 0),
  promotion_rule text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index rewards_tenant_active_idx on public.rewards (tenant_id, active);

create table public.barcodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  reward_id uuid references public.rewards(id) on delete restrict,
  kind public.barcode_kind not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'identifier' and reward_id is null) or (kind = 'redemption' and reward_id is not null))
);

create index barcodes_tenant_customer_expiry_idx on public.barcodes (tenant_id, customer_id, expires_at desc);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  staff_id uuid not null references public.profiles(id) on delete restrict,
  barcode_id uuid references public.barcodes(id) on delete restrict,
  kind public.transaction_kind not null,
  source public.transaction_source not null,
  stamps_changed integer not null default 0,
  points_changed integer not null default 0,
  reward_id uuid references public.rewards(id) on delete restrict,
  reverses_id uuid unique references public.transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (stamps_changed <> 0 or points_changed <> 0)
);

create index transactions_customer_time_idx on public.transactions (tenant_id, customer_id, created_at desc);
create index transactions_tenant_time_idx on public.transactions (tenant_id, created_at desc);
create unique index transactions_barcode_once_idx on public.transactions (barcode_id) where barcode_id is not null;

-- Store only privacy-preserving hashes for phone/IP rate-limit keys.
create table public.otp_requests (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_hash text not null,
  ip_hash text not null,
  turnstile_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index otp_requests_rate_idx on public.otp_requests (tenant_id, created_at desc, phone_hash, ip_hash);

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.rewards enable row level security;
alter table public.barcodes enable row level security;
alter table public.transactions enable row level security;
alter table public.otp_requests enable row level security;

create function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create function public.current_role() returns public.profile_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create policy tenant_members_read_tenant on public.tenants for select
  using (id = public.current_tenant_id());

create policy profiles_scoped_read on public.profiles for select
  using (
    tenant_id = public.current_tenant_id()
    and (id = auth.uid() or public.current_role() in ('staff', 'owner'))
  );

create policy owners_manage_profiles on public.profiles for all
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_role() = 'owner');

create policy tenant_members_read_rewards on public.rewards for select
  using (tenant_id = public.current_tenant_id() and active);

create policy owners_manage_rewards on public.rewards for all
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_role() = 'owner');

create policy customers_read_own_barcodes on public.barcodes for select
  using (tenant_id = public.current_tenant_id() and customer_id = auth.uid());

create policy staff_read_tenant_barcodes on public.barcodes for select
  using (tenant_id = public.current_tenant_id() and public.current_role() in ('staff', 'owner'));

create policy customers_read_own_transactions on public.transactions for select
  using (tenant_id = public.current_tenant_id() and customer_id = auth.uid());

create policy staff_read_tenant_transactions on public.transactions for select
  using (tenant_id = public.current_tenant_id() and public.current_role() in ('staff', 'owner'));

-- Browser roles cannot insert OTP requests, barcodes, or transactions directly.
-- Edge/server functions use a service role after verifying Turnstile, OTP, or staff PIN.

create function public.otp_rate_limit_available(
  p_tenant_id uuid,
  p_phone_hash text,
  p_ip_hash text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 3
  from public.otp_requests
  where tenant_id = p_tenant_id
    and created_at >= now() - interval '1 hour'
    and (phone_hash = p_phone_hash or ip_hash = p_ip_hash)
$$;

-- The API transaction handler must run the following checks in one SQL transaction:
-- 1. Resolve tenant_id from the authenticated staff/owner profile, never request input.
-- 2. SELECT the customer, reward, and barcode FOR UPDATE with tenant_id = current_tenant_id.
-- 3. Reject a matching scan transaction created within 30 seconds.
-- 4. Verify barcode expiry/signature and atomically set consumed_at for redemptions.
-- 5. Update the customer balance and insert the immutable transaction row.
-- Realtime clients subscribe only to rows filtered by their authenticated tenant_id.
