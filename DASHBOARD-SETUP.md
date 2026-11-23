# Greenhouse artist dashboard

The dashboard lives at **greenhouseeventsuae.com/admin**. It holds every artist's photos, videos, links and
private contact details, and controls what appears on the talent page. Applications from the
**Join Our Roster** page arrive in its Applications inbox.

It uses Supabase (database, logins and photo storage), the same setup as the NOVI Collective site.

## One-time setup

1. **Connect Supabase to this site.** Vercel › project *green-house-events* › **Storage** › **Create Database** ›
   **Supabase** › create it and **connect it to the green-house-events project**. Vercel adds the Supabase
   address and public key to the project for you.
2. **Create the tables.** In Supabase: **SQL Editor** › New query › paste all of `supabase/schema.sql` › **Run**.
3. **Import the current roster.** New query › paste all of `supabase/seed-current-roster.sql` › **Run**.
   This copies the ~340 acts already on the talent page into the dashboard, all switched on.
   Then run the **private-full-names.sql** file Claude sent you separately (it fills in each artist's full
   name in their private details). That file is deliberately not in this repository, which is public.
4. **Add yourself as an admin.** New query › run (with your email):
   `insert into public.admins (email) values ('info@greenhouseeventsuae.com');`
5. **Create your login.** Supabase › **Authentication › Users › Add user › Create new user** with that same
   email and a password (tick *Auto confirm user*).
   Then **Authentication › Sign In / Providers**: turn **off** *Allow new users to sign up*.
   And **Authentication › URL Configuration**: set *Site URL* to `https://greenhouseeventsuae.com`
   (so "Forgot password" emails link back to the dashboard).
6. **Redeploy** in Vercel (Deployments › ⋯ › Redeploy) so the site picks up the Supabase settings.
7. Open **greenhouseeventsuae.com/admin** and sign in.

To give a team member access later: repeat steps 4 and 5 with their email.

## How it works

- **Show on website** switch: turns an artist on or off on the talent page straight away.
- **Photos:** the first photo is the one on the website; reorder with the arrows or the ★ button.
- **Videos & links:** every link is saved privately. Switch a link on to show it on the website too
  (videos show as a **Watch** button that plays on the page).
- **Private details** (phone, email, rates, notes) are never sent to the public website. The database's
  security rules only let signed-in admins read them.
- **Applications:** mark them New / Shortlisted / Approved / Declined, add notes, or press
  **Create artist profile** to turn one into a (hidden) artist with their photos copied across.

Until Supabase is connected, the talent page shows the roster written into `talent.html`, the Join Our Roster
form asks artists to email instead, and `/admin` shows a "not connected yet" message.

## Files

- `admin/`: the dashboard (`index.html`, `admin.js`, `admin.css`)
- `api/config.js`: gives the site the Supabase address and public key from Vercel
- `js/supabase.js`: Supabase's browser library (v2), `js/gh-db.js`: shared connection and photo resizing
- `js/talent-live.js`: draws the talent page from the dashboard
- `supabase/schema.sql`: tables, security rules and photo storage
- `supabase/seed-current-roster.sql`: one-time import of the current roster
