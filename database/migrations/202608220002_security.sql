begin;

create function public.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.profile_role[]
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships as membership
    where membership.tenant_id = p_tenant_id
      and membership.profile_id = auth.uid()
      and membership.status = 'active'
      and membership.role = any (p_roles)
  )
$$;

create function public.can_read_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = auth.uid()
    or exists (
      select 1
      from public.tenant_memberships as viewer
      join public.tenant_memberships as subject
        on subject.tenant_id = viewer.tenant_id
      where viewer.profile_id = auth.uid()
        and viewer.status = 'active'
        and viewer.role in ('staff', 'owner')
        and subject.profile_id = p_profile_id
    )
$$;

create function public.current_membership_id(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id
  from public.tenant_memberships as membership
  where membership.tenant_id = p_tenant_id
    and membership.profile_id = auth.uid()
    and membership.status = 'active'
  limit 1
$$;

create function public.otp_rate_limit_available(
  p_tenant_id uuid,
  p_phone_hash text,
  p_ip_hash text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 3
  from public.otp_requests
  where tenant_id = p_tenant_id
    and created_at >= now() - interval '1 hour'
    and (phone_hash = p_phone_hash or ip_hash = p_ip_hash)
$$;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.staff_credentials enable row level security;
alter table public.store_devices enable row level security;
alter table public.staff_device_access enable row level security;
alter table public.staff_sessions enable row level security;
alter table public.staff_auth_attempts enable row level security;
alter table public.rewards enable row level security;
alter table public.wallet_classes enable row level security;
alter table public.wallet_passes enable row level security;
alter table public.wallet_barcode_credentials enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.audit_events enable row level security;
alter table public.wallet_sync_outbox enable row level security;
alter table public.otp_requests enable row level security;
alter table public.customer_consents enable row level security;

create policy tenants_public_read on public.tenants
  for select
  using (is_active or public.has_tenant_role(id, array['staff', 'owner']::public.profile_role[]));

create policy profiles_authorized_read on public.profiles
  for select
  to authenticated
  using (public.can_read_profile(id));

create policy memberships_authorized_read on public.tenant_memberships
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or public.has_tenant_role(tenant_id, array['staff', 'owner']::public.profile_role[])
  );

create policy rewards_public_catalog on public.rewards
  for select
  using (
    active
    and (available_from is null or available_from <= now())
    and (available_until is null or available_until > now())
    and exists (
      select 1 from public.tenants
      where tenants.id = rewards.tenant_id and tenants.is_active
    )
  );

create policy rewards_owner_catalog on public.rewards
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id, array['owner']::public.profile_role[]));

create policy wallet_classes_member_read on public.wallet_classes
  for select
  to authenticated
  using (
    status = 'active'
    and exists (
      select 1
      from public.tenant_memberships
      where tenant_memberships.tenant_id = wallet_classes.tenant_id
        and tenant_memberships.profile_id = auth.uid()
        and tenant_memberships.status = 'active'
    )
  );

create policy wallet_passes_authorized_read on public.wallet_passes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships
      where tenant_memberships.id = wallet_passes.membership_id
        and tenant_memberships.profile_id = auth.uid()
    )
    or public.has_tenant_role(tenant_id, array['staff', 'owner']::public.profile_role[])
  );

create policy redemptions_authorized_read on public.reward_redemptions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships
      where tenant_memberships.id = reward_redemptions.customer_id
        and tenant_memberships.profile_id = auth.uid()
    )
    or public.has_tenant_role(tenant_id, array['staff', 'owner']::public.profile_role[])
  );

create policy transactions_authorized_read on public.loyalty_transactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships
      where tenant_memberships.id = loyalty_transactions.customer_id
        and tenant_memberships.profile_id = auth.uid()
    )
    or public.has_tenant_role(tenant_id, array['staff', 'owner']::public.profile_role[])
  );

create policy devices_owner_or_assigned_read on public.store_devices
  for select
  to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner']::public.profile_role[])
    or exists (
      select 1
      from public.staff_device_access as access
      join public.tenant_memberships as membership
        on membership.tenant_id = access.tenant_id
       and membership.id = access.staff_membership_id
      where access.tenant_id = store_devices.tenant_id
        and access.device_id = store_devices.id
        and access.revoked_at is null
        and membership.profile_id = auth.uid()
        and membership.status = 'active'
    )
  );

create policy device_access_owner_or_self_read on public.staff_device_access
  for select
  to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner']::public.profile_role[])
    or exists (
      select 1
      from public.tenant_memberships
      where tenant_memberships.id = staff_device_access.staff_membership_id
        and tenant_memberships.profile_id = auth.uid()
        and tenant_memberships.status = 'active'
    )
  );

create policy audit_owner_read on public.audit_events
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id, array['owner']::public.profile_role[]));

-- No browser INSERT/UPDATE/DELETE policies exist. All mutations go through the
-- server-only RPCs in the next migration. Private credential, session,
-- idempotency, outbox, rate-limit, and barcode tables intentionally have no
-- browser SELECT policy either.
revoke all on table public.tenants from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.tenant_memberships from anon, authenticated;
revoke all on table public.staff_credentials from anon, authenticated;
revoke all on table public.store_devices from anon, authenticated;
revoke all on table public.staff_device_access from anon, authenticated;
revoke all on table public.staff_sessions from anon, authenticated;
revoke all on table public.staff_auth_attempts from anon, authenticated;
revoke all on table public.rewards from anon, authenticated;
revoke all on table public.wallet_classes from anon, authenticated;
revoke all on table public.wallet_passes from anon, authenticated;
revoke all on table public.wallet_barcode_credentials from anon, authenticated;
revoke all on table public.reward_redemptions from anon, authenticated;
revoke all on table public.loyalty_transactions from anon, authenticated;
revoke all on table public.idempotency_keys from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
revoke all on table public.wallet_sync_outbox from anon, authenticated;
revoke all on table public.otp_requests from anon, authenticated;
revoke all on table public.customer_consents from anon, authenticated;

grant select on table public.tenants, public.rewards to anon, authenticated;
grant select on table public.profiles, public.tenant_memberships, public.store_devices,
  public.staff_device_access, public.wallet_classes, public.wallet_passes,
  public.reward_redemptions, public.loyalty_transactions, public.audit_events
  to authenticated;

revoke all on function public.has_tenant_role(uuid, public.profile_role[]) from public;
revoke all on function public.can_read_profile(uuid) from public;
revoke all on function public.current_membership_id(uuid) from public;
revoke all on function public.otp_rate_limit_available(uuid, text, text) from public;
grant execute on function public.has_tenant_role(uuid, public.profile_role[]) to anon, authenticated;
grant execute on function public.can_read_profile(uuid) to authenticated;
grant execute on function public.current_membership_id(uuid) to authenticated;
grant execute on function public.otp_rate_limit_available(uuid, text, text) to service_role;

create view public.member_wallet_summary
with (security_invoker = true)
as
select
  membership.id as membership_id,
  membership.tenant_id,
  membership.profile_id,
  membership.member_number,
  membership.stamps_balance,
  membership.points_balance,
  membership.joined_at,
  membership.first_name,
  membership.last_name,
  profile.phone_e164,
  tenant.slug as tenant_slug,
  tenant.name as tenant_name,
  tenant.program_type,
  tenant.stamp_goal,
  tenant.points_per_dollar
from public.tenant_memberships as membership
join public.profiles as profile on profile.id = membership.profile_id
join public.tenants as tenant on tenant.id = membership.tenant_id
where membership.status = 'active';

revoke all on table public.member_wallet_summary from anon, authenticated;
grant select on table public.member_wallet_summary to authenticated;

-- Supabase normally supplies equivalent default privileges. Keep them explicit
-- so service-role REST access also works in projects with custom defaults.
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;
