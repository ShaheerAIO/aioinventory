# Microsoft Entra ID sign-in — setup

The app signs in with Microsoft Entra ID through the Firebase Auth `microsoft.com`
OAuth provider. Roles still live in the Firestore `users/<uid>` doc, so nothing
downstream of sign-in changed.

The code is in place; the four console steps below are what turn it on. **Do steps
1–4 before deploying** — until the provider exists, the Sign in with Microsoft
button fails for everyone.

---

## 1. Register the app in Entra

Azure portal → **Microsoft Entra ID** → **App registrations** → **New registration**

| Field | Value |
| --- | --- |
| Name | `AIO Inventory` |
| Supported account types | **Accounts in this organizational directory only (Single tenant)** |
| Redirect URI | **Web** → `https://aio-inventory-b9b29.firebaseapp.com/__/auth/handler` |

After it's created, from the **Overview** page copy:

- **Application (client) ID**
- **Directory (tenant) ID** ← this is the one that goes in `js/auth.js`

Then **Certificates & secrets** → **New client secret** → copy the **Value**
(not the Secret ID — the value is only shown once).

Then **API permissions** → confirm `User.Read` is listed, add `email`, `openid` and
`profile` if they aren't, and click **Grant admin consent for AIO** so staff don't
each get a consent prompt on first sign-in.

> Single tenant + the `tenant` parameter the app sends means only accounts in the
> AIO directory can complete sign-in. Anyone in the tenant can — including Entra
> guest/B2B accounts — and they arrive as View only.

## 2. Enable the provider in Firebase

Firebase console → **Authentication** → **Sign-in method** → **Add new provider** →
**Microsoft**

- Enable it
- **Application ID** → the client ID from step 1
- **Application secret** → the secret value from step 1
- Check that the callback URL shown matches the redirect URI you set in step 1

While you're on that screen, **disable Email/Password**? — no. Leave it enabled:
it's what the break-glass admin login uses (see below).

## 3. Turn on account linking — important

Firebase console → **Authentication** → **Settings** → **User account linking** →
**Link accounts that use the same email**

This is what makes the migration invisible. When an existing user signs in with
Microsoft for the first time, Firebase links the Microsoft credential onto their
existing account rather than making a second one, so **their uid is preserved** and
their `users/<uid>` profile — name, role, history — is found untouched.

If this is left on "Create multiple accounts for each identity provider", first
sign-ins come back with a brand new uid. The app handles that too (it looks for a
profile with the same email and joins it onto the new uid, tagging the old one
`migratedTo`), but linking is the cleaner path and keeps the break-glass account
working as one account with two sign-in methods.

## 4. Authorise the site domain

Firebase console → **Authentication** → **Settings** → **Authorized domains** → add:

```
aioinventory.vercel.app
```

Host only — no scheme, no path. Without it every sign-in fails with
`auth/unauthorized-domain`.

> **The app is deployed on Vercel** (project `aioinventory` under the `aioapp1`
> team), built automatically from pushes to `main`. A stale GitHub Pages site also
> still builds from this repo at `shaheeraio.github.io/aioinventory`, and
> `shaheeraio.github.io` is currently still in the authorised-domains list — so it
> is a second, working front door to the same data. Turn Pages off in the repo
> settings, or drop that domain from the list.

Vercel preview deployments get their own hostnames
(`aioinventory-<hash>-aioapp1.vercel.app`), and each one is a separate origin as far
as Firebase is concerned. Sign-in will not work on a preview URL unless that exact
host is added too. Test on the production URL.

## 5. Paste the tenant ID into the code

`js/auth.js`, near the top:

```js
const ENTRA_TENANT_ID = 'REPLACE_WITH_ENTRA_TENANT_ID';
```

Replace with the **Directory (tenant) ID** from step 1, then bump `auth.js`'s
`?v=` query string in `index.html` and push.

## 6. Firestore rules

The complete ruleset lives in **`firestore.rules`** in this repo. It covers every
path the app touches — `inventory/main`, `inventory/movements`, `audits/{auditId}`
and `users/{uid}` — so it can be pasted into Firebase console → **Firestore Database**
→ **Rules** as-is, replacing what's there.

It is also wired into `firebase.json`, so it can be published from the CLI instead:

```bash
firebase deploy --only firestore:rules --dry-run   # compile check, publishes nothing
firebase deploy --only firestore:rules             # publish
```

What the rules enforce:

- **Read** — anything signed in can read inventory, audits and the user list. The
  user list has to stay readable by everyone, not just admins: the servicing
  screen's "tested by" dropdown reads it.
- **Write to inventory and audits** — editors and admins only.
- **`pendingUsers`** — writing that map is effectively granting a role, so it is
  admin-only. The single exception is a new user clearing their own entry as they
  consume it on first sign-in.
- **Profiles** — a user may create only their own, carrying their own email, and
  only at View only unless an admin pre-assigned a higher role or they are
  inheriting one from an older profile bearing the same email. Role changes,
  removal and reactivation are admin-only.

Without the create rule, first-time sign-ins can't write their own profile. Without
the constraints on it, anyone in the tenant could write `role: 'admin'` onto their
own profile straight from the browser console.

---

## Break-glass admin login

Keep **one** admin on email/password as a way back in if the Entra or Firebase
provider config ever breaks. It is not linked or advertised anywhere in the UI:

```
https://<the app URL>/?signin=fallback
```

That URL renders the old email + password form under the Microsoft button.
Everywhere else, password sign-in is gone — there is no password form, no
"forgot password", and the admin panel can no longer create accounts with
temporary passwords or send reset emails.

**Remove the password from every other account.** The unlisted URL hides the form,
it doesn't disable password sign-in. In the Firebase console → Authentication →
Users, open each account other than the break-glass one and delete its password
provider, or delete and let them re-register via Microsoft. Until you do, anyone who
knows their old password and the `?signin=fallback` URL can still get in that way.

To reset the break-glass password, use the Firebase console (Users → ⋯ → Reset
password) — the in-app reset UI is gone.

---

## How a sign-in resolves to a role

1. `users/<uid>` already exists → that profile is used. This is every existing user
   once step 3 is on, and everyone from their second sign-in onwards.
2. No profile for this uid, but another profile carries the same email → its name and
   role are copied onto the new uid and the old doc is tagged `migratedTo` so the
   person isn't listed twice. This is the lazy join.
3. An admin pre-assigned a role to that email in **Manage users → Pre-assign a role**
   → they arrive with that role and the pending entry is consumed.
4. Otherwise → a new **View only** profile, using their Entra display name.

A profile marked `deleted` is refused at step 1 or 2 and bounced back to the login
screen, so removing someone still keeps them out.
