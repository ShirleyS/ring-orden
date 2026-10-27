# Netlify release

The user explicitly requested committing all work, merging all task work and pushing Ring Orden to Netlify. All original work is already on main, with no other branches or pull requests. Keep the existing Sites deployment intact.

- [ ] Add a dedicated Vite SPA build and Netlify Function adapter for the existing dashboard/API.
- [ ] Keep identity verified: strip incoming platform identity headers and trust only Netlify context.user from private project protection, or existing verified MojoAuth.
- [ ] Use the existing Supabase store when configured; otherwise provision Netlify Postgres with a tenant-scoped Repository, CAS and role-safe invitation transactions.
- [ ] Execute safety tests and both builds, inspect source for secrets, commit to main and push ShirleyS/ring-orden.
- [ ] Deploy to Shirley team on Netlify, preserve private workspace access and verify persisted ordering from the hosted UI.
