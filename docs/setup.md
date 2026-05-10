# Seneca — Setup Guide

A from-zero guide to getting Seneca running.

There are two modes:

- **Dev-bypass mode (recommended while you're hacking).** Skips Supabase entirely. You only need an Anthropic API key. Sessions live in memory and reset when the API restarts.
- **Real-auth mode.** Email/password login through Supabase, sessions persisted to Postgres. This is what you'll deploy.

---

## 1. Install Node.js and pnpm

You need Node 20+ and pnpm 11+.

```bash
# Install pnpm (no sudo required)
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Reload your shell so the `pnpm` command works
source ~/.zshrc

# Use pnpm to install Node.js LTS
pnpm env use --global lts

# Verify
node --version    # v20+
pnpm --version    # 11+
```

---

## 2. Dev-bypass mode (5 minutes, no Supabase needed)

### 2.1 Get an Anthropic API key

1. Go to https://console.anthropic.com and sign up.
2. Add a payment method and load **$20** of credit (Settings → Plans & Billing).
3. Settings → API Keys → **Create Key**. Name it `seneca-dev`.
4. **Copy the key** (starts with `sk-ant-`); you won't be able to see it again.

### 2.2 Create the `.env` files

If they don't already exist:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

Both files default to bypass mode. Open `apps/api/.env` and paste your Anthropic key into `ANTHROPIC_API_KEY`. That's it — no Supabase values needed.

### 2.3 Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. You should land straight in the app with a "Dev mode" badge in the header, no login screen, and a green "API connected" dot.

> Note: in bypass mode, transcripts and whiteboard contents live in memory. They reset whenever you restart the API. Real persistence comes with mode 3.

---

## 3. Real-auth mode (for deploying or testing real login)

### 3.1 Create a Supabase project

1. Go to https://supabase.com and sign up with GitHub.
2. Click **New project**. Org: your personal one. Name: `seneca`. Pick a strong DB password and **save it**. Region: closest to you.
3. Wait ~2 minutes for provisioning.
4. Go to **Project Settings → API**. Save:
   - **Project URL** → `SUPABASE_URL` and `VITE_SUPABASE_URL`
   - **`anon` public key** → `VITE_SUPABASE_ANON_KEY`
   - **`service_role` key** → `SUPABASE_SERVICE_ROLE_KEY` *(server only)*
5. In the **SQL Editor**, run the schema:

   ```sql
   create table if not exists sessions (
     id uuid primary key default gen_random_uuid(),
     user_id uuid references auth.users not null,
     name text not null default 'Untitled',
     transcript jsonb not null default '[]'::jsonb,
     whiteboard jsonb not null default '{}'::jsonb,
     created_at timestamptz default now(),
     updated_at timestamptz default now()
   );

   alter table sessions enable row level security;

   create policy "owner can read"
     on sessions for select
     using (auth.uid() = user_id);

   create policy "owner can insert"
     on sessions for insert
     with check (auth.uid() = user_id);

   create policy "owner can update"
     on sessions for update
     using (auth.uid() = user_id)
     with check (auth.uid() = user_id);

   create policy "owner can delete"
     on sessions for delete
     using (auth.uid() = user_id);

   create or replace function touch_sessions_updated_at()
   returns trigger language plpgsql as $$
   begin
     new.updated_at = now();
     return new;
   end;
   $$;

   drop trigger if exists trg_touch_sessions on sessions;
   create trigger trg_touch_sessions
     before update on sessions
     for each row execute function touch_sessions_updated_at();
   ```

6. Go to **Authentication → Sign In / Up** and turn **off** "Confirm email" for easy local testing. You can re-enable it before going public.

### 3.2 Switch the `.env` files out of bypass

Open `apps/api/.env` and change:

```
DEV_BYPASS_AUTH=false
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

Open `apps/web/.env` and change:

```
VITE_DEV_BYPASS_AUTH=false
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Restart `pnpm dev`. You'll now see the sign-up / sign-in screen.

---

## 4. Deploy to Vercel + Railway

Always deploy in real-auth mode — never set `DEV_BYPASS_AUTH=true` on a public URL. That flag disables every security check.

### 4.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial Seneca scaffold"
# Create an empty repo at github.com/<you>/seneca, then:
git remote add origin git@github.com:<you>/seneca.git
git branch -M main
git push -u origin main
```

### 4.2 Deploy backend to Railway

1. Railway dashboard → **New Project → Deploy from GitHub repo → seneca**.
2. **Root Directory** = `apps/api`.
3. Under **Settings → Build**:
   - **Build Command**: `pnpm install --frozen-lockfile && pnpm --filter @seneca/shared build && pnpm --filter @seneca/api build`
   - **Start Command**: `pnpm --filter @seneca/api start`
   - **Watch Paths**: `apps/api/**`, `packages/shared/**`.
4. Under **Variables**, add:
   - `PORT=8787`
   - `WEB_ORIGIN=https://YOUR-WEB-DOMAIN.vercel.app` (come back and set this after 4.3)
   - `DEV_BYPASS_AUTH=false`
   - `ANTHROPIC_API_KEY=...`
   - `SUPABASE_URL=...`
   - `SUPABASE_ANON_KEY=...`
   - `SUPABASE_SERVICE_ROLE_KEY=...`
5. **Settings → Networking → Generate Domain**. Save the URL.

### 4.3 Deploy frontend to Vercel

1. Vercel → **Add New → Project → import the GitHub repo**.
2. **Framework**: Vite. **Root Directory**: `apps/web`.
3. **Build Command**: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @seneca/shared build && pnpm --filter @seneca/web build`
4. **Output Directory**: `dist`
5. Under **Environment Variables**:
   - `VITE_DEV_BYPASS_AUTH=false`
   - `VITE_SUPABASE_URL=...`
   - `VITE_SUPABASE_ANON_KEY=...`
   - `VITE_API_BASE_URL=https://YOUR-RAILWAY-DOMAIN`
6. Deploy. Once Vercel gives you a URL, go back to Railway and set `WEB_ORIGIN` to it. Redeploy the API.

---

## Troubleshooting

- **Login page shows in dev mode**: confirm both `DEV_BYPASS_AUTH=true` (API) and `VITE_DEV_BYPASS_AUTH=true` (web), then restart `pnpm dev` so Vite re-reads the env.
- **"API unreachable" dot**: confirm `apps/api/.env` has a valid `ANTHROPIC_API_KEY` (it's the only required value in bypass mode) and that the API printed its listening line.
- **CORS errors**: confirm `WEB_ORIGIN` exactly matches the browser's origin, no trailing slash.
- **`auth.users` not found in SQL editor**: wait for Supabase provisioning to finish, then re-run.
- **No microphone**: site must be HTTPS or localhost. The Vercel URL is HTTPS by default.
- **Opus access denied**: set `ANTHROPIC_VISION_MODEL=claude-sonnet-4-6` in `apps/api/.env`.
