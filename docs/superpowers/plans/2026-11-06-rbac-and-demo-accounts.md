# Implementation Plan: RBAC Roles & Multi-Account Management Fix

## Goal Description
Fix the Role-Based Access Control (RBAC) and demo account isolation issues in Settl.ai.
Currently:
1. **Hardcoded Single Accounts**: The session cookie (`settl_demo`) only stored `"buyer"` or `"provider"`, causing the server (`api-auth.ts`, `dashboard.ts`) to hardcode all buyers to Juan (`juan@example.com` / `org_juan`) and all providers to Mara (`mara@example.com` / `org_resibo`).
2. **Cannot Sign In as Other Accounts**: The database already has `geoph@example.com` (GeoPH), but `/login` rejected any email other than `mara@example.com` and `juan@example.com`. Users could not log in as GeoPH, nor could they manage endpoints or agents for separate buyer or provider organizations.
3. **Leaky Role Routing & Broken Switching**: In `AppShell`, clicking "Buyer console" while logged in as a provider left the cookie as `settl_demo=provider`. When the user landed on `/buyer`, `loadBuyerDashboard()` rejected the cookie, resulting in "Dashboard unavailable" and 401 `buyer_auth_required` errors when attempting to create agents or manage endpoints.
4. **Endpoint Creation Origin Restriction**: When adding an endpoint on `/provider/endpoints`, the form placeholder suggested `https://api.example.com`, but the server strictly rejected any origin not in `SETTL_PROVIDER_ALLOWED_ORIGINS`, surfacing an unhelpful error.

This plan addresses all four issues, providing true multi-account RBAC, seamless 1-click workspace switching, dynamic account resolution, and full multi-tenant endpoint and agent management.

---

## Cookie Format & Session Resolution Contract

To avoid breaking any existing unit tests that expect `settl_demo=buyer` or `settl_demo=provider`, the session resolver is 100% backward-compatible:
- `settl_demo=buyer` -> resolves to `juan@example.com` (`org_juan`, role `buyer`).
- `settl_demo=provider` -> resolves to `mara@example.com` (`org_resibo`, role `provider`).
- `settl_demo=<email>`: If email matches an account in `DEMO_ACCOUNTS`, resolves to its email and role.
- `settl_demo=<role>:<email>` (e.g. `buyer:acme@example.com`, `provider:custom@example.com`): Allows synchronous role derivation in `proxy.ts` for arbitrary DB emails without synchronous database queries; server-side auth independently queries DB and enforces role.

---

## 4 Pre-Configured Demo Accounts in `DEMO_ACCOUNTS`:
1. **Mara Santos** (`mara@example.com`, org: `ResiboAI`, role: `provider`, home: `/provider`, initials: `MS`)
2. **GeoPH Team** (`geoph@example.com`, org: `GeoPH`, role: `provider`, home: `/provider`, initials: `GP`)
3. **Juan dela Cruz** (`juan@example.com`, org: `Juan’s Accounting`, role: `buyer`, home: `/buyer`, initials: `JC`)
4. **Carlos Mendez** (`acme@example.com`, org: `Acme AI Corp`, role: `buyer`, home: `/buyer`, initials: `CM`)

---

## Detailed File Changes:

1. `apps/web/lib/auth.ts`:
   - Expand `DEMO_ACCOUNTS` with the 4 accounts above.
   - Export `resolveSession(cookieValue: string | undefined): { email: string; role: Role } | null`:
     - Handles `"buyer"` -> `{ email: "juan@example.com", role: "buyer" }`
     - Handles `"provider"` -> `{ email: "mara@example.com", role: "provider" }`
     - Handles `<role>:<email>` -> `{ email: email.toLowerCase(), role }`
     - Handles `<email>` matching `DEMO_ACCOUNTS` -> `{ email, role }`
   - Export `accountFor(role: Role)` (returns default for role) and `accountForEmail(email: string)`.

2. `apps/web/app/login/actions.ts`:
   - In `signIn`: set `SESSION_COOKIE` to `${account.role}:${account.email}` (or `account.email`). Support known demo accounts or existing DB orgs.
   - Export `switchWorkspace(email: string)` server action: sets `SESSION_COOKIE` and redirects to the target workspace home.

3. `apps/web/lib/server/api-auth.ts`:
   - In `requireWorkspaceOrg(request: Request, role: Role)`:
     - Resolve session via `resolveSession(cookie)`.
     - Look up `db.org.findUnique({ where: { email: session.email }, select: { id: true, role: true } })`.
     - Verify `org.role === role`. If mismatch/missing, throw `ApiError(401, `${role}_auth_required`)`.
     - Return `{ orgId: org.id }`.

4. `apps/web/lib/server/dashboard.ts`:
   - `loadProviderDashboard()`: verify `session.role === "provider"`, load data for `session.email`.
   - `loadBuyerDashboard()`: verify `session.role === "buyer"`, load data for `session.email`.

5. `apps/web/proxy.ts`:
   - Synchronous role check via `resolveSession(cookie)`.
   - Redirect cross-role visits (e.g. buyer visiting `/provider` -> `/buyer`; provider visiting `/buyer` -> `/provider`).
   - Missing session -> redirect to `/login?next=...`.

6. `apps/web/components/app-shell.tsx`:
   - Replace static "Other views" link with a clean Workspace Switcher:
     - Displays current active workspace name & role.
     - Lists other available workspaces with buttons calling `switchWorkspace(email)`.

7. `apps/web/components/login-form.tsx`:
   - Display all 4 demo workspaces in the selector.

8. `apps/web/components/provider/endpoint-tools.tsx`:
   - Set URL placeholder in `AddRouteForm` to `http://localhost:3001/parse-receipt` with clear allowed-origin guidance.

9. `apps/web/prisma/seed.ts`:
   - Add seed record for `org_acme` (`acme@example.com`, Acme AI Corp, `role: "buyer"`) with encrypted wallet.

10. Unit Tests:
    - Update `apps/web/lib/server/buyer-auth.test.ts` to test multi-account resolution, backward compatibility with `"settl_demo=buyer"`, and role isolation.
