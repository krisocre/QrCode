begin;

create function public.undo_loyalty_transaction(
  p_actor_id uuid,
  p_transaction_id uuid,
  p_idempotency_key text,
  p_reason text default null,
  p_device_id uuid default null
) returns setof public.loyalty_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_customer public.tenant_memberships;
  v_tenant public.tenants;
  v_original public.loyalty_transactions;
  v_transaction public.loyalty_transactions;
  v_existing_transaction_id uuid;
  v_request_hash bytea;
begin
  v_actor := loyalty_private.require_actor(
    p_actor_id,
    array['staff', 'owner']::public.profile_role[]
  );
  perform loyalty_private.require_device(v_actor, p_device_id);

  select tenant.* into v_tenant
  from public.tenants as tenant
  where tenant.id = v_actor.tenant_id;

  v_request_hash := extensions.digest(
    convert_to(jsonb_build_object(
      'actorId', p_actor_id,
      'transactionId', p_transaction_id,
      'reason', p_reason,
      'deviceId', p_device_id
    )::text, 'UTF8'),
    'sha256'
  );

  v_existing_transaction_id := loyalty_private.claim_idempotency(
    v_actor.tenant_id,
    'transaction.undo',
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

  select transaction.* into v_original
  from public.loyalty_transactions as transaction
  where transaction.tenant_id = v_actor.tenant_id
    and transaction.id = p_transaction_id
  for update;

  if not found then
    raise exception 'transaction not found' using errcode = 'P0002';
  end if;

  if v_original.kind = 'undo'
    or v_original.created_at < now() - make_interval(secs => v_tenant.undo_window_seconds)
    or exists (
      select 1 from public.loyalty_transactions as reversal
      where reversal.reverses_id = v_original.id
    )
  then
    raise exception 'transaction is no longer eligible for undo' using errcode = '22023';
  end if;

  select membership.* into v_customer
  from public.tenant_memberships as membership
  where membership.tenant_id = v_actor.tenant_id
    and membership.id = v_original.customer_id
    and membership.role = 'customer'
  for update;

  if v_customer.stamps_balance - v_original.stamps_delta < 0
    or v_customer.points_balance - v_original.points_delta < 0
  then
    raise exception 'later activity prevents this undo' using errcode = '22003';
  end if;

  insert into public.loyalty_transactions (
    tenant_id,
    customer_id,
    actor_id,
    device_id,
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
    reverses_id,
    idempotency_key,
    metadata
  ) values (
    v_actor.tenant_id,
    v_customer.id,
    v_actor.id,
    p_device_id,
    v_original.reward_id,
    v_original.redemption_id,
    'undo',
    'undo',
    -v_original.stamps_delta,
    -v_original.points_delta,
    v_customer.stamps_balance,
    v_customer.stamps_balance - v_original.stamps_delta,
    v_customer.points_balance,
    v_customer.points_balance - v_original.points_delta,
    v_original.id,
    p_idempotency_key,
    jsonb_strip_nulls(jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), '')))
  ) returning * into v_transaction;

  perform set_config('loyalty.balance_mutation', 'on', true);
  update public.tenant_memberships
  set stamps_balance = v_transaction.stamps_after,
      points_balance = v_transaction.points_after,
      last_activity_at = now()
  where tenant_id = v_actor.tenant_id and id = v_customer.id;

  if v_original.redemption_id is not null then
    update public.reward_redemptions
    set status = case when expires_at > now() then 'issued'::public.redemption_status else 'expired'::public.redemption_status end,
        redeemed_at = null,
        redeemed_by = null,
        redeemed_device_id = null,
        redeemed_transaction_id = null
    where tenant_id = v_actor.tenant_id and id = v_original.redemption_id;
  end if;

  insert into public.audit_events (
    tenant_id, actor_id, device_id, action, target_type, target_id, request_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    p_device_id,
    'transaction.undone',
    'loyalty_transaction',
    v_original.id,
    p_idempotency_key,
    jsonb_build_object('undoTransactionId', v_transaction.id, 'reason', p_reason)
  );

  perform loyalty_private.enqueue_wallet_sync(
    v_actor.tenant_id,
    v_customer.id,
    v_transaction.id,
    v_original.redemption_id,
    'balance.updated',
    'transaction:' || v_transaction.id::text,
    jsonb_build_object(
      'transactionId', v_transaction.id,
      'stamps', v_transaction.stamps_after,
      'points', v_transaction.points_after,
      'undoes', v_original.id
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

create function public.admin_adjust_customer(
  p_actor_id uuid,
  p_customer_id uuid,
  p_idempotency_key text,
  p_stamps_delta integer,
  p_points_delta integer,
  p_reason text,
  p_device_id uuid default null
) returns setof public.loyalty_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_customer public.tenant_memberships;
  v_transaction public.loyalty_transactions;
  v_existing_transaction_id uuid;
  v_request_hash bytea;
begin
  v_actor := loyalty_private.require_actor(
    p_actor_id,
    array['owner']::public.profile_role[]
  );

  if p_device_id is not null then
    perform loyalty_private.require_device(v_actor, p_device_id);
  end if;

  if (coalesce(p_stamps_delta, 0) = 0 and coalesce(p_points_delta, 0) = 0)
    or length(trim(coalesce(p_reason, ''))) not between 3 and 500
  then
    raise exception 'an adjustment and reason are required' using errcode = '22023';
  end if;

  v_request_hash := extensions.digest(
    convert_to(jsonb_build_object(
      'actorId', p_actor_id,
      'customerId', p_customer_id,
      'stampsDelta', p_stamps_delta,
      'pointsDelta', p_points_delta,
      'reason', trim(p_reason),
      'deviceId', p_device_id
    )::text, 'UTF8'),
    'sha256'
  );

  v_existing_transaction_id := loyalty_private.claim_idempotency(
    v_actor.tenant_id,
    'transaction.admin_adjust',
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
    raise exception 'active customer not found' using errcode = 'P0002';
  end if;

  if v_customer.stamps_balance + coalesce(p_stamps_delta, 0) < 0
    or v_customer.points_balance + coalesce(p_points_delta, 0) < 0
  then
    raise exception 'adjustment would create a negative balance' using errcode = '22003';
  end if;

  insert into public.loyalty_transactions (
    tenant_id, customer_id, actor_id, device_id, kind, source,
    stamps_delta, points_delta, stamps_before, stamps_after,
    points_before, points_after, idempotency_key, metadata
  ) values (
    v_actor.tenant_id,
    v_customer.id,
    v_actor.id,
    p_device_id,
    'adjustment',
    'owner',
    coalesce(p_stamps_delta, 0),
    coalesce(p_points_delta, 0),
    v_customer.stamps_balance,
    v_customer.stamps_balance + coalesce(p_stamps_delta, 0),
    v_customer.points_balance,
    v_customer.points_balance + coalesce(p_points_delta, 0),
    p_idempotency_key,
    jsonb_build_object('reason', trim(p_reason))
  ) returning * into v_transaction;

  perform set_config('loyalty.balance_mutation', 'on', true);
  update public.tenant_memberships
  set stamps_balance = v_transaction.stamps_after,
      points_balance = v_transaction.points_after,
      last_activity_at = now()
  where tenant_id = v_actor.tenant_id and id = v_customer.id;

  insert into public.audit_events (
    tenant_id, actor_id, device_id, action, target_type, target_id, request_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    p_device_id,
    'customer.balance_adjusted',
    'tenant_membership',
    v_customer.id,
    p_idempotency_key,
    jsonb_build_object(
      'transactionId', v_transaction.id,
      'stampsDelta', v_transaction.stamps_delta,
      'pointsDelta', v_transaction.points_delta,
      'reason', trim(p_reason)
    )
  );

  perform loyalty_private.enqueue_wallet_sync(
    v_actor.tenant_id,
    v_customer.id,
    v_transaction.id,
    null,
    'balance.updated',
    'transaction:' || v_transaction.id::text,
    jsonb_build_object(
      'transactionId', v_transaction.id,
      'stamps', v_transaction.stamps_after,
      'points', v_transaction.points_after
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

create function public.admin_save_staff(
  p_actor_id uuid,
  p_membership_id uuid,
  p_first_name text,
  p_last_name text,
  p_staff_code text,
  p_pin text
) returns setof public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_staff public.tenant_memberships;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  if length(trim(coalesce(p_first_name, ''))) not between 1 and 80
    or length(coalesce(p_last_name, '')) > 100
    or length(trim(coalesce(p_staff_code, ''))) not between 2 and 30
    or (p_membership_id is null and p_pin !~ '^[0-9]{4}$')
    or (p_pin is not null and p_pin <> '' and p_pin !~ '^[0-9]{4}$')
  then
    raise exception 'invalid staff data' using errcode = '22023';
  end if;

  if p_pin is not null and p_pin <> '' and exists (
    select 1
    from public.staff_credentials as credential
    where credential.tenant_id = v_actor.tenant_id
      and credential.membership_id <> coalesce(p_membership_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and extensions.crypt(p_pin, credential.pin_hash) = credential.pin_hash
  ) then
    raise exception 'that PIN is already assigned in this tenant' using errcode = '23505';
  end if;

  if p_membership_id is null then
    insert into public.tenant_memberships (
      tenant_id, role, status, first_name, last_name, staff_code
    ) values (
      v_actor.tenant_id,
      'staff',
      'active',
      trim(p_first_name),
      trim(coalesce(p_last_name, '')),
      upper(trim(p_staff_code))
    ) returning * into v_staff;

    insert into public.staff_credentials (tenant_id, membership_id, pin_hash)
    values (
      v_actor.tenant_id,
      v_staff.id,
      extensions.crypt(p_pin, extensions.gen_salt('bf', 12))
    );
  else
    select membership.* into v_staff
    from public.tenant_memberships as membership
    where membership.tenant_id = v_actor.tenant_id
      and membership.id = p_membership_id
      and membership.role = 'staff'
    for update;

    if not found then
      raise exception 'staff membership not found' using errcode = 'P0002';
    end if;

    update public.tenant_memberships
    set first_name = trim(p_first_name),
        last_name = trim(coalesce(p_last_name, '')),
        staff_code = upper(trim(p_staff_code))
    where id = v_staff.id
    returning * into v_staff;

    if p_pin is not null and p_pin <> '' then
      update public.staff_credentials
      set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
          pin_version = pin_version + 1,
          failed_attempts = 0,
          locked_until = null
      where membership_id = v_staff.id;
    end if;
  end if;

  insert into public.audit_events (
    tenant_id, actor_id, action, target_type, target_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    case when p_membership_id is null then 'staff.created' else 'staff.updated' end,
    'tenant_membership',
    v_staff.id,
    jsonb_build_object('staffCode', v_staff.staff_code, 'pinChanged', coalesce(p_pin, '') <> '')
  );

  return query select membership.*
    from public.tenant_memberships as membership where membership.id = v_staff.id;
end;
$$;

create function public.admin_set_staff_status(
  p_actor_id uuid,
  p_membership_id uuid,
  p_status public.membership_status
) returns setof public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_staff public.tenant_memberships;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  update public.tenant_memberships
  set status = p_status
  where tenant_id = v_actor.tenant_id
    and id = p_membership_id
    and role = 'staff'
  returning * into v_staff;

  if not found then
    raise exception 'staff membership not found' using errcode = 'P0002';
  end if;

  if p_status <> 'active' then
    update public.staff_sessions
    set revoked_at = coalesce(revoked_at, now()),
        revoke_reason = coalesce(revoke_reason, 'staff status changed')
    where tenant_id = v_actor.tenant_id
      and staff_membership_id = v_staff.id
      and revoked_at is null;
  end if;

  insert into public.audit_events (
    tenant_id, actor_id, action, target_type, target_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    'staff.status_changed',
    'tenant_membership',
    v_staff.id,
    jsonb_build_object('status', p_status)
  );

  return query select membership.*
    from public.tenant_memberships as membership where membership.id = v_staff.id;
end;
$$;

create function public.admin_save_reward(
  p_actor_id uuid,
  p_reward_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_stamp_cost integer,
  p_point_cost integer,
  p_promotion_rule text default null,
  p_terms text default null,
  p_wallet_offer_enabled boolean default true,
  p_sort_order integer default 0
) returns setof public.rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_reward public.rewards;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  if upper(trim(coalesce(p_code, ''))) !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'
    or length(trim(coalesce(p_name, ''))) not between 1 and 120
    or p_stamp_cost <= 0
    or p_point_cost <= 0
  then
    raise exception 'invalid reward data' using errcode = '22023';
  end if;

  if p_reward_id is null then
    insert into public.rewards (
      tenant_id, code, name, description, stamp_cost, point_cost,
      promotion_rule, terms, wallet_offer_enabled, sort_order
    ) values (
      v_actor.tenant_id,
      upper(trim(p_code)),
      trim(p_name),
      trim(coalesce(p_description, '')),
      p_stamp_cost,
      p_point_cost,
      nullif(trim(coalesce(p_promotion_rule, '')), ''),
      nullif(trim(coalesce(p_terms, '')), ''),
      p_wallet_offer_enabled,
      p_sort_order
    ) returning * into v_reward;
  else
    update public.rewards
    set code = upper(trim(p_code)),
        name = trim(p_name),
        description = trim(coalesce(p_description, '')),
        stamp_cost = p_stamp_cost,
        point_cost = p_point_cost,
        promotion_rule = nullif(trim(coalesce(p_promotion_rule, '')), ''),
        terms = nullif(trim(coalesce(p_terms, '')), ''),
        wallet_offer_enabled = p_wallet_offer_enabled,
        sort_order = p_sort_order
    where tenant_id = v_actor.tenant_id and id = p_reward_id
    returning * into v_reward;

    if not found then
      raise exception 'reward not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_events (
    tenant_id, actor_id, action, target_type, target_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    case when p_reward_id is null then 'reward.created' else 'reward.updated' end,
    'reward',
    v_reward.id,
    jsonb_build_object('code', v_reward.code)
  );

  return query select reward.* from public.rewards as reward where reward.id = v_reward.id;
end;
$$;

create function public.admin_set_reward_active(
  p_actor_id uuid,
  p_reward_id uuid,
  p_active boolean
) returns setof public.rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_reward public.rewards;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  update public.rewards
  set active = p_active
  where tenant_id = v_actor.tenant_id and id = p_reward_id
  returning * into v_reward;

  if not found then
    raise exception 'reward not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    tenant_id, actor_id, action, target_type, target_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    'reward.status_changed',
    'reward',
    v_reward.id,
    jsonb_build_object('active', p_active)
  );

  return query select reward.* from public.rewards as reward where reward.id = v_reward.id;
end;
$$;

create function public.admin_update_program(
  p_actor_id uuid,
  p_program_type public.program_type,
  p_stamp_goal smallint,
  p_points_per_dollar numeric,
  p_duplicate_window_seconds smallint default 30,
  p_undo_window_seconds smallint default 60,
  p_name text default null,
  p_wallet_brand jsonb default null,
  p_public_info jsonb default null
) returns setof public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_tenant public.tenants;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  if (p_name is not null and length(trim(p_name)) not between 1 and 120)
    or (p_wallet_brand is not null and jsonb_typeof(p_wallet_brand) <> 'object')
    or (p_public_info is not null and jsonb_typeof(p_public_info) <> 'object')
  then
    raise exception 'invalid tenant display data' using errcode = '22023';
  end if;

  update public.tenants
  set program_type = p_program_type,
      stamp_goal = p_stamp_goal,
      points_per_dollar = p_points_per_dollar,
      duplicate_window_seconds = p_duplicate_window_seconds,
      undo_window_seconds = p_undo_window_seconds,
      name = case when p_name is null then name else trim(p_name) end,
      wallet_brand = case
        when p_wallet_brand is null then wallet_brand
        else wallet_brand || p_wallet_brand
      end,
      public_info = case
        when p_public_info is null then public_info
        else public_info || p_public_info
      end
  where id = v_actor.tenant_id
  returning * into v_tenant;

  insert into public.audit_events (
    tenant_id, actor_id, action, target_type, target_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    'program.updated',
    'tenant',
    v_tenant.id,
    jsonb_build_object(
      'programType', v_tenant.program_type,
      'stampGoal', v_tenant.stamp_goal,
      'pointsPerDollar', v_tenant.points_per_dollar,
      'duplicateWindowSeconds', v_tenant.duplicate_window_seconds,
      'undoWindowSeconds', v_tenant.undo_window_seconds,
      'changedFields', to_jsonb(array_remove(array[
        'programType'::text,
        'stampGoal',
        'pointsPerDollar',
        'duplicateWindowSeconds',
        'undoWindowSeconds',
        case when p_name is not null then 'name' end,
        case when p_wallet_brand is not null then 'walletBrand' end,
        case when p_public_info is not null then 'publicInfo' end
      ], null))
    )
  );

  return query select tenant.* from public.tenants as tenant where tenant.id = v_tenant.id;
end;
$$;

create function public.admin_enroll_device(
  p_actor_id uuid,
  p_device_id uuid,
  p_label text,
  p_platform text,
  p_device_token_hash bytea,
  p_public_key_jwk jsonb
) returns setof public.store_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_device public.store_devices;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  if length(trim(coalesce(p_label, ''))) not between 1 and 120
    or p_platform not in ('web', 'android', 'ios')
    or p_device_token_hash is null
    or jsonb_typeof(p_public_key_jwk) <> 'object'
  then
    raise exception 'invalid device data' using errcode = '22023';
  end if;

  if p_device_id is null then
    insert into public.store_devices (
      tenant_id, label, platform, status, device_token_hash, public_key_jwk,
      enrolled_by, enrolled_at
    ) values (
      v_actor.tenant_id,
      trim(p_label),
      p_platform,
      'active',
      p_device_token_hash,
      p_public_key_jwk,
      v_actor.id,
      now()
    ) returning * into v_device;
  else
    insert into public.store_devices (
      id, tenant_id, label, platform, status, device_token_hash, public_key_jwk,
      enrolled_by, enrolled_at
    ) values (
      p_device_id,
      v_actor.tenant_id,
      trim(p_label),
      p_platform,
      'active',
      p_device_token_hash,
      p_public_key_jwk,
      v_actor.id,
      now()
    ) on conflict (id) do update
      set label = excluded.label,
          platform = excluded.platform,
          status = 'active',
          device_token_hash = excluded.device_token_hash,
          public_key_jwk = excluded.public_key_jwk,
          enrolled_by = excluded.enrolled_by,
          enrolled_at = coalesce(store_devices.enrolled_at, now()),
          revoked_at = null
      where store_devices.tenant_id = excluded.tenant_id
    returning * into v_device;

    if not found then
      raise exception 'device not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.staff_device_access (
    tenant_id, staff_membership_id, device_id, granted_by
  ) values (
    v_actor.tenant_id, v_actor.id, v_device.id, v_actor.id
  ) on conflict (tenant_id, staff_membership_id, device_id) do update
    set revoked_at = null, granted_by = excluded.granted_by, granted_at = now();

  insert into public.audit_events (
    tenant_id, actor_id, device_id, action, target_type, target_id
  ) values (
    v_actor.tenant_id, v_actor.id, v_device.id, 'device.enrolled', 'store_device', v_device.id
  );

  return query select device.* from public.store_devices as device where device.id = v_device.id;
end;
$$;

create function public.admin_set_device_staff_access(
  p_actor_id uuid,
  p_device_id uuid,
  p_staff_membership_id uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  if not exists (
    select 1 from public.store_devices
    where tenant_id = v_actor.tenant_id and id = p_device_id and status = 'active'
  ) or not exists (
    select 1 from public.tenant_memberships
    where tenant_id = v_actor.tenant_id
      and id = p_staff_membership_id
      and role in ('staff', 'owner')
      and status = 'active'
  ) then
    raise exception 'active device or staff member not found' using errcode = 'P0002';
  end if;

  insert into public.staff_device_access (
    tenant_id, staff_membership_id, device_id, granted_by, revoked_at
  ) values (
    v_actor.tenant_id,
    p_staff_membership_id,
    p_device_id,
    v_actor.id,
    case when p_enabled then null else now() end
  ) on conflict (tenant_id, staff_membership_id, device_id) do update
    set granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = excluded.revoked_at;

  insert into public.audit_events (
    tenant_id, actor_id, device_id, action, target_type, target_id, metadata
  ) values (
    v_actor.tenant_id,
    v_actor.id,
    p_device_id,
    'device.staff_access_changed',
    'tenant_membership',
    p_staff_membership_id,
    jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

create function public.admin_revoke_device(
  p_actor_id uuid,
  p_device_id uuid
) returns setof public.store_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.tenant_memberships;
  v_device public.store_devices;
  v_was_revoked boolean;
begin
  v_actor := loyalty_private.require_actor(p_actor_id, array['owner']::public.profile_role[]);

  select device.* into v_device
  from public.store_devices as device
  where device.tenant_id = v_actor.tenant_id
    and device.id = p_device_id
  for update;

  if not found then
    raise exception 'device not found' using errcode = 'P0002';
  end if;

  v_was_revoked := v_device.status = 'revoked';

  update public.store_devices
  set status = 'revoked',
      revoked_at = coalesce(revoked_at, now())
  where tenant_id = v_actor.tenant_id and id = v_device.id
  returning * into v_device;

  update public.staff_device_access
  set revoked_at = coalesce(revoked_at, now())
  where tenant_id = v_actor.tenant_id
    and device_id = v_device.id;

  update public.staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      revoke_reason = coalesce(revoke_reason, 'device revoked by owner')
  where tenant_id = v_actor.tenant_id
    and device_id = v_device.id
    and revoked_at is null;

  if not v_was_revoked then
    insert into public.audit_events (
      tenant_id, actor_id, device_id, action, target_type, target_id
    ) values (
      v_actor.tenant_id,
      v_actor.id,
      v_device.id,
      'device.revoked',
      'store_device',
      v_device.id
    );
  end if;

  return query select device.*
    from public.store_devices as device where device.id = v_device.id;
end;
$$;

create function public.register_wallet_pass(
  p_customer_id uuid,
  p_wallet_class_id uuid,
  p_object_suffix text,
  p_object_id text,
  p_lookup_hash bytea,
  p_secret_ciphertext text,
  p_key_version smallint default 1
) returns setof public.wallet_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.tenant_memberships;
  v_class public.wallet_classes;
  v_pass public.wallet_passes;
begin
  select membership.* into v_customer
  from public.tenant_memberships as membership
  where membership.id = p_customer_id
    and membership.role = 'customer'
    and membership.status = 'active';

  if not found then
    raise exception 'active customer not found' using errcode = 'P0002';
  end if;

  select class.* into v_class
  from public.wallet_classes as class
  where class.tenant_id = v_customer.tenant_id
    and class.id = p_wallet_class_id;

  if not found then
    raise exception 'wallet class not found' using errcode = 'P0002';
  end if;

  insert into public.wallet_passes (
    tenant_id, membership_id, wallet_class_id, provider,
    object_suffix, object_id, status, issued_at
  ) values (
    v_customer.tenant_id,
    v_customer.id,
    v_class.id,
    v_class.provider,
    p_object_suffix,
    p_object_id,
    'active',
    now()
  ) on conflict (tenant_id, membership_id, provider) do update
    set wallet_class_id = excluded.wallet_class_id,
        object_suffix = excluded.object_suffix,
        object_id = excluded.object_id,
        status = 'active',
        issued_at = coalesce(wallet_passes.issued_at, now()),
        revoked_at = null,
        last_error = null
  returning * into v_pass;

  if not exists (
    select 1
    from public.wallet_barcode_credentials as credential
    where credential.wallet_pass_id = v_pass.id
      and credential.active
      and credential.lookup_hash = p_lookup_hash
  ) then
    update public.wallet_barcode_credentials
    set active = false, retired_at = now()
    where wallet_pass_id = v_pass.id and active;

    insert into public.wallet_barcode_credentials (
      tenant_id, membership_id, wallet_pass_id, lookup_hash,
      secret_ciphertext, key_version
    ) values (
      v_customer.tenant_id,
      v_customer.id,
      v_pass.id,
      p_lookup_hash,
      p_secret_ciphertext,
      p_key_version
    );
  end if;

  perform loyalty_private.enqueue_wallet_sync(
    v_customer.tenant_id,
    v_customer.id,
    null,
    null,
    'pass.issued',
    'pass-issued:' || v_pass.id::text,
    jsonb_build_object('walletPassId', v_pass.id)
  );

  return query select pass.* from public.wallet_passes as pass where pass.id = v_pass.id;
end;
$$;

create function public.claim_wallet_sync_jobs(p_limit integer default 20)
returns table (
  job_id bigint,
  tenant_id uuid,
  membership_id uuid,
  wallet_pass_id uuid,
  provider public.wallet_provider,
  object_id text,
  event_kind text,
  payload jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 100 then
    raise exception 'job limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  with selected as (
    select job.id
    from public.wallet_sync_outbox as job
    where (
        job.status = 'pending'
        or (job.status = 'processing' and job.locked_at < now() - interval '5 minutes')
      )
      and job.available_at <= now()
    order by job.available_at, job.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.wallet_sync_outbox as job
    set status = 'processing',
        attempts = job.attempts + 1,
        locked_at = now(),
        locked_by = coalesce(current_setting('request.jwt.claim.sub', true), 'wallet-sync-worker')
    from selected
    where job.id = selected.id
    returning job.*
  )
  select
    claimed.id,
    claimed.tenant_id,
    pass.membership_id,
    claimed.wallet_pass_id,
    pass.provider,
    pass.object_id,
    claimed.event_kind,
    claimed.payload,
    claimed.attempts
  from claimed
  join public.wallet_passes as pass
    on pass.tenant_id = claimed.tenant_id
   and pass.id = claimed.wallet_pass_id;
end;
$$;

create function public.finish_wallet_sync_job(
  p_job_id bigint,
  p_success boolean,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.wallet_sync_outbox;
begin
  select job.* into v_job
  from public.wallet_sync_outbox as job
  where job.id = p_job_id
  for update;

  if not found or v_job.status <> 'processing' then
    raise exception 'claimed wallet sync job not found' using errcode = 'P0002';
  end if;

  if p_success then
    update public.wallet_sync_outbox
    set status = 'completed',
        completed_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = null
    where id = p_job_id;

    update public.wallet_passes
    set sync_version = sync_version + 1,
        last_synced_at = now(),
        last_error = null
    where tenant_id = v_job.tenant_id and id = v_job.wallet_pass_id;
  else
    update public.wallet_sync_outbox
    set status = case when attempts >= 8 then 'dead_letter'::public.outbox_status else 'pending'::public.outbox_status end,
        available_at = case
          when attempts >= 8 then available_at
          else now() + make_interval(secs => least(3600, power(2, attempts)::integer))
        end,
        locked_at = null,
        locked_by = null,
        last_error = left(coalesce(p_error, 'unknown wallet provider error'), 2000)
    where id = p_job_id;

    update public.wallet_passes
    set status = case when v_job.attempts >= 8 then 'error'::public.wallet_pass_status else status end,
        last_error = left(coalesce(p_error, 'unknown wallet provider error'), 2000)
    where tenant_id = v_job.tenant_id and id = v_job.wallet_pass_id;
  end if;
end;
$$;

revoke all on function public.undo_loyalty_transaction(uuid, uuid, text, text, uuid) from public;
revoke all on function public.admin_adjust_customer(uuid, uuid, text, integer, integer, text, uuid) from public;
revoke all on function public.admin_save_staff(uuid, uuid, text, text, text, text) from public;
revoke all on function public.admin_set_staff_status(uuid, uuid, public.membership_status) from public;
revoke all on function public.admin_save_reward(uuid, uuid, text, text, text, integer, integer, text, text, boolean, integer) from public;
revoke all on function public.admin_set_reward_active(uuid, uuid, boolean) from public;
revoke all on function public.admin_update_program(uuid, public.program_type, smallint, numeric, smallint, smallint, text, jsonb, jsonb) from public;
revoke all on function public.admin_enroll_device(uuid, uuid, text, text, bytea, jsonb) from public;
revoke all on function public.admin_set_device_staff_access(uuid, uuid, uuid, boolean) from public;
revoke all on function public.admin_revoke_device(uuid, uuid) from public;
revoke all on function public.register_wallet_pass(uuid, uuid, text, text, bytea, text, smallint) from public;
revoke all on function public.claim_wallet_sync_jobs(integer) from public;
revoke all on function public.finish_wallet_sync_job(bigint, boolean, text) from public;

grant execute on function public.undo_loyalty_transaction(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.admin_adjust_customer(uuid, uuid, text, integer, integer, text, uuid) to service_role;
grant execute on function public.admin_save_staff(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.admin_set_staff_status(uuid, uuid, public.membership_status) to service_role;
grant execute on function public.admin_save_reward(uuid, uuid, text, text, text, integer, integer, text, text, boolean, integer) to service_role;
grant execute on function public.admin_set_reward_active(uuid, uuid, boolean) to service_role;
grant execute on function public.admin_update_program(uuid, public.program_type, smallint, numeric, smallint, smallint, text, jsonb, jsonb) to service_role;
grant execute on function public.admin_enroll_device(uuid, uuid, text, text, bytea, jsonb) to service_role;
grant execute on function public.admin_set_device_staff_access(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.admin_revoke_device(uuid, uuid) to service_role;
grant execute on function public.register_wallet_pass(uuid, uuid, text, text, bytea, text, smallint) to service_role;
grant execute on function public.claim_wallet_sync_jobs(integer) to service_role;
grant execute on function public.finish_wallet_sync_job(bigint, boolean, text) to service_role;

commit;
