-- Turnstile is no longer part of the SMS OTP flow. Keep this migration so
-- databases created before the removal converge with fresh installations.
alter table public.otp_requests
  drop column if exists turnstile_verified;
