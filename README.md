# BiteSite – College Canteen (Vercel + Supabase)
Static site (no build step) + Supabase (Auth, Postgres, Storage, Realtime).

## Setup (15 min)
1. supabase.com → New project (Region: Mumbai/Singapore).
2. SQL Editor → paste `schema.sql` → Run.
3. Authentication → Providers → Email: for a quick pilot turn OFF "Confirm email" (or keep ON and students confirm by mail).
4. Project Settings → API → copy **Project URL** and **anon public key** into `config.js`.
5. Open the site, create YOUR account, then in SQL Editor run:
   `update public.profiles set role='admin' where id=(select id from auth.users where email='YOUR_EMAIL');`
   Log out/in → admin panel. Set UPI in Settings.
6. Push this folder to GitHub → vercel.com → Add New Project → import repo → Framework: **Other**, no build command, output dir blank → Deploy.
7. Authentication → URL Configuration → Site URL = your Vercel URL.

## Security notes
- Passwords: bcrypt-hashed by Supabase Auth (you never see them).
- anon key is public by design; data is protected by Row Level Security. Never expose service_role.
- Prices/totals are computed in DB (`place_order`), students can't tamper or self-promote to admin.
- Screenshots in a private bucket, signed URLs only.
- vercel.json adds CSP, HSTS, frame-deny headers.
