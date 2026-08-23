begin;

create function loyalty_private.require_actor(
  p_actor_id uuid,
  p_roles public.profile_role[]
) returns public.tenant_memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
begin
  select membership.*
  into v_actor
  from public.tenant_memberships as membership
  join public.tenants as tenant on tenant.id = membership.tenant_id
  where membership.id = p_actor_id
    and membership.status = 'active'
    and membership.role = any (p_roles)
    and tenant.is_active;

  if not found then
    raise exception 'actor is not authorized' using errcode = '42501';
  end if;

  if auth.uid() is not null
    and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and v_actor.profile_id is distinct from auth.uid()
  then
    raise exception 'actor does not match authenticated user' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

create function loyalty_private.require_device(
  p_actor public.tenant_memberships,
  p_device_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required boolean;
begin
  select tenant.require_registered_device
  into v_required
  from public.tenants as tenant
  where tenant.id = p_actor.tenant_id;

  if p_device_id is null then
    if v_required then
      raise exception 'a registered store device is required' using errcode = '42501';
    end if;
    return;
  end if;

  if not exists (
    select 1
    from public.store_devices as device
    join public.staff_device_access as access
      on access.tenant_id = device.tenant_id
     and access.device_id = device.id
    where device.tenant_id = p_actor.tenant_id
      and device.id = p_device_id
      and device.status = 'active'
      and access.staff_membership_id = p_actor.id
      and access.revoked_at is null
  ) then
    raise exception 'device is not active for this staff member' using errcode = '42501';
  end if;
end;
$$;

create function loyalty_private.claim_idempotency(
  p_tenant_id uuid,
  p_scope text,
  p_idempotency_key text,
  p_actor_id uuid,
  p_request_hash bytea
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_hash bytea;
  v_transaction_id uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  insert into public.idempotency_keys (
    tenant_id, scope, idempotency_key, actor_id, request_hash
  ) values (
    p_tenant_id, p_scope, p_idempotency_key, p_actor_id, p_request_hash
  )
  on conflict (tenant_id, idempotency_key) do nothing;

  select key.request_hash, key.transaction_id
  into v_existing_hash, v_transaction_id
  from public.idempotency_keys as key
  where key.tenant_id = p_tenant_id
    and key.idempotency_key = p_idempotency_key
  for update;

  if v_existing_hash is distinct from p_request_hash then
    raise exception 'idempotency key was already used with a different request'
      using errcode = '22023';
  end if;

  return v_transaction_id;
end;
$$;

create function loyalty_private.finish_idempotency(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_transaction public.loyalty_transactions
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.idempotency_keys
  set transaction_id = p_transaction.id,
      response = jsonb_build_object(
        'transactionId', p_transaction.id,
        'stampsAfter', p_transaction.stamps_after,
        'pointsAfter', p_transaction.points_after
      )
  where tenant_id = p_tenant_id
    and idempotency_key = p_idempotency_key;
end;
$$;

create function loyalty_private.enqueue_wallet_sync(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_transaction_id uuid,
  p_redemption_id uuid,
  p_event_kind text,
  p_dedupe_key text,
  p_payload jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.wallet_sync_outbox (
    tenant_id,
    wallet_pass_id,
    transaction_id,
    redemption_id,
    event_kind,
    dedupe_key,
    payload
  )
  select
    pass.tenant_id,
    pass.id,
    p_transaction_id,
    p_redemption_id,
    p_event_kind,
    p_dedupe_key,
    coalesce(p_payload, '{}'::jsonb)
  from public.wallet_passes as pass
  where pass.tenant_id = p_tenant_id
    and pass.membership_id = p_customer_id
    and pass.status = 'active'
  on conflict (wallet_pass_id, dedupe_key) do nothing
$$;

create function public.enroll_customer(
  p_profile_id uuid,
  p_tenant_slug text,
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_consent_version text
) returns setof public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_membership public.tenant_memberships;
  v_auth_phone text;
begin
  if length(trim(coalesce(p_first_name, ''))) not between 1 and 80
    or length(coalesce(p_last_name, '')) > 100
    or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
    or length(trim(coalesce(p_consent_version, ''))) not between 1 and 80
  then
    raise exception 'invalid customer enrollment data' using errcode = '22023';
  end if;

  select tenant.* into v_tenant
  from public.tenants as tenant
  where tenant.slug = lower(trim(p_tenant_slug)) and tenant.is_active;

  if not found then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  select auth_user.phone into v_auth_phone
  from auth.users as auth_user
  where auth_user.id = p_profile_id;

  if not found then
    raise exception 'authenticated user not found' using errcode = 'P0002';
  end if;

  if v_auth_phone is not null and v_auth_phone <> p_phone_e164 then
    raise exception 'verified phone does not match enrollment phone' using errcode = '22023';
  end if;

  insert into public.profiles (id, first_name, last_name, phone_e164)
  values (p_profile_id, trim(p_first_name), trim(coalesce(p_last_name, '')), p_phone_e164)
  on conflict (id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone_e164 = excluded.phone_e164;

  insert into public.tenant_memberships (
    tenant_id, profile_id, role, status, first_name, last_name
  ) values (
    v_tenant.id, p_profile_id, 'customer', 'active',
    trim(p_first_name), trim(coalesce(p_last_name, ''))
  )
  on conflict (tenant_id, profile_id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name;

  select membership.* into v_membership
  from public.tenant_memberships as membership
  where membership.tenant_id = v_tenant.id
    and membership.profile_id = p_profile_id;

  if v_membership.role <> 'customer' or v_membership.status <> 'active' then
    raise exception 'existing membership cannot be enrolled as a customer' using errcode = '42501';
  end if;

  insert into public.customer_consents (
    tenant_id, customer_id, consent_version
  ) values (
    v_tenant.id, v_membership.id, trim(p_consent_version)
  ) on conflict (tenant_id, customer_id, consent_type, consent_version) do nothing;

  insert into public.audit_events (
    tenant_id, action, target_type, target_id, metadata
  ) values (
    v_tenant.id,
    'customer.enrolled',
    'tenant_membership',
    v_membership.id,
    jsonb_build_object('consentVersion', trim(p_consent_version))
  );

  return query
    select membership.*
    from public.tenant_memberships as membership
    where membership.id = v_membership.id;
end;
$$;

create function public.authenticate_staff_pin(
  p_tenant_slug text,
  p_pin text,
  p_device_id uuid default null,
  p_ip_hash text default null
) returns table (
  membership_id uuid,
  tenant_id uuid,
  tenant_slug text,
  role public.profile_role,
  first_name text,
  last_name text,
  staff_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_staff public.tenant_memberships;
  v_matches integer;
begin
  if p_pin !~ '^[0-9]{4}$' or length(coalesce(p_ip_hash, '')) < 16 then
    return;
  end if;

  select tenant.* into v_tenant
  from public.tenants as tenant
  where tenant.slug = lower(trim(p_tenant_slug)) and tenant.is_active;

  if not found then
    return;
  end if;

  if p_ip_hash is not null and (
    select count(*)
    from public.staff_auth_attempts as attempt
    where attempt.tenant_id = v_tenant.id
      and attempt.ip_hash = p_ip_hash
      and not attempt.succeeded
      and attempt.attempted_at >= now() - interval '15 minutes'
  ) >= 10 then
    raise exception 'too many staff login attempts' using errcode = '53300';
  end if;

  select count(*) into v_matches
  from public.tenant_memberships as membership
  join public.staff_credentials as credential
    on credential.tenant_id = membership.tenant_id
   and credential.membership_id = membership.id
  where membership.tenant_id = v_tenant.id
    and membership.role in ('staff', 'owner')
    and membership.status = 'active'
    and (credential.locked_until is null or credential.locked_until <= now())
    and extensions.crypt(p_pin, credential.pin_hash) = credential.pin_hash;

  if v_matches <> 1 then
    insert into public.staff_auth_attempts (
      tenant_id, device_id, ip_hash, succeeded
    ) values (
      v_tenant.id,
      case when exists (
        select 1 from public.store_devices
        where tenant_id = v_tenant.id and id = p_device_id
      ) then p_device_id else null end,
      p_ip_hash,
      false
    );
    return;
  end if;

  select membership.* into v_staff
  from public.tenant_memberships as membership
  join public.staff_credentials as credential
    on credential.tenant_id = membership.tenant_id
   and credential.membership_id = membership.id
  where membership.tenant_id = v_tenant.id
    and membership.role in ('staff', 'owner')
    and membership.status = 'active'
    and (credential.locked_until is null or credential.locked_until <= now())
    and extensions.crypt(p_pin, credential.pin_hash) = credential.pin_hash;

  perform loyalty_private.require_device(v_staff, p_device_id);

  update public.staff_credentials
  set failed_attempts = 0,
      locked_until = null,
      last_authenticated_at = now()
  where staff_credentials.membership_id = v_staff.id;

  update public.store_devices
  set last_seen_at = now()
  where store_devices.tenant_id = v_tenant.id
    and store_devices.id = p_device_id;

  insert into public.staff_auth_attempts (
    tenant_id, membership_id, device_id, ip_hash, succeeded
  ) values (
    v_tenant.id, v_staff.id, p_device_id, p_ip_hash, true
  );

  return query select
    v_staff.id,
    v_tenant.id,
    v_tenant.slug,
    v_staff.role,
    v_staff.first_name,
    v_staff.last_name,
    v_staff.staff_code;
end;
$$;

create function public.bootstrap_tenant_owner(
  p_profile_id uuid,
  p_tenant_slug text,
  p_first_name text,
  p_last_name text,
  p_phone_e164 text default null,
  p_email text default null
) returns setof public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_owner public.tenant_memberships;
begin
  select tenant.* into v_tenant
  from public.tenants as tenant
  where tenant.slug = lower(trim(p_tenant_slug)) and tenant.is_active
  for update;

  if not found then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.tenant_memberships
    where tenant_id = v_tenant.id and role = 'owner' and status <> 'closed'
  ) then
    raise exception 'tenant owner has already been bootstrapped' using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users where id = p_profile_id)
    or length(trim(coalesce(p_first_name, ''))) not between 1 and 80
    or (p_phone_e164 is not null and p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$')
  then
    raise exception 'invalid owner identity' using errcode = '22023';
  end if;

  insert into public.profiles (
    id, first_name, last_name, phone_e164, email
  ) values (
    p_profile_id,
    trim(p_first_name),
    trim(coalesce(p_last_name, '')),
    p_phone_e164,
    nullif(lower(trim(coalesce(p_email, ''))), '')
  ) on conflict (id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone_e164 = coalesce(excluded.phone_e164, profiles.phone_e164),
        email = coalesce(excluded.email, profiles.email);

  insert into public.tenant_memberships (
    tenant_id, profile_id, role, status, first_name, last_name, staff_code
  ) values (
    v_tenant.id,
    p_profile_id,
    'owner',
    'active',
    trim(p_first_name),
    trim(coalesce(p_last_name, '')),
    'OWNER'
  ) returning * into v_owner;

  insert into public.audit_events (
    tenant_id, actor_id, action, target_type, target_id
  ) values (
    v_tenant.id, v_owner.id, 'owner.bootstrapped', 'tenant_membership', v_owner.id
  );

  return query select membership.*
    from public.tenant_memberships as membership where membership.id = v_owner.id;
end;
$$;

create function public.resolve_wallet_barcode(
  p_provider public.wallet_provider,
  p_object_suffix text
) returns table (
  barcode_id uuid,
  tenant_id uuid,
  customer_id uuid,
  wallet_pass_id uuid,
  object_id text,
  secret_ciphertext text,
  key_version smallint,
  algorithm text,
  digits smallint,
  period_seconds smallint,
  allowed_drift_windows smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    credential.id,
    credential.tenant_id,
    credential.membership_id,
    pass.id,
    pass.object_id,
    credential.secret_ciphertext,
    credential.key_version,
    credential.algorithm,
    credential.digits,
    credential.period_seconds,
    credential.allowed_drift_windows
  from public.wallet_passes as pass
  join public.wallet_barcode_credentials as credential
    on credential.tenant_id = pass.tenant_id
   and credential.wallet_pass_id = pass.id
   and credential.membership_id = pass.membership_id
  join public.tenant_memberships as membership
    on membership.tenant_id = pass.tenant_id
   and membership.id = pass.membership_id
  join public.tenants as tenant on tenant.id = pass.tenant_id
  where pass.provider = p_provider
    and pass.object_suffix = p_object_suffix
    and pass.status = 'active'
    and credential.active
    and membership.role = 'customer'
    and membership.status = 'active'
    and tenant.is_active
$$;

create function public.create_reward_redemption(
  p_customer_id uuid,
  p_reward_id uuid,
  p_token_hash bytea default null,
  p_expires_at timestamptz default (now() + interval '5 minutes')
) returns setof public.reward_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.tenant_memberships;
  v_tenant public.tenants;
  v_reward public.rewards;
  v_pass_id uuid;
  v_redemption public.reward_redemptions;
begin
  select membership.* into v_customer
  from public.tenant_memberships as membership
  where membership.id = p_customer_id
    and membership.role = 'customer'
    and membership.status = 'active'
  for update;

  if not found then
    raise exception 'active customer not found' using errcode = 'P0002';
  end if;

  if auth.uid() is not null
    and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and v_customer.profile_id is distinct from auth.uid()
  then
    raise exception 'customer does not match authenticated user' using errcode = '42501';
  end if;

  select tenant.* into v_tenant
  from public.tenants as tenant
  where tenant.id = v_customer.tenant_id and tenant.is_active;

  select reward.* into v_reward
  from public.rewards as reward
  where reward.tenant_id = v_customer.tenant_id
    and reward.id = p_reward_id
    and reward.active
    and (reward.available_from is null or reward.available_from <= now())
    and (reward.available_until is null or reward.available_until > now());

  if not found then
    raise exception 'active reward not found' using errcode = 'P0002';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception 'redemption expiry must be within the next 15 minutes' using errcode = '22023';
  end if;

  if (v_tenant.program_type = 'stamps' and v_customer.stamps_balance < v_reward.stamp_cost)
    or (v_tenant.program_type = 'points' and v_customer.points_balance < v_reward.point_cost)
  then
    raise exception 'insufficient reward balance' using errcode = '22003';
  end if;

  select pass.id into v_pass_id
  from public.wallet_passes as pass
  where pass.tenant_id = v_customer.tenant_id
    and pass.membership_id = v_customer.id
    and pass.provider = 'google'
    and pass.status = 'active';

  select redemption.* into v_redemption
  from public.reward_redemptions as redemption
  where redemption.tenant_id = v_customer.tenant_id
    and redemption.customer_id = v_customer.id
    and redemption.reward_id = v_reward.id
    and redemption.status = 'issued'
    and redemption.expires_at > now()
    and (p_token_hash is null or redemption.token_hash = p_token_hash)
  order by redemption.created_at desc
  limit 1;

  if found then
    return query select redemption.*
      from public.reward_redemptions as redemption
      where redemption.id = v_redemption.id;
    return;
  end if;

  update public.reward_redemptions
  set status = 'cancelled', cancelled_at = now()
  where tenant_id = v_customer.tenant_id
    and customer_id = v_customer.id
    and reward_id = v_reward.id
    and status = 'issued'
    and expires_at > now();

  insert into public.reward_redemptions (
    tenant_id,
    customer_id,
    reward_id,
    wallet_pass_id,
    token_hash,
    stamp_cost_snapshot,
    point_cost_snapshot,
    expires_at
  ) values (
    v_customer.tenant_id,
    v_customer.id,
    v_reward.id,
    v_pass_id,
    p_token_hash,
    v_reward.stamp_cost,
    v_reward.point_cost,
    p_expires_at
  ) returning * into v_redemption;

  perform loyalty_private.enqueue_wallet_sync(
    v_customer.tenant_id,
    v_customer.id,
    null,
    v_redemption.id,
    'redemption.issued',
    'redemption-issued:' || v_redemption.id::text,
    jsonb_build_object(
      'redemptionId', v_redemption.id,
      'rewardId', v_reward.id,
      'expiresAt', v_redemption.expires_at
    )
  );

  return query select redemption.*
    from public.reward_redemptions as redemption
    where redemption.id = v_redemption.id;
end;
$$;

create function public.resolve_redemption_token(p_token_hash bytea)
returns setof public.reward_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.reward_redemptions;
begin
  select redemption.* into v_redemption
  from public.reward_redemptions as redemption
  where redemption.token_hash = p_token_hash
  for update;

  if not found then
    return;
  end if;

  if v_redemption.status = 'issued' and v_redemption.expires_at <= now() then
    update public.reward_redemptions
    set status = 'expired'
    where id = v_redemption.id
    returning * into v_redemption;
  end if;

  return query select redemption.*
    from public.reward_redemptions as redemption
    where redemption.id = v_redemption.id;
end;
$$;

create function public.confirm_loyalty_transaction(
  p_actor_id uuid,
  p_customer_id uuid,
  p_kind public.transaction_kind,
  p_source public.transaction_source,
  p_idempotency_key text,
  p_stamps_delta integer default 0,
  p_points_delta integer default 0,
  p_reward_id uuid default null,
  p_redemption_id uuid default null,
  p_barcode_id uuid default null,
  p_device_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
) returns setof public.loyalty_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_customer public.tenant_memberships;
  v_tenant public.tenants;
  v_reward public.rewards;
  v_redemption public.reward_redemptions;
  v_transaction public.loyalty_transactions;
  v_existing_transaction_id uuid;
  v_stamps_delta integer := 0;
  v_points_delta integer := 0;
  v_request_hash bytea;
begin
  if p_kind not in ('visit', 'points', 'redeem') then
    raise exception 'transaction kind is not accepted by confirm' using errcode = '22023';
  end if;

  if p_source not in ('scan', 'manual', 'offline') then
    raise exception 'transaction source is not accepted by confirm' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'metadata must be a JSON object' using errcode = '22023';
  end if;

  v_actor := loyalty_private.require_actor(
    p_actor_id,
    array['staff', 'owner']::public.profile_role[]
  );
  perform loyalty_private.require_device(v_actor, p_device_id);

  select tenant.* into v_tenant
  from public.tenants as tenant
  where tenant.id = v_actor.tenant_id;

  if p_source = 'offline' then
    if p_kind <> 'visit'
      or p_device_id is null
      or coalesce(p_metadata->>'deviceEventId', '') = ''
      or p_metadata->>'signatureVerified' <> 'true'
      or p_occurred_at < now() - interval '24 hours'
      or p_occurred_at > now() + interval '5 minutes'
    then
      raise exception 'invalid offline visit proof' using errcode = '22023';
    end if;
  elsif p_occurred_at < now() - interval '5 minutes' or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'transaction time is outside the accepted window' using errcode = '22023';
  end if;

  v_request_hash := extensions.digest(
    convert_to(jsonb_build_object(
      'actorId', p_actor_id,
      'customerId', p_customer_id,
      'kind', p_kind,
      'source', p_source,
      'stampsDelta', p_stamps_delta,
      'pointsDelta', p_points_delta,
      'rewardId', p_reward_id,
      'redemptionId', p_redemption_id,
      'barcodeId', p_barcode_id,
      'deviceId', p_device_id,
      'metadata', coalesce(p_metadata, '{}'::jsonb),
      'occurredAt', case when p_source = 'offline' then p_occurred_at else null end
    )::text, 'UTF8'),
    'sha256'
  );

  v_existing_transaction_id := loyalty_private.claim_idempotency(
    v_actor.tenant_id,
    'transaction.confirm',
    p_idempotency_key,
    v_actor.id,
    v_request_hash
  );

  if v_existing_transaction_id is not null then
    return query select transaction.*
      from public.loyalty_transactions as transaction
      where transaction.tenant_id = v_actor.tenant_id
        and transaction.id = v_existing_transaction_id;
    return;
  end if;

  select membership.* into v_customer
  from public.tenant_memberships as membership
  where membership.tenant_id = v_actor.tenant_id
    and membership.id = p_customer_id
    and membership.role = 'customer'
    and membership.status = 'active'
  for update;

  if not found then
    raise exception 'active customer not found in actor tenant' using errcode = 'P0002';
  end if;

  if p_source = 'scan'
     and p_barcode_id is null
     and not (p_kind = 'redeem' and p_redemption_id is not null) then
    raise exception 'scan transactions require a validated Wallet barcode or redemption'
      using errcode = '22023';
  end if;

  if p_barcode_id is not null and not exists (
    select 1
    from public.wallet_barcode_credentials as barcode
    join public.wallet_passes as pass
      on pass.tenant_id = barcode.tenant_id
     and pass.id = barcode.wallet_pass_id
    where barcode.tenant_id = v_actor.tenant_id
      and barcode.id = p_barcode_id
      and barcode.membership_id = v_customer.id
      and barcode.active
      and pass.status = 'active'
  ) then
    raise exception 'barcode is not active for this customer' using errcode = '22023';
  end if;

  if p_source in ('scan', 'offline') and v_tenant.duplicate_window_seconds > 0 and exists (
    select 1
    from public.loyalty_transactions as prior
    where prior.tenant_id = v_actor.tenant_id
      and prior.customer_id = v_customer.id
      and prior.source in ('scan', 'offline')
      and prior.kind <> 'undo'
      and prior.occurred_at >= p_occurred_at - make_interval(secs => v_tenant.duplicate_window_seconds)
      and prior.occurred_at <= p_occurred_at + make_interval(secs => v_tenant.duplicate_window_seconds)
      and not exists (
        select 1
        from public.loyalty_transactions as reversal
        where reversal.reverses_id = prior.id
      )
  ) then
    raise exception 'duplicate scan or offline visit blocked' using errcode = 'P0001';
  end if;

  if p_kind = 'visit' then
    if v_tenant.program_type = 'stamps' then
      if p_points_delta <> 0 or p_stamps_delta not in (0, 1) then
        raise exception 'stamp visits add exactly one stamp' using errcode = '22023';
      end if;
      v_stamps_delta := 1;
    else
      if p_stamps_delta <> 0 or p_points_delta <= 0 then
        raise exception 'point visits require a positive points amount' using errcode = '22023';
      end if;
      v_points_delta := p_points_delta;
    end if;
  elsif p_kind = 'points' then
    if v_tenant.program_type <> 'points' or p_stamps_delta <> 0 or p_points_delta <= 0 then
      raise exception 'custom points require a positive point-program amount' using errcode = '22023';
    end if;
    v_points_delta := p_points_delta;
  else
    if p_reward_id is null then
      raise exception 'reward is required for redemption' using errcode = '22023';
    end if;

    select reward.* into v_reward
    from public.rewards as reward
    where reward.tenant_id = v_actor.tenant_id
      and reward.id = p_reward_id
      and reward.active
      and (reward.available_from is null or reward.available_from <= now())
      and (reward.available_until is null or reward.available_until > now())
    for update;

    if not found then
      raise exception 'active reward not found' using errcode = 'P0002';
    end if;

    if p_redemption_id is not null then
      select redemption.* into v_redemption
      from public.reward_redemptions as redemption
      where redemption.tenant_id = v_actor.tenant_id
        and redemption.customer_id = v_customer.id
        and redemption.id = p_redemption_id
        and redemption.reward_id = v_reward.id
      for update;

      if not found or v_redemption.status <> 'issued' or v_redemption.expires_at <= now() then
        raise exception 'redemption is not active' using errcode = '22023';
      end if;
    else
      insert into public.reward_redemptions (
        tenant_id,
        customer_id,
        reward_id,
        stamp_cost_snapshot,
        point_cost_snapshot,
        expires_at
      ) values (
        v_actor.tenant_id,
        v_customer.id,
        v_reward.id,
        v_reward.stamp_cost,
        v_reward.point_cost,
        now() + interval '5 minutes'
      ) returning * into v_redemption;
    end if;

    if v_tenant.program_type = 'stamps' then
      v_stamps_delta := -v_reward.stamp_cost;
    else
      v_points_delta := -v_reward.point_cost;
    end if;
  end if;

  if v_customer.stamps_balance + v_stamps_delta < 0
    or v_customer.points_balance + v_points_delta < 0
  then
    raise exception 'insufficient balance' using errcode = '22003';
  end if;

  insert into public.loyalty_transactions (
    tenant_id,
    customer_id,
    actor_id,
    device_id,
    barcode_id,
    reward_id,
    redemption_id,
    kind,
    source,
    stamps_delta,
    points_delta,
    stamps_before,
    stamps_after,
    points_before,
    points_after,
    idempotency_key,
    occurred_at,
    metadata
  ) values (
    v_actor.tenant_id,
    v_customer.id,
    v_actor.id,
    p_device_id,
    p_barcode_id,
    p_reward_id,
    case when p_kind = 'redeem' then v_redemption.id else null end,
    p_kind,
    p_source,
    v_stamps_delta,
    v_points_delta,
    v_customer.stamps_balance,
    v_customer.stamps_balance + v_stamps_delta,
    v_customer.points_balance,
    v_customer.points_balance + v_points_delta,
    p_idempotency_key,
    p_occurred_at,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_transaction;

  perform set_config('loyalty.balance_mutation', 'on', true);
  update public.tenant_memberships
  set stamps_balance = v_transaction.stamps_after,
      points_balance = v_transaction.points_after,
      last_activity_at = now()
  where tenant_id = v_actor.tenant_id and id = v_customer.id;

  if p_kind = 'redeem' then
    update public.reward_redemptions
    set status = 'redeemed',
        redeemed_at = now(),
        redeemed_by = v_actor.id,
        redeemed_device_id = p_device_id,
        redeemed_transaction_id = v_transaction.id
    where id = v_redemption.id;
  end if;

  insert into public.audit_events (
    tenant_id, actor_id, device_id, action, target_type, target_id, request_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    p_device_id,
    'transaction.confirmed',
    'loyalty_transaction',
    v_transaction.id,
    p_idempotency_key,
    jsonb_build_object('kind', p_kind, 'source', p_source, 'customerId', v_customer.id)
  );

  perform loyalty_private.enqueue_wallet_sync(
    v_actor.tenant_id,
    v_customer.id,
    v_transaction.id,
    v_transaction.redemption_id,
    case when p_kind = 'redeem' then 'redemption.redeemed' else 'balance.updated' end,
    'transaction:' || v_transaction.id::text,
    jsonb_build_object(
      'transactionId', v_transaction.id,
      'stamps', v_transaction.stamps_after,
      'points', v_transaction.points_after,
      'rewardId', v_transaction.reward_id
    )
  );

  perform loyalty_private.finish_idempotency(
    v_actor.tenant_id, p_idempotency_key, v_transaction
  );

  return query select transaction.*
    from public.loyalty_transactions as transaction
    where transaction.id = v_transaction.id;
end;
$$;

revoke all on function public.enroll_customer(uuid, text, text, text, text, text) from public;
revoke all on function public.authenticate_staff_pin(text, text, uuid, text) from public;
revoke all on function public.bootstrap_tenant_owner(uuid, text, text, text, text, text) from public;
revoke all on function public.resolve_wallet_barcode(public.wallet_provider, text) from public;
revoke all on function public.create_reward_redemption(uuid, uuid, bytea, timestamptz) from public;
revoke all on function public.resolve_redemption_token(bytea) from public;
revoke all on function public.confirm_loyalty_transaction(
  uuid, uuid, public.transaction_kind, public.transaction_source, text,
  integer, integer, uuid, uuid, uuid, uuid, jsonb, timestamptz
) from public;

grant execute on function public.enroll_customer(uuid, text, text, text, text, text) to service_role;
grant execute on function public.authenticate_staff_pin(text, text, uuid, text) to service_role;
grant execute on function public.bootstrap_tenant_owner(uuid, text, text, text, text, text) to service_role;
grant execute on function public.resolve_wallet_barcode(public.wallet_provider, text) to service_role;
grant execute on function public.create_reward_redemption(uuid, uuid, bytea, timestamptz) to service_role;
grant execute on function public.resolve_redemption_token(bytea) to service_role;
grant execute on function public.confirm_loyalty_transaction(
  uuid, uuid, public.transaction_kind, public.transaction_source, text,
  integer, integer, uuid, uuid, uuid, uuid, jsonb, timestamptz
) to service_role;

commit;
