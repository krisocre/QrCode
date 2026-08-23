begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists loyalty_private;
revoke all on schema loyalty_private from public, anon, authenticated;

create type public.profile_role as enum ('customer', 'staff', 'owner');
create type public.program_type as enum ('stamps', 'points');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'closed');
create type public.device_status as enum ('pending', 'active', 'revoked');
create type public.transaction_kind as enum ('visit', 'points', 'redeem', 'adjustment', 'undo');
create type public.transaction_source as enum ('scan', 'manual', 'owner', 'undo', 'offline', 'system');
create type public.wallet_provider as enum ('google', 'apple');
create type public.wallet_pass_status as enum ('pending', 'active', 'suspended', 'revoked', 'error');
create type public.redemption_status as enum ('issued', 'redeemed', 'expired', 'cancelled');
create type public.outbox_status as enum ('pending', 'processing', 'completed', 'dead_letter');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 1 and 120),
  legal_name text,
  timezone text not null default 'America/Toronto',
  currency_code text not null default 'CAD' check (currency_code ~ '^[A-Z]{3}$'),
  country_code text not null default 'CA' check (country_code ~ '^[A-Z]{2}$'),
  program_type public.program_type not null default 'stamps',
  stamp_goal smallint not null default 8 check (stamp_goal between 1 and 50),
  points_per_dollar numeric(10, 2) not null default 1 check (points_per_dollar > 0 and points_per_dollar <= 10000),
  duplicate_window_seconds smallint not null default 30 check (duplicate_window_seconds between 0 and 300),
  undo_window_seconds smallint not null default 60 check (undo_window_seconds between 0 and 3600),
  require_registered_device boolean not null default true,
  wallet_brand jsonb not null default '{}'::jsonb check (jsonb_typeof(wallet_brand) = 'object'),
  public_info jsonb not null default '{}'::jsonb check (jsonb_typeof(public_info) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null default '' check (length(last_name) <= 100),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  locale text not null default 'en-CA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_phone_unique_idx on public.profiles (phone_e164) where phone_e164 is not null;
create unique index profiles_email_unique_idx on public.profiles (lower(email)) where email is not null;

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete restrict,
  role public.profile_role not null default 'customer',
  status public.membership_status not null default 'active',
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null default '' check (length(last_name) <= 100),
  member_number text not null default ('L-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10)))
    check (length(member_number) between 4 and 40),
  stamps_balance integer not null default 0 check (stamps_balance >= 0),
  points_balance integer not null default 0 check (points_balance >= 0),
  staff_code text,
  joined_at timestamptz not null default now(),
  last_activity_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, profile_id),
  unique (tenant_id, member_number),
  unique (tenant_id, id),
  check ((role in ('customer', 'owner') and profile_id is not null) or role = 'staff'),
  check ((role = 'customer' and staff_code is null) or role in ('staff', 'owner'))
);

create unique index tenant_memberships_staff_code_idx
  on public.tenant_memberships (tenant_id, lower(staff_code))
  where staff_code is not null and status <> 'closed';
create index tenant_memberships_profile_idx on public.tenant_memberships (profile_id, status);
create index tenant_memberships_customer_balance_idx
  on public.tenant_memberships (tenant_id, role, status, last_activity_at desc);

create table public.staff_credentials (
  membership_id uuid primary key,
  tenant_id uuid not null,
  pin_hash text not null check (length(pin_hash) >= 20),
  pin_version integer not null default 1 check (pin_version > 0),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  last_authenticated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, membership_id)
    references public.tenant_memberships (tenant_id, id) on delete cascade
);

create table public.store_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  label text not null check (length(trim(label)) between 1 and 120),
  platform text not null default 'web' check (platform in ('web', 'android', 'ios')),
  status public.device_status not null default 'pending',
  device_token_hash bytea unique,
  public_key_jwk jsonb check (public_key_jwk is null or jsonb_typeof(public_key_jwk) = 'object'),
  enrolled_by uuid,
  enrolled_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, enrolled_by)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  check ((status = 'revoked' and revoked_at is not null) or status <> 'revoked')
);

create index store_devices_tenant_status_idx on public.store_devices (tenant_id, status, last_seen_at desc);

create table public.staff_device_access (
  tenant_id uuid not null,
  staff_membership_id uuid not null,
  device_id uuid not null,
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (tenant_id, staff_membership_id, device_id),
  foreign key (tenant_id, staff_membership_id)
    references public.tenant_memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, device_id)
    references public.store_devices (tenant_id, id) on delete cascade,
  foreign key (tenant_id, granted_by)
    references public.tenant_memberships (tenant_id, id) on delete restrict
);

create table public.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  staff_membership_id uuid not null,
  device_id uuid,
  session_token_hash bytea not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  foreign key (tenant_id, staff_membership_id)
    references public.tenant_memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, device_id)
    references public.store_devices (tenant_id, id) on delete cascade,
  check (expires_at > issued_at)
);

create index staff_sessions_active_idx
  on public.staff_sessions (tenant_id, staff_membership_id, expires_at desc)
  where revoked_at is null;

create table public.staff_auth_attempts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  membership_id uuid,
  device_id uuid,
  ip_hash text,
  succeeded boolean not null,
  attempted_at timestamptz not null default now(),
  foreign key (tenant_id, membership_id)
    references public.tenant_memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, device_id)
    references public.store_devices (tenant_id, id) on delete cascade
);

create index staff_auth_attempts_rate_idx
  on public.staff_auth_attempts (tenant_id, attempted_at desc, ip_hash);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  stamp_cost integer not null default 1 check (stamp_cost > 0),
  point_cost integer not null default 1 check (point_cost > 0),
  promotion_rule text,
  terms text,
  wallet_offer_enabled boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  available_from timestamptz,
  available_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, id),
  check (available_until is null or available_from is null or available_until > available_from)
);

create index rewards_catalog_idx on public.rewards (tenant_id, active, sort_order, name);

create table public.wallet_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  provider public.wallet_provider not null,
  issuer_account_id text not null,
  class_id text not null,
  status public.wallet_pass_status not null default 'pending',
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, class_id),
  unique (tenant_id, provider),
  unique (tenant_id, id),
  unique (tenant_id, id, provider)
);

create table public.wallet_passes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  membership_id uuid not null,
  wallet_class_id uuid not null,
  provider public.wallet_provider not null,
  object_suffix text not null check (object_suffix ~ '^[A-Za-z0-9._-]{6,120}$'),
  object_id text not null,
  status public.wallet_pass_status not null default 'pending',
  sync_version bigint not null default 0 check (sync_version >= 0),
  provider_etag text,
  last_synced_at timestamptz,
  last_error text,
  issued_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, object_id),
  unique (tenant_id, membership_id, provider),
  unique (tenant_id, id),
  unique (tenant_id, membership_id, id),
  foreign key (tenant_id, membership_id)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, wallet_class_id)
    references public.wallet_classes (tenant_id, id) on delete restrict,
  foreign key (tenant_id, wallet_class_id, provider)
    references public.wallet_classes (tenant_id, id, provider) on delete restrict,
  check ((status = 'revoked' and revoked_at is not null) or status <> 'revoked')
);

create index wallet_passes_sync_idx on public.wallet_passes (tenant_id, status, last_synced_at);
create index wallet_passes_object_suffix_idx on public.wallet_passes (provider, object_suffix);

-- The API encrypts each TOTP secret with QR_SIGNING_SECRET before storage.
-- Browser roles never receive SELECT privileges on this table.
create table public.wallet_barcode_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  membership_id uuid not null,
  wallet_pass_id uuid not null,
  lookup_hash bytea not null unique,
  secret_ciphertext text not null check (length(secret_ciphertext) >= 32),
  key_version smallint not null default 1 check (key_version > 0),
  algorithm text not null default 'SHA1' check (algorithm in ('SHA1', 'SHA256', 'SHA512')),
  digits smallint not null default 8 check (digits between 6 and 10),
  period_seconds smallint not null default 60 check (period_seconds between 15 and 120),
  allowed_drift_windows smallint not null default 1 check (allowed_drift_windows between 0 and 3),
  active boolean not null default true,
  activated_at timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, membership_id, id),
  foreign key (tenant_id, membership_id)
    references public.tenant_memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, wallet_pass_id)
    references public.wallet_passes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id, wallet_pass_id)
    references public.wallet_passes (tenant_id, membership_id, id) on delete cascade,
  check ((active and retired_at is null) or not active)
);

create unique index wallet_barcode_one_active_idx
  on public.wallet_barcode_credentials (wallet_pass_id)
  where active;

create table public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  reward_id uuid not null,
  wallet_pass_id uuid,
  public_reference text not null default upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12)),
  token_hash bytea,
  status public.redemption_status not null default 'issued',
  stamp_cost_snapshot integer not null default 0 check (stamp_cost_snapshot >= 0),
  point_cost_snapshot integer not null default 0 check (point_cost_snapshot >= 0),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid,
  redeemed_device_id uuid,
  redeemed_transaction_id uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, public_reference),
  unique (tenant_id, id),
  unique (tenant_id, customer_id, id),
  foreign key (tenant_id, customer_id)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, reward_id)
    references public.rewards (tenant_id, id) on delete restrict,
  foreign key (tenant_id, wallet_pass_id)
    references public.wallet_passes (tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id, wallet_pass_id)
    references public.wallet_passes (tenant_id, membership_id, id) on delete restrict,
  foreign key (tenant_id, redeemed_by)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, redeemed_device_id)
    references public.store_devices (tenant_id, id) on delete restrict,
  check (expires_at > issued_at),
  check (
    (status = 'issued' and redeemed_at is null and cancelled_at is null)
    or (status = 'redeemed' and redeemed_at is not null and redeemed_by is not null)
    or (status = 'expired' and redeemed_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);

create unique index reward_redemptions_token_idx
  on public.reward_redemptions (token_hash) where token_hash is not null;
create index reward_redemptions_customer_idx
  on public.reward_redemptions (tenant_id, customer_id, status, expires_at desc);

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  actor_id uuid not null,
  device_id uuid,
  barcode_id uuid,
  reward_id uuid,
  redemption_id uuid,
  kind public.transaction_kind not null,
  source public.transaction_source not null,
  stamps_delta integer not null default 0,
  points_delta integer not null default 0,
  stamps_before integer not null check (stamps_before >= 0),
  stamps_after integer not null check (stamps_after >= 0),
  points_before integer not null check (points_before >= 0),
  points_after integer not null check (points_after >= 0),
  reverses_id uuid,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (tenant_id, id),
  unique (tenant_id, customer_id, id),
  unique (tenant_id, idempotency_key),
  unique (reverses_id),
  foreign key (tenant_id, customer_id)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_id)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, device_id)
    references public.store_devices (tenant_id, id) on delete restrict,
  foreign key (tenant_id, barcode_id)
    references public.wallet_barcode_credentials (tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id, barcode_id)
    references public.wallet_barcode_credentials (tenant_id, membership_id, id) on delete restrict,
  foreign key (tenant_id, reward_id)
    references public.rewards (tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id, redemption_id)
    references public.reward_redemptions (tenant_id, customer_id, id) on delete restrict,
  foreign key (tenant_id, customer_id, reverses_id)
    references public.loyalty_transactions (tenant_id, customer_id, id) on delete restrict,
  check (stamps_delta <> 0 or points_delta <> 0),
  check (stamps_after = stamps_before + stamps_delta),
  check (points_after = points_before + points_delta),
  check ((kind = 'redeem' and reward_id is not null and (stamps_delta < 0 or points_delta < 0)) or kind <> 'redeem'),
  check ((kind = 'undo' and reverses_id is not null and source = 'undo') or (kind <> 'undo' and reverses_id is null))
);

create index loyalty_transactions_customer_time_idx
  on public.loyalty_transactions (tenant_id, customer_id, created_at desc);
create index loyalty_transactions_tenant_time_idx
  on public.loyalty_transactions (tenant_id, created_at desc);
create index loyalty_transactions_actor_time_idx
  on public.loyalty_transactions (tenant_id, actor_id, created_at desc);
create index loyalty_transactions_debounce_idx
  on public.loyalty_transactions (tenant_id, customer_id, occurred_at desc)
  where source in ('scan', 'offline') and kind <> 'undo';

alter table public.reward_redemptions
  add constraint reward_redemptions_transaction_fk
  foreign key (tenant_id, customer_id, redeemed_transaction_id)
  references public.loyalty_transactions (tenant_id, customer_id, id) on delete restrict;

create table public.idempotency_keys (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  scope text not null check (scope ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  actor_id uuid not null,
  request_hash bytea not null,
  transaction_id uuid,
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (tenant_id, idempotency_key),
  foreign key (tenant_id, actor_id)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, transaction_id)
    references public.loyalty_transactions (tenant_id, id) on delete restrict,
  check (expires_at > created_at)
);

create index idempotency_keys_expiry_idx on public.idempotency_keys (expires_at);

create table public.audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_id uuid,
  device_id uuid,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  target_type text,
  target_id uuid,
  request_id text,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, actor_id)
    references public.tenant_memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, device_id)
    references public.store_devices (tenant_id, id) on delete restrict
);

create index audit_events_tenant_time_idx on public.audit_events (tenant_id, created_at desc);
create index audit_events_target_idx on public.audit_events (tenant_id, target_type, target_id, created_at desc);

create table public.wallet_sync_outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  wallet_pass_id uuid not null,
  transaction_id uuid,
  redemption_id uuid,
  event_kind text not null check (event_kind ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  dedupe_key text not null check (length(dedupe_key) between 8 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status public.outbox_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wallet_pass_id, dedupe_key),
  foreign key (tenant_id, wallet_pass_id)
    references public.wallet_passes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, transaction_id)
    references public.loyalty_transactions (tenant_id, id) on delete restrict,
  foreign key (tenant_id, redemption_id)
    references public.reward_redemptions (tenant_id, id) on delete restrict
);

create index wallet_sync_outbox_worker_idx
  on public.wallet_sync_outbox (status, available_at, id)
  where status in ('pending', 'processing');

-- Store only privacy-preserving hashes for OTP abuse controls.
create table public.otp_requests (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_hash text not null,
  ip_hash text not null,
  turnstile_verified boolean not null default false,
  provider_request_id text,
  created_at timestamptz not null default now()
);

create index otp_requests_rate_idx
  on public.otp_requests (tenant_id, created_at desc, phone_hash, ip_hash);

create table public.customer_consents (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  customer_id uuid not null,
  consent_type text not null default 'loyalty_terms'
    check (consent_type ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  consent_version text not null check (length(trim(consent_version)) between 1 and 80),
  granted_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (tenant_id, customer_id, consent_type, consent_version),
  foreign key (tenant_id, customer_id)
    references public.tenant_memberships (tenant_id, id) on delete restrict
);

create function loyalty_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function loyalty_private.protect_balance_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.stamps_balance, new.points_balance) is distinct from (old.stamps_balance, old.points_balance)
    and coalesce(current_setting('loyalty.balance_mutation', true), '') <> 'on'
  then
    raise exception 'membership balances may only change through a loyalty transaction RPC'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function loyalty_private.reject_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create function loyalty_private.require_membership_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_expected public.profile_role := tg_argv[1]::public.profile_role;
begin
  v_membership_id := (to_jsonb(new)->>tg_argv[0])::uuid;
  if v_membership_id is null or not exists (
    select 1
    from public.tenant_memberships as membership
    where membership.tenant_id = new.tenant_id
      and membership.id = v_membership_id
      and (
        membership.role = v_expected
        or (v_expected = 'staff' and membership.role = 'owner')
      )
  ) then
    raise exception '% must reference a % membership', tg_argv[0], v_expected
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tenants_updated_at before update on public.tenants
  for each row execute function loyalty_private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function loyalty_private.set_updated_at();
create trigger memberships_updated_at before update on public.tenant_memberships
  for each row execute function loyalty_private.set_updated_at();
create trigger memberships_protect_balances before update on public.tenant_memberships
  for each row execute function loyalty_private.protect_balance_columns();
create trigger staff_credentials_updated_at before update on public.staff_credentials
  for each row execute function loyalty_private.set_updated_at();
create trigger store_devices_updated_at before update on public.store_devices
  for each row execute function loyalty_private.set_updated_at();
create trigger rewards_updated_at before update on public.rewards
  for each row execute function loyalty_private.set_updated_at();
create trigger wallet_classes_updated_at before update on public.wallet_classes
  for each row execute function loyalty_private.set_updated_at();
create trigger wallet_passes_updated_at before update on public.wallet_passes
  for each row execute function loyalty_private.set_updated_at();
create trigger reward_redemptions_updated_at before update on public.reward_redemptions
  for each row execute function loyalty_private.set_updated_at();
create trigger wallet_sync_outbox_updated_at before update on public.wallet_sync_outbox
  for each row execute function loyalty_private.set_updated_at();

create trigger loyalty_transactions_append_only
  before update or delete on public.loyalty_transactions
  for each row execute function loyalty_private.reject_ledger_mutation();
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function loyalty_private.reject_ledger_mutation();
create trigger customer_consents_append_only
  before update or delete on public.customer_consents
  for each row execute function loyalty_private.reject_ledger_mutation();

create trigger staff_credentials_require_staff
  before insert or update on public.staff_credentials
  for each row execute function loyalty_private.require_membership_role('membership_id', 'staff');
create trigger staff_device_access_require_staff
  before insert or update on public.staff_device_access
  for each row execute function loyalty_private.require_membership_role('staff_membership_id', 'staff');
create trigger staff_sessions_require_staff
  before insert or update on public.staff_sessions
  for each row execute function loyalty_private.require_membership_role('staff_membership_id', 'staff');
create trigger wallet_passes_require_customer
  before insert or update on public.wallet_passes
  for each row execute function loyalty_private.require_membership_role('membership_id', 'customer');
create trigger wallet_barcodes_require_customer
  before insert or update on public.wallet_barcode_credentials
  for each row execute function loyalty_private.require_membership_role('membership_id', 'customer');
create trigger reward_redemptions_require_customer
  before insert or update on public.reward_redemptions
  for each row execute function loyalty_private.require_membership_role('customer_id', 'customer');
create trigger loyalty_transactions_require_customer
  before insert on public.loyalty_transactions
  for each row execute function loyalty_private.require_membership_role('customer_id', 'customer');
create trigger loyalty_transactions_require_staff_actor
  before insert on public.loyalty_transactions
  for each row execute function loyalty_private.require_membership_role('actor_id', 'staff');

comment on table public.loyalty_transactions is
  'Append-only source of truth for all balance changes. Never update or delete rows.';
comment on column public.wallet_barcode_credentials.secret_ciphertext is
  'Application-encrypted TOTP seed. Decrypt only inside trusted server code.';
comment on column public.wallet_passes.object_suffix is
  'Opaque provider object suffix used to resolve scanned Wallet passes without personal data.';

commit;
