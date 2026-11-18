# Phase 1 — Local and Supabase Setup

## Local application

1. Copy `.env.example` to `.env.local` and set the Supabase URL, publishable key, app URL and server-only secret key.
2. Install the committed lockfile with `npm ci`, then start with `npm run dev`.
3. Open `http://localhost:3000`. The app redirects to sign-in; without Supabase settings, the sign-in page shows setup instructions.

If Node reports a certificate-chain error on this Windows setup, use the system certificate store for that PowerShell session: `$env:NODE_USE_SYSTEM_CA = '1'; npm ci`. Node 24.6+ supports this setting; it does not disable TLS checks or change global npm configuration.

Never place a Supabase `service_role` or secret key in `NEXT_PUBLIC_*`, browser code, or this repository. `SUPABASE_SECRET_KEY` is used only by server-side invitation and platform-role actions. The browser uses the publishable key and database row-level security.

## Supabase project setup

1. Create an SFI-owned Supabase project and choose its data region after privacy, latency and commercial review.
2. Configure email sign-in, disable public sign-up, set the local and production Site URL/redirect allowlist, and configure reliable SMTP before inviting real users.
3. Apply `supabase/migrations/202611170001_initial_access_control.sql` in the Supabase SQL editor or through the Supabase CLI.
4. Invite the first named SFI administrator through Supabase Auth. Confirm the email and copy the user's UUID from Authentication → Users.
5. In the SQL editor, grant that known account the first platform-admin role:

```sql
insert into public.platform_admins (user_id, granted_by)
values ('AUTH_USER_UUID', 'AUTH_USER_UUID')
on conflict (user_id) do nothing;
```

6. Add the project URL, publishable key, secret key and local app URL to `.env.local`, restart the app, and sign in. `/admin` checks role server-side through `is_platform_admin()`. `/admin/users` can then invite colleagues and grant or revoke platform-admin access.

The migration has no client write policy for platform-admin assignments and no anonymous access. Invitations and platform-admin grants are handled by trusted administrative actions. Organisation creation and organisation-level role management remain follow-on work.

## Auth provider configuration

- Keep public account sign-up disabled; accounts are invitation-only in this initial foundation.
- Enable email confirmation and configure password recovery redirects to `/auth/callback?next=/reset-password`.
- Add both localhost and the final HTTPS application URL to the redirect allowlist.
- Configure production SMTP before relying on password reset or invitations; default provider limits are not a production mail service.
- Review session expiry and MFA settings before institutional accounts are enabled.

## Current boundary

Authentication, route guards, session refresh, schema, row-level security, email invitations, platform-admin controls and the administration shell are implemented. This workspace does not provision an SFI-owned Supabase project or populate `.env.local`; SFI must create the project, run the migration and bootstrap its first platform administrator. Market data, organisation-level role management and production email are not part of this milestone.
