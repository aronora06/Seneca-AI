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

## 2.5 Optional: enable web search (Tavily)

The Web tab works without this — Seneca can still navigate to URLs you (or he) already know — but `web_search` will return a friendly "configure Tavily" error until you add a key.

1. Go to https://app.tavily.com and sign up. Free tier is generous (1,000 searches/month at the time of writing).
2. From the dashboard, copy your API key (starts with `tvly-`).
3. Open `apps/api/.env` and add:

   ```
   TAVILY_API_KEY=tvly-...
   ```

4. Restart `pnpm dev` (or just the API) so the new env value is picked up.

Test it: open the Web tab and ask Seneca *"Find me a portrait of Spinoza."* You should see a card list of results overlaid on the page area, each clickable to navigate.

---

## 2.6 Optional: enable semantic document search (Voyage AI)

`document_search` works without this — it falls back to a naive case-insensitive substring scan over each page's extracted text — but a 400-page PDF whose phrasing doesn't match the user's query verbatim will miss most of the relevant pages. Adding a Voyage AI key flips on cosine-similarity top-k retrieval over chunked embeddings instead.

1. Go to https://www.voyageai.com/ and sign up. You can run a small dev workload entirely on Voyage's free tier (~$0 the first month).
2. From the dashboard's API Keys page, copy your key (starts with `pa-`).
3. Open `apps/api/.env` and add:

   ```
   VOYAGE_API_KEY=pa-...
   # Optional — defaults to voyage-3-large (1024-dim, best quality). Swap
   # to voyage-3-lite for a cheaper model with shorter embeddings if you
   # want; the chunk store column type assumes 1024 dims though, so
   # changing the dim requires changing the migration too.
   VOYAGE_MODEL=voyage-3-large
   ```

4. Restart `pnpm dev` so the API picks up the key. The boot log will print all tools loaded; document upload will additionally print `indexed N chunks in Xms` when each PDF lands.

Test it: upload a multi-page paper and ask Seneca *"Where does the author discuss X?"* using a phrase that's not literally in the doc. With Voyage on, he'll find the relevant page semantically. Without Voyage, he'd only hit if the literal phrase appears.

> Dev-bypass mode: chunks + embeddings live in a process-local map; brute-force cosine on every query. Fine for the few-thousand chunks a dev session holds.
>
> Real-auth mode: chunks live in a `pgvector`-backed Postgres table with an `ivfflat` index; see §3.1 step 6.5 below for the migration. Skip the table creation if `VOYAGE_API_KEY` is empty — search degrades gracefully to substring without it.

## 2.7 Optional: enable premium voice (ElevenLabs)

Browser-native `SpeechSynthesisUtterance` works out of the box and is fine for most users — but quality varies wildly across operating systems (on Linux and many Chromebooks it's barely usable). Adding an ElevenLabs key flips Seneca onto streaming neural voices with sub-second time-to-first-byte.

1. Go to https://elevenlabs.io/ and sign up. The **Free** tier gives you 10,000 characters per month (≈ 8 minutes of audio) — enough for casual dev. The **Starter** plan is $5/mo for ~30,000 characters.
2. In your ElevenLabs dashboard, open **Profile → API key** and copy the value.
3. Put it in `apps/api/.env`:

   ```bash
   ELEVENLABS_API_KEY=sk_...
   # Optional: pick a default voice from https://elevenlabs.io/app/voice-library.
   # Leave empty to use the curated set bundled with Seneca; the user can
   # pick a voice from Settings → Voice & Audio on first run.
   # ELEVENLABS_DEFAULT_VOICE_ID=
   # Optional: stick with eleven_turbo_v2_5 unless you understand the
   # latency/quality trade-off — it's the only model that streams in
   # ~300ms TTFB at decent quality.
   # ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
   ```

4. Restart `pnpm dev`. On the next boot the API logs the route list including `/api/tts`; the web client probes `/api/tts/config` once on mount and switches to the premium engine automatically.

Test it: open Settings → Voice & Audio. You should see a new "Voice engine" toggle defaulting to **Premium (auto)** and a "Premium voice" picker with six curated voices. Click "Preview" on any voice to hear ~3 seconds of sample audio. The voice pane now shows a small **Premium** badge during playback.

Without the key, `/api/tts/config` reports `available: false`, the picker stays hidden, and the existing browser-TTS path keeps working — same graceful-fallback pattern Voyage and Tavily already follow.

> Cost telemetry: ElevenLabs bills per character. The web client tracks usage in the session's `usage.ttsCharacters` and `usage.ttsCostUSD` fields and the cost pill tooltip shows the running TTS spend alongside Anthropic.

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
     map jsonb not null default
       '{"center":[20,0],"zoom":2,"layer":"standard","pins":[],"shapes":[]}'::jsonb,
     web jsonb not null default
       '{"url":null,"history":[],"historyIndex":-1}'::jsonb,
     documents jsonb not null default
       '{"items":[],"activeId":null}'::jsonb,
     -- Phase 4 cost telemetry. Nullable; the API lazily populates it on
     -- the first turn that completes after the migration runs.
     usage jsonb,
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

6. Still in the **SQL Editor**, create the `document_pages` table that backs server-side text extraction (Priority 1a — used by the `document_read_page` tool so Seneca can read PDFs without burning vision tokens):

   ```sql
   create table if not exists document_pages (
     id uuid primary key default gen_random_uuid(),
     doc_id uuid not null,
     -- Phase 3 / Priority 2: denormalised `session_id` so the session
     -- delete cascade can wipe orphan rows (e.g. crashed uploads not
     -- yet in `sessions.documents.items`) in a single statement.
     session_id uuid,
     page int not null,
     text text not null default '',
     char_count int not null default 0,
     created_at timestamptz default now(),
     unique (doc_id, page)
   );

   create index if not exists document_pages_doc_id_idx on document_pages (doc_id);

   alter table document_pages enable row level security;

   -- The Seneca API writes / reads through the service-role key (which
   -- bypasses RLS), but these policies are belt-and-braces in case anyone
   -- ever accesses the table directly with a user JWT. Ownership is
   -- enforced via the join to sessions.user_id — a page row belongs to
   -- whoever owns its session, which we look up via the doc_id stored
   -- inside `sessions.documents` JSONB.
   create policy "owner can read own document pages"
     on document_pages for select
     to authenticated
     using (
       exists (
         select 1 from sessions
         where sessions.user_id = auth.uid()
           and sessions.documents -> 'items' @> jsonb_build_array(
             jsonb_build_object('id', document_pages.doc_id::text)
           )
       )
     );
   ```

   We don't add insert / update / delete policies because only the
   service role ever writes here. Locking them out keeps the surface
   small.

6.5. **(Optional but recommended)** Still in the **SQL Editor**, enable `pgvector` and create the `document_chunks` table that backs semantic search (Priority 1b — used by the `document_search` tool when `VOYAGE_API_KEY` is set). Skip this block if you didn't set up Voyage in §2.6 — search will degrade to substring without it, which still works:

   ```sql
   -- pgvector extension. Idempotent. Lives in the `extensions` schema
   -- by default; Supabase will auto-grant the API roles access.
   create extension if not exists vector;

   create table if not exists document_chunks (
     id uuid primary key default gen_random_uuid(),
     doc_id uuid not null,
     -- Phase 3 / Priority 2: denormalised `session_id` so the session
     -- delete cascade can wipe orphan rows in a single statement.
     session_id uuid,
     page int not null,
     chunk_index int not null,
     text text not null,
     -- 1024 dims matches Voyage's voyage-3-large default. If you change
     -- VOYAGE_MODEL to a model with a different output dim, change this
     -- column type and rebuild the index.
     embedding vector(1024) not null,
     created_at timestamptz default now()
   );

   -- ivfflat with cosine ops is the recommended index for ANN search
   -- under pgvector. The list count is a tuning knob; 100 is a sensible
   -- default for up to ~1M chunks.
   create index if not exists document_chunks_embedding_idx
     on document_chunks
     using ivfflat (embedding vector_cosine_ops)
     with (lists = 100);

   create index if not exists document_chunks_doc_id_idx
     on document_chunks (doc_id);

   alter table document_chunks enable row level security;

   -- Same join-through-sessions pattern as document_pages.
   create policy "owner can read own document chunks"
     on document_chunks for select
     to authenticated
     using (
       exists (
         select 1 from sessions
         where sessions.user_id = auth.uid()
           and sessions.documents -> 'items' @> jsonb_build_array(
             jsonb_build_object('id', document_chunks.doc_id::text)
           )
       )
     );

   -- RPC for cosine top-k. The JS client can't express `<=>` through
   -- postgrest, so we tunnel the math through a security-definer
   -- function. `match_doc_id` is optional — pass null to search every
   -- chunk the caller can see.
   create or replace function match_document_chunks(
     query_embedding vector(1024),
     match_doc_id uuid,
     match_count int
   )
   returns table (
     doc_id uuid,
     page int,
     chunk_index int,
     text text,
     score float4
   )
   language sql stable security definer
   as $$
     select
       dc.doc_id,
       dc.page,
       dc.chunk_index,
       dc.text,
       -- pgvector's <=> returns cosine *distance* in [0, 2]. Convert to
       -- normalised similarity in [0, 1] matching cosineSimilarity().
       (1 - (dc.embedding <=> query_embedding) / 2)::float4 as score
     from document_chunks dc
     where match_doc_id is null or dc.doc_id = match_doc_id
     order by dc.embedding <=> query_embedding
     limit match_count
   $$;

   grant execute on function match_document_chunks(vector(1024), uuid, int)
     to authenticated, service_role;
   ```

   Reuse the same belt-and-braces RLS shape as `document_pages` — only the service role writes, and the policy on read is for hypothetical direct-from-client access.

7. Still in the **SQL Editor**, create the private Storage bucket and access policies for uploaded PDFs:

   ```sql
   insert into storage.buckets (id, name, public)
   values ('seneca-documents', 'seneca-documents', false)
   on conflict (id) do nothing;

   -- Path scheme is {userId}/{sessionId}/{docId}.pdf — the first folder
   -- is the owning user, so we key access off of that.

   create policy "owner can read own seneca docs"
     on storage.objects for select
     to authenticated
     using (
       bucket_id = 'seneca-documents'
       and (storage.foldername(name))[1] = auth.uid()::text
     );

   create policy "owner can insert own seneca docs"
     on storage.objects for insert
     to authenticated
     with check (
       bucket_id = 'seneca-documents'
       and (storage.foldername(name))[1] = auth.uid()::text
     );

   create policy "owner can update own seneca docs"
     on storage.objects for update
     to authenticated
     using (
       bucket_id = 'seneca-documents'
       and (storage.foldername(name))[1] = auth.uid()::text
     );

   create policy "owner can delete own seneca docs"
     on storage.objects for delete
     to authenticated
     using (
       bucket_id = 'seneca-documents'
       and (storage.foldername(name))[1] = auth.uid()::text
     );
   ```

   The Seneca API actually writes / reads bytes through the service-role key (which bypasses RLS), but these policies are belt-and-braces in case anyone ever accesses the bucket directly with a user JWT.

8. Go to **Authentication → Sign In / Up** and turn **off** "Confirm email" for easy local testing. You can re-enable it before going public.

> **Already have a Supabase project from an earlier version of Seneca?** Run these migrations in the SQL editor to add new columns / tables / buckets without losing existing data:
>
> ```sql
> alter table sessions
>   add column if not exists map jsonb not null
>   default '{"center":[20,0],"zoom":2,"layer":"standard","pins":[],"shapes":[]}'::jsonb;
>
> alter table sessions
>   add column if not exists web jsonb not null
>   default '{"url":null,"history":[],"historyIndex":-1}'::jsonb;
>
> alter table sessions
>   add column if not exists documents jsonb not null
>   default '{"items":[],"activeId":null}'::jsonb;
>
> -- Phase 4 / cost telemetry — rolling per-session token + USD totals.
> -- Nullable so older rows backfill themselves the next time they take
> -- a turn (see `bumpUsage` in apps/api/src/lib/sessionStore.ts).
> alter table sessions
>   add column if not exists usage jsonb;
>
> insert into storage.buckets (id, name, public)
> values ('seneca-documents', 'seneca-documents', false)
> on conflict (id) do nothing;
>
> -- Re-run the four storage policies from step 7 above.
>
> -- Priority 1a — per-page extracted PDF text. Required for the
> -- document_read_page tool to work; without it Seneca falls back to
> -- asking you to enable vision capture for every text read.
> create table if not exists document_pages (
>   id uuid primary key default gen_random_uuid(),
>   doc_id uuid not null,
>   page int not null,
>   text text not null default '',
>   char_count int not null default 0,
>   created_at timestamptz default now(),
>   unique (doc_id, page)
> );
>
> create index if not exists document_pages_doc_id_idx on document_pages (doc_id);
>
> alter table document_pages enable row level security;
>
> create policy "owner can read own document pages"
>   on document_pages for select
>   to authenticated
>   using (
>     exists (
>       select 1 from sessions
>       where sessions.user_id = auth.uid()
>         and sessions.documents -> 'items' @> jsonb_build_array(
>           jsonb_build_object('id', document_pages.doc_id::text)
>         )
>     )
>   );
>
> -- Priority 1b — chunk-level embeddings used by document_search. Skip
> -- this block if you don't intend to set VOYAGE_API_KEY (search will
> -- degrade to substring without it).
> create extension if not exists vector;
>
> create table if not exists document_chunks (
>   id uuid primary key default gen_random_uuid(),
>   doc_id uuid not null,
>   page int not null,
>   chunk_index int not null,
>   text text not null,
>   embedding vector(1024) not null,
>   created_at timestamptz default now()
> );
>
> create index if not exists document_chunks_embedding_idx
>   on document_chunks
>   using ivfflat (embedding vector_cosine_ops)
>   with (lists = 100);
>
> create index if not exists document_chunks_doc_id_idx
>   on document_chunks (doc_id);
>
> alter table document_chunks enable row level security;
>
> create policy "owner can read own document chunks"
>   on document_chunks for select
>   to authenticated
>   using (
>     exists (
>       select 1 from sessions
>       where sessions.user_id = auth.uid()
>         and sessions.documents -> 'items' @> jsonb_build_array(
>           jsonb_build_object('id', document_chunks.doc_id::text)
>         )
>     )
>   );
>
> create or replace function match_document_chunks(
>   query_embedding vector(1024),
>   match_doc_id uuid,
>   match_count int
> )
> returns table (
>   doc_id uuid,
>   page int,
>   chunk_index int,
>   text text,
>   score float4
> )
> language sql stable security definer
> as $$
>   select
>     dc.doc_id, dc.page, dc.chunk_index, dc.text,
>     (1 - (dc.embedding <=> query_embedding) / 2)::float4
>   from document_chunks dc
>   where match_doc_id is null or dc.doc_id = match_doc_id
>   order by dc.embedding <=> query_embedding
>   limit match_count
> $$;
>
> grant execute on function match_document_chunks(vector(1024), uuid, int)
>   to authenticated, service_role;
>
> -- Phase 3 / Priority 2 — denormalised `session_id` on the two
> -- document side tables so the session-delete cascade can wipe orphan
> -- pages / chunks (uploads that crashed before being added to
> -- `sessions.documents.items`) in a single statement. Backfill is a
> -- no-op on empty tables; on populated ones, leave the column NULL —
> -- existing rows stay invisible via RLS and the per-doc cascade still
> -- finds them through `sessions.documents.items`.
> alter table document_pages
>   add column if not exists session_id uuid;
>
> alter table document_chunks
>   add column if not exists session_id uuid;
>
> create index if not exists document_pages_session_id_idx
>   on document_pages (session_id);
>
> create index if not exists document_chunks_session_id_idx
>   on document_chunks (session_id);
> ```

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
