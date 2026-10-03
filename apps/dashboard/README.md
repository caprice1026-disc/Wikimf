# wikimf Dashboard

React + TypeScript + Vite. The interface follows `docs/wikimf-dashboard-ui-design-v0.1.md` and connects to the API contract in `packages/contracts/api.md`.

```powershell
npm.cmd install --cache .npm-cache
npm.cmd run dev
npm.cmd run build
```

The development server proxies `/api` to `http://127.0.0.1:8000`. Production should serve the Dashboard and `/api/v1` on the same origin, with SPA fallback to `index.html`. `VITE_API_BASE_URL` can override the API base at build time. OAuth provider credentials belong only in the Backend.

No demo records are shown by the app. Personal requests use the HttpOnly cookie session, `credentials: include`, and the CSRF token from `/me`. Personal records are kept in component memory and are reloaded after mutations; tokens are never stored in URLs or browser storage. Only the selected light/dark theme is persisted.

Routes include `/app`, `/app/library`, `/app/activity`, `/app/stats`, `/app/articles/:id`, `/app/achievements`, account/privacy settings, `/link-device/:id`, and `/u/:userId`. `/home` is the OAuth callback landing alias. Library filters and Activity/Statistics periods are URL state. Public profiles have their own response type and do not fetch private APIs.

With the dev server running and Google Chrome installed:

```powershell
npm.cmd test
```

The browser smoke uses explicitly synthetic API fixtures; it verifies UI interactions, CSRF propagation, manual/automatic state, deletion and reload, independent privacy settings, JSON download, device approval/revocation, public API separation, errors, timezone filters, and desktop/390px responsive layouts. Screenshots and its report are written to ignored `output/`. This test does not claim live Google/GitHub authentication, Android, Chrome Extension, or Backend security coverage.
