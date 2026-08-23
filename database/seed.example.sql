-- Non-secret example catalog for a fresh development project.
-- Review and replace all business details before applying to production.

insert into public.tenants (
  id,
  slug,
  name,
  legal_name,
  timezone,
  currency_code,
  country_code,
  program_type,
  stamp_goal,
  points_per_dollar,
  require_registered_device,
  wallet_brand,
  public_info
) values (
  '10000000-0000-4000-8000-000000000001',
  'luxe-hair-studio',
  'Luxe Hair Studio',
  'REPLACE WITH LEGAL BUSINESS NAME',
  'America/Toronto',
  'CAD',
  'CA',
  'stamps',
  8,
  1,
  true,
  jsonb_build_object(
    'brandColor', '#D65A87',
    'logoUrl', 'https://REPLACE.example/logo.png',
    'heroImageUrl', 'https://REPLACE.example/hero.jpg'
  ),
  jsonb_build_object(
    'address', 'REPLACE WITH SALON ADDRESS',
    'phone', '+1REPLACE',
    'openingHours', jsonb_build_object(
      'Monday', 'REPLACE',
      'Tuesday', 'REPLACE',
      'Wednesday', 'REPLACE',
      'Thursday', 'REPLACE',
      'Friday', 'REPLACE',
      'Saturday', 'REPLACE',
      'Sunday', 'Closed'
    ),
    'generalInfo', 'REPLACE WITH GENERAL SALON INFORMATION',
    'privacyUrl', 'https://REPLACE.example/privacy',
    'termsUrl', 'https://REPLACE.example/terms'
  )
) on conflict (slug) do nothing;

insert into public.rewards (
  id, tenant_id, code, name, description, stamp_cost, point_cost,
  promotion_rule, sort_order
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'SCALP_TREATMENT',
    'Complimentary Scalp Treatment',
    'A relaxing treatment added to your salon visit.',
    5,
    500,
    'Available after five completed visits.',
    10
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'GLOSS_REFRESH',
    'Glossing and Tonal Refresh',
    'A complimentary glossing and tonal refresh.',
    8,
    800,
    'Available after a full eight-visit card.',
    20
  )
on conflict (tenant_id, code) do nothing;

-- Add a real Google Wallet class only after receiving an issuer ID. Example:
-- insert into public.wallet_classes (
--   tenant_id, provider, issuer_account_id, class_id, status, configuration
-- ) values (
--   '10000000-0000-4000-8000-000000000001',
--   'google',
--   'REPLACE_WITH_GOOGLE_ISSUER_ID',
--   'REPLACE_WITH_ISSUER_ID.luxe_loyalty',
--   'pending',
--   '{}'::jsonb
-- );

-- Owner bootstrap is deliberately not seeded. After the owner signs in once,
-- use the trusted server with their real auth.users ID:
-- select * from public.bootstrap_tenant_owner(
--   'REPLACE_WITH_AUTH_USER_UUID',
--   'luxe-hair-studio',
--   'REPLACE_FIRST_NAME',
--   'REPLACE_LAST_NAME',
--   '+1REPLACE',
--   'REPLACE@example.com'
-- );
