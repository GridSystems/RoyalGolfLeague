# Phase 2 — Real login, database permissions, audit log

**Date:** 2026-09-24 · **Status:** approved design, awaiting spec review
**Roadmap:** Phase 2 of 4 (0 hide credentials — live · 1 IDs + FKs + version gate — live · **2 real login + permissions** · 3 GDPR rights)

## Why

After Phases 0 and 1 the credentials are hidden and the data is clean, but two gaps remain:

1. **Impersonation.** The "session" is a player id in `sessionStorage`; anyone can edit it and become
   any player, including an admin. The admin PIN (`saturday`, in `localStorage`) is UI-only.
2. **Public writes.** The public (anon) key can insert, update and delete almost every table.

The user also asked for **"Forgot password" on the login screen** and an **audit log wherever it
happens**, and noticed that after signing in the app **first renders as nobody, then refreshes as
the player** — to be fixed here.

## Decisions (made in brainstorming)

| # | Decision |
|---|---|
| 1 | **Email + password** login via Supabase Auth, with **Forgot password** |
| 2 | Passwords **hashed (bcrypt) by Supabase Auth**, never stored or readable; min **8** characters, no complexity rules; plain-text PIN columns **deleted** at release B |
| 3 | **Audit log**, written only by the database, admin-readable, **12-month** retention, plus a **money trail** |
| 4 | **Two-factor (authenticator app) for admins only**, unlocking an **admin mode** that the database enforces and that **expires after 12 hours** |
| 5 | **Self-service move-over**: existing members set up their new login themselves; the old PIN login keeps working until the admin switches it off |
| 6 | Permission model: members can score for their group and issue fines; own profile only; GPS private; draw via a database function; admin powers and emails admin-only |
| 7 | **supabase-js for login only**, from jsDelivr, pinned version; the app's data helpers stay and send the player's token |
| 8 | **Two releases**: A adds the new login with rules written but not enforced; B enforces rules and deletes the old credentials |
| 9 | The **load fix**: the app appears once, already as the signed-in player |

## Identity and data model

- **`players.user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL`** links a login to a player.
- **Linking an existing member:** a trigger on `auth.users` (insert/update) fires when `email_confirmed_at`
  becomes set, and links the login to the player whose `players.email` matches (case-insensitive),
  **only if that player is not linked yet and not archived**. No match → the login exists but is unlinked.
- **New members:** sign-up calls Supabase `signUp` with `name`, `dgu_number`, `handicap` in the user
  metadata. When the email is confirmed and no player matches, the same trigger **creates a pending
  player** (`approved=false`) from that metadata, with its `hcp_history` initialised as today. Admin
  approval is unchanged. The public key no longer needs to insert into `players`.
- **Emails:** `players.email` stays during the move-over as the matching key. At release B it is
  **dropped**; `auth.users.email` is the only copy. Admins read members' emails through
  `admin_member_emails()` (security definer, requires `is_admin()`).
- **Helpers** (schema `private`, not exposed through the API; `SECURITY DEFINER`, `STABLE`):
  - `private.current_player()` → the signed-in player's id, active (not archived) players only.
  - `private.is_member()` → the signed-in player is approved and not archived.
  - `private.is_admin()` → `is_member()` and `is_admin` **and** the session is two-factor verified
    (`auth.jwt()->>'aal' = 'aal2'`) **and** the TOTP verification is at most **12 hours** old (from the
    `amr` claim's timestamp).
- **Retired:** the admin PIN (`sl_admin_pin`) and its modal; PIN entry when switching player; at
  release B the Phase 0 PIN functions (`login`, `has_pin`, `check_pin`, `set_first_pin`,
  `admin_reset_pin`, `_check_pin`) and columns (`pin`, `pin_failures`, `pin_locked_until`), plus
  `players.legacy_id` and `reconcileStoredPlayer()`.

## Permission rules (Row Level Security)

Enforced at **release B**; written and tested at release A. `service_role` bypasses as usual.

| Table | Read | Insert / update | Delete |
|---|---|---|---|
| `players` | members: all rows; pending: own row | own profile fields; admins: all | nobody (archive instead) |
| `rounds` | members | members (group scoring); pending: own rows | own rounds; admins: any |
| `fines` | members | members | admins |
| `fine_types`, `fine_payments` | members | admins | admins |
| `saturday_signups` | members | own; admins: any | own; admins: any |
| `saturday_events` | members | only via `run_draw()`; admins directly | admins |
| `gps_shots` | own; admins | own | own |
| `tournaments`, `tournament_players`, `tournament_matches` | members | admins | admins |
| `tournament_scores` | members | members (score entry); admins | admins |
| `tees`, `green_polygons`, `fairway_polygons`, `fairway_spines`, `tee_strips`, `survey_points` | members | admins | admins |
| `audit_log` | admins | database only | database only (retention) |

- **"Own profile fields"** = `name, color, dgu_number, bag, hcp_history, handicap`. A trigger on
  `players` rejects a non-admin changing `is_admin, approved, is_social, archived_at, user_id` (or
  `email` while it exists) — with a clear error message. **During release A** the trigger judges
  only requests made with a login token; requests on the public key (the old PIN route, which has no
  token) pass unchanged, exactly as today, so admins who have not moved over can still approve and
  archive. Release B removes the public key's access, which closes that path.
- **Anon (logged out)** has no table access at release B; it can call only Supabase Auth.
- **`run_draw(p_date date)`** — the Friday-noon auto-draw moves into a `SECURITY DEFINER` function any
  member may call; it performs exactly the existing algorithm's writes (event lock + tee-time/group
  allocation) and nothing else. The algorithm stays in `index.html` (`chooseBestDraw`); the function
  receives the computed allocation and validates it (every signup for that date, no duplicates,
  event not already drawn) before writing.
- **Phase 0 column grants** on `players` are replaced by row rules; `PLAYER_COLS` loses the credential
  concerns (release B).

## Login flows (app)

- **Login screen:** email, password, **Forgot password?**; during the move-over also **First time on
  the new login? Set it up** and a small **Use my old PIN** link (removed at release B).
- **Set up new login (existing members):** email + new password ×2 → `signUp` → "Check your email" →
  confirmation link → linked → signed in. If no player matched: signed in, and shown "Your login
  isn't linked to a player yet — ask an admin." The request screen stays neutral.
- **Sign up (new members):** as today, with a password instead of a PIN; confirmation email; pending
  player created; existing pay and approval screens follow.
- **Forgot password:** email → neutral message ("If that address belongs to a member, a link is on its
  way") → link valid **1 hour, single use** (PKCE) → app opens **Choose a new password** → done.
- **Admin mode:** admins use the app as normal members. Opening the Admin tab, or tapping an admin
  action anywhere (★ Admin, Remove, Approve, "view as"), prompts: first time → enrol an authenticator
  (QR code) and verify; afterwards → enter the 6-digit code. Admin mode lasts **12 hours** on that
  device; the database enforces it via `is_admin()`.
- **Player picker** becomes admin-only **"view as"**, no PIN. Members see only their own profile.
- **Sign out** in My Profile. **Change my email** (own) via Supabase Auth → confirmation to the new address.
- **Loading:** check session → load data → resolve the player → render once → reveal. The login screen
  or a short "Loading…" stays up until then. No render happens as "nobody".
- **Session:** supabase-js persists the session (access token 1 hour, rotating refresh token with reuse
  detection). The data helpers send `Authorization: Bearer <access token>`; the `apikey` stays the
  project's public key.
- **Version gate:** release A → **3**; release B → **4**.

## Audit log

```
audit_log(id bigint identity, at timestamptz default now(), actor_player_id bigint FK SET NULL,
          action text, target_player_id bigint FK SET NULL, details jsonb)
```

- **Events:** `login`, `reset_requested`, `password_changed`, `email_changed`, `login_set_up`
  (linked), `mfa_enrolled`, `admin_mode_unlocked`, `admin_granted`, `admin_removed`, `approved`,
  `archived`, `restored`, `social_changed`, **`payment_recorded`, `payment_deleted`, `fine_deleted`**.
- **Sources:** triggers on `auth.users` (recovery sent, password/email change, sign-in, confirmation),
  on `auth.mfa_factors` / `auth.mfa_challenges` (enrolment, verification), on `players` (status
  fields), on `fine_payments` and `fines` (money trail). Nothing in the app writes to it.
- **Contents:** who, what, when, whom, and a short detail (e.g. `{"is_admin":[false,true]}`,
  `{"amount":250}`). **No IP addresses, device details, passwords or tokens.**
- **Retention:** each insert deletes entries older than **12 months** in the same statement's trigger —
  no scheduler (see CLAUDE.md, "a draw computed on demand has no scheduler to fail quietly").
- **Reading:** Admin tab → **Audit log** panel (admin mode), newest first, filter by player and event.
- **Admin move-over list:** Admin tab shows approved members **not yet linked** to a login.

## Rollout

### Release A — the new login arrives

1. **Dashboard settings (user):** Site URL and redirect URL = `https://gridsystems.github.io/RoyalGolfLeague/`;
   minimum password length 8; TOTP MFA enabled; refresh-token rotation on (default); confirmation
   and reset email wording. Custom SMTP via the league Gmail is **already configured**.
2. **SQL `phase2a_auth.sql`** (user runs, rehearsal mode as in Phase 1): `user_id`, helpers, link /
   new-member trigger, protected-field trigger, `audit_log` + all triggers + retention, `run_draw()`,
   `admin_member_emails()`, **all RLS policies created but with RLS permissive for anon** (existing
   `anon_all` policies stay), gate minimum 3.
3. **App** (push immediately after): new login flows, admin mode, audit panel, move-over list, load fix,
   `APP_VERSION=3` (and `course-mapper.html`).

### Release B — switch-off (when the move-over list is empty, or the admin decides)

1. **SQL `phase2b_enforce.sql`** (rehearsal first): drop `anon_all` policies, revoke anon table
   access, enable the Phase 2 policies for `authenticated`, drop `pin`, `pin_failures`,
   `pin_locked_until`, `email`, `legacy_id`, the Phase 0 PIN functions; gate minimum 4.
2. **App:** remove the PIN route, `reconcileStoredPlayer`, `legacy_id` from `PLAYER_COLS`;
   `APP_VERSION=4`.

## Testing

- **RLS matrix (PGlite):** stand-in `auth` schema (`auth.users`, `auth.uid()`, `auth.jwt()` reading
  `request.jwt.claims`). For every table: **anon, pending, member, admin without aal2, admin with
  fresh aal2, admin with aal2 older than 12 h** × read / insert / update / delete — asserting both
  allowed and refused.
- **Triggers:** link on confirmation (match, no match, already linked, archived); new-member creation;
  protected fields refused for members, allowed for admins; every audit event; 12-month trim;
  `run_draw()` validation.
- **App (headless, supabase-js stubbed):** every login flow, admin-mode prompt and expiry, neutral
  messages, audit panel, move-over list, and **"appears once, already as you"** (no render before the
  player is resolved).
- **Rehearsal on production** for each SQL release, as in Phase 1.
- **Live, real accounts:** the user's own login and move-over; a forgot-password email actually
  arriving via the league Gmail; the user's TOTP enrolment; one throwaway test member (deleted after).
- **Before/after leaderboard render:** no change for members.

## Timing and size

Release A after the Summer final (3 October 2026), so Winter 2027 starts on the new login. Release B
when the move-over list is empty. Release A is roughly 2–3 days of work; the plan gives the
task-by-task estimate.

## To verify during planning (facts about Supabase, not design choices)

- Triggers on `auth.users`, `auth.mfa_factors`, `auth.mfa_challenges` are permitted on this project,
  and which columns change on recovery-sent / sign-in / password change (`recovery_sent_at`,
  `last_sign_in_at`, `encrypted_password`).
- The exact `amr` claim shape for TOTP (method and timestamp) used for the 12-hour check.
- Whether the project's plan offers leaked-password protection (only enabled if free).
- supabase-js version to pin, and its PKCE recovery flow with a GitHub Pages redirect.

## Out of scope

GDPR export / erasure, privacy notice, retention for leavers, self-hosted fonts, GPS consent,
early-tee reason choices (Phase 3).
