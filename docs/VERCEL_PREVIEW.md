# A private Vercel preview

> **What this is.** A password-walled preview of the terminal so the CEO can
> follow progress. It is **not** the Phase 6 launch: the database is `sfi-dev`,
> the metric library is interim and unreviewed, and nothing on it is fit to show
> a customer. Vercel is used as a host and nothing else — no Vercel-specific
> services — so hosting can move later without a rewrite, per
> `SFI_ARCHITECTURE_V2.md` §4.
>
> **Nobody has deployed this.** The repository is imported by the technical lead;
> this document is the configuration that import needs.

---

## 1. Before importing

| Thing | Value |
|---|---|
| Framework preset | Next.js (detected) |
| Node version | **24.x or newer** — `package.json` sets `engines.node >= 24.6.0` |
| Build command | `npm run build` (the default) |
| Root directory | the repository root |
| Supabase project | `sfi-dev`. **Not** a production project |

Nothing in the build needs a database connection: `npm run build` compiles with
no network access, and every page is server-rendered on demand.

---

## 2. Environment variables

Four variables, and one optional switch. Set them for the **Preview**
environment; add **Production** too if a branch is aliased as production.

| Name | Value | Where it is read | Public? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the `sfi-dev` API URL, `https://<ref>.supabase.co` | browser and server; also feeds the Content-Security-Policy so the browser may reach Supabase at all | **Yes, by design** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key | browser and server, for the signed-in session | **Yes, by design** |
| `NEXT_PUBLIC_APP_URL` | the preview's own origin, e.g. `https://samuel-terminal-git-main-<team>.vercel.app` | links that must be absolute | Yes |
| `SUPABASE_SECRET_KEY` | the `sb_secret_…` key | **server only** — the desk's server actions call database functions with it | **No. Never.** |
| `SFI_EXTRACTION_DISABLED` | `1` | the extraction adapter's kill switch | No |

### Which must never carry a `NEXT_PUBLIC_` prefix

**`SUPABASE_SECRET_KEY`.** Anything prefixed `NEXT_PUBLIC_` is inlined into the
JavaScript the browser downloads. A secret key there is not "leaked later" — it
is published the moment the build finishes, it bypasses every row-level security
policy in this platform, and rotating it is the only remedy. There is no
situation in which this variable is renamed.

The same holds for anything added later: an API key, a licence credential, an
LLM token, a payment secret. The rule in `AGENTS.md` that every provider keeps
its credentials behind an adapter is the same rule as this one.

### What must not be set on Vercel at all

- **`SUPABASE_DB_URL`.** It is a direct Postgres superuser-grade connection
  string, used only by `supabase` CLI commands on a developer's machine. The
  application never reads it. On a host it is a standing invitation.
- **Anything from a production project.** The preview reads `sfi-dev`.

### Two timing details worth knowing

- `NEXT_PUBLIC_*` values are **baked in at build time**. Changing one requires a
  redeploy, not just a restart.
- `SUPABASE_SECRET_KEY` is read **at request time**, so it can be added or
  rotated without rebuilding.

### Setting them

Either the dashboard (Project → Settings → Environment Variables) or, from a
machine with the CLI linked to the project:

```bash
vercel env add SUPABASE_SECRET_KEY preview     # prompts; the value is not echoed
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview
vercel env add NEXT_PUBLIC_APP_URL preview
vercel env add SFI_EXTRACTION_DISABLED preview
```

Mark `SUPABASE_SECRET_KEY` **Sensitive** so the dashboard will not display it
again after saving.

---

## 3. Supabase Auth redirect URLs

Sign-in links and password resets return the reader to this application, and
Supabase refuses any return address not on its list. In the Supabase dashboard,
**Authentication → URL Configuration**:

**Site URL**

```
https://samuel-terminal-git-main-<team>.vercel.app
```

Use the **branch alias**, not a per-deployment URL. Every deployment also gets
its own random hostname; the branch alias is stable, so it is the one worth
making authoritative.

**Redirect URLs** — add all of these:

```
https://samuel-terminal-git-main-<team>.vercel.app/auth/callback
https://samuel-terminal-git-main-<team>.vercel.app/reset-password
http://localhost:3000/auth/callback
http://localhost:3000/reset-password
```

The two paths are the only ones Supabase ever returns to:
`app/auth/callback/route.ts` exchanges the code for a session, and
`/reset-password` completes a reset.

If links must work from *any* preview deployment, add one wildcard as well:

```
https://samuel-terminal-*-<team>.vercel.app/**
```

Keep that in mind rather than reaching for it: a wildcard widens the set of
addresses Supabase will hand a session to, and the branch alias covers the CEO's
use. `supabase/config.toml` configures the **local** stack only; the hosted
project is configured in the dashboard.

---

## 4. Deployment Protection

The application has its own login, and the terminal redirects an anonymous
visitor to `/login`. Deployment Protection is the second wall: it stops the
preview being read, indexed or probed by anyone who finds the URL, including on
routes that have not been written yet.

**Project → Settings → Deployment Protection.**

1. **Vercel Authentication** → set to **Standard Protection** (all deployments,
   including any production alias). A visitor must be signed in to Vercel and a
   member of the team. Included on every plan.
2. If the CEO should not need a Vercel account, use **Password Protection**
   instead, set to **All Deployments** — one shared password, which is enough for
   a progress preview and is a paid feature on some plans.
3. Leave **Protection Bypass for Automation** off. Turn it on only if CI must
   reach the preview, and treat the token it generates as a secret.
4. Check **Settings → Deployment Protection → OPTIONS Allowlist** stays empty.

After the first deploy, confirm it worked: open the preview URL in a browser
where you are signed out of Vercel. You should meet Vercel's wall, not the SFI
login page.

---

## 5. What the CEO should be told

- The data is `sfi-dev`: whatever is on it, and nothing more. A company page with
  no figures means nobody has entered them, not that the company reported none.
- **The metric library is interim.** No economist has reviewed the formulas, and
  a formula nobody has approved publishes nothing — several ratios will read
  "Awaiting approval" by design. `/methodology` lists every formula, its version
  and who approved it.
- No share prices, no valuation ratios, no market data: those wait on a licence
  from the Nigerian Exchange.
- It is a preview. Links are not permanent, and the deployment can be deleted
  without ceremony.

---

## 6. Checklist

- [ ] Repository imported; Node 24.x or newer selected
- [ ] Four environment variables set for Preview (and Production if aliased)
- [ ] `SUPABASE_SECRET_KEY` marked Sensitive and **not** prefixed `NEXT_PUBLIC_`
- [ ] `SUPABASE_DB_URL` **not** present in any Vercel environment
- [ ] `SFI_EXTRACTION_DISABLED=1` set
- [ ] Supabase Site URL set to the branch alias
- [ ] `/auth/callback` and `/reset-password` added for the alias and for localhost
- [ ] Deployment Protection on, set to all deployments
- [ ] Signed out of Vercel, the preview URL shows Vercel's wall
- [ ] Signed in, `/login` works and the terminal loads
