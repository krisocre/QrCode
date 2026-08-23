begin;

create view public.staff_customer_directory
with (security_invoker = true)
as
select
  membership.id as customer_id,
  membership.tenant_id,
  membership.member_number,
  membership.first_name,
  membership.last_name,
  profile.phone_e164,
  membership.stamps_balance,
  membership.points_balance,
  membership.joined_at,
  membership.last_activity_at
from public.tenant_memberships as membership
left join public.profiles as profile on profile.id = membership.profile_id
where membership.role = 'customer' and membership.status = 'active';

create view public.transaction_feed
with (security_invoker = true)
as
select
  transaction.id,
  transaction.tenant_id,
  transaction.customer_id,
  customer.first_name as customer_first_name,
  customer.last_name as customer_last_name,
  transaction.actor_id,
  actor.first_name as actor_first_name,
  actor.last_name as actor_last_name,
  actor.staff_code,
  transaction.kind,
  transaction.source,
  transaction.stamps_delta,
  transaction.points_delta,
  transaction.stamps_after,
  transaction.points_after,
  transaction.reward_id,
  reward.name as reward_name,
  transaction.reverses_id,
  transaction.occurred_at,
  transaction.created_at
from public.loyalty_transactions as transaction
join public.tenant_memberships as customer
  on customer.tenant_id = transaction.tenant_id and customer.id = transaction.customer_id
left join public.tenant_memberships as actor
  on actor.tenant_id = transaction.tenant_id and actor.id = transaction.actor_id
left join public.rewards as reward
  on reward.tenant_id = transaction.tenant_id and reward.id = transaction.reward_id;

revoke all on table public.staff_customer_directory, public.transaction_feed from anon, authenticated;
grant select on table public.staff_customer_directory, public.transaction_feed to authenticated;
grant select on table public.staff_customer_directory, public.transaction_feed to service_role;

alter table public.tenant_memberships replica identity full;
alter table public.rewards replica identity full;
alter table public.wallet_passes replica identity full;
alter table public.reward_redemptions replica identity full;
alter table public.loyalty_transactions replica identity full;

-- Supabase creates this publication. The guard keeps the migration usable in a
-- plain PostgreSQL validation database where the publication is absent.
do $$
declare
  v_table text;
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    foreach v_table in array array[
      'tenant_memberships',
      'rewards',
      'wallet_passes',
      'reward_redemptions',
      'loyalty_transactions'
    ] loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

create function public.run_loyalty_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired_redemptions integer := 0;
  v_deleted_otp integer := 0;
  v_deleted_staff_attempts integer := 0;
  v_deleted_sessions integer := 0;
  v_deleted_idempotency integer := 0;
begin
  with expired as (
    update public.reward_redemptions
    set status = 'expired'
    where status = 'issued' and expires_at <= now()
    returning tenant_id, customer_id, id
  ), queued as (
    insert into public.wallet_sync_outbox (
      tenant_id, wallet_pass_id, redemption_id, event_kind, dedupe_key, payload
    )
    select
      expired.tenant_id,
      pass.id,
      expired.id,
      'redemption.expired',
      'redemption-expired:' || expired.id::text,
      jsonb_build_object('redemptionId', expired.id)
    from expired
    join public.wallet_passes as pass
      on pass.tenant_id = expired.tenant_id
     and pass.membership_id = expired.customer_id
     and pass.status = 'active'
    on conflict (wallet_pass_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_expired_redemptions from expired;

  delete from public.otp_requests where created_at < now() - interval '7 days';
  get diagnostics v_deleted_otp = row_count;

  delete from public.staff_auth_attempts where attempted_at < now() - interval '30 days';
  get diagnostics v_deleted_staff_attempts = row_count;

  delete from public.staff_sessions
  where expires_at < now() - interval '30 days'
     or (revoked_at is not null and revoked_at < now() - interval '30 days');
  get diagnostics v_deleted_sessions = row_count;

  delete from public.idempotency_keys where expires_at < now();
  get diagnostics v_deleted_idempotency = row_count;

  return jsonb_build_object(
    'expiredRedemptions', v_expired_redemptions,
    'deletedOtpRequests', v_deleted_otp,
    'deletedStaffAttempts', v_deleted_staff_attempts,
    'deletedStaffSessions', v_deleted_sessions,
    'deletedIdempotencyKeys', v_deleted_idempotency
  );
end;
$$;

revoke all on function public.run_loyalty_maintenance() from public;
grant execute on function public.run_loyalty_maintenance() to service_role;

comment on function public.run_loyalty_maintenance() is
  'Run from a trusted daily cron. It never deletes ledger or audit history.';

commit;
