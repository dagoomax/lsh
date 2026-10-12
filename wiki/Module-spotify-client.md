# `src/spotify-client.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~291 lines**

Integrates the **Spotify Web API**. No npm dependencies.

**Sign-in:** OAuth Authorization Code with **PKCE**, so only a **Client ID** is needed (create an app at developer.spotify.com/dashboard, API: Web API, and register the redirect URI shown in Settings → Media → Spotify). Spotify accepts only `https://…` or `http://127.0.0.1:<port>/…` redirect URIs; when the browser isn't on the LSH host, paste the address you land on back into the settings page. The refresh token is kept in `persist/spotify-oauth.json`.

**Device `spotify/player`:** `playing` (toggle), `prev` / `next` (triggers), `volume`, `shuffle`, labels `track`, `artist`, `album`, `device`, `repeat`. Polled every `pollInterval` s (default 5). Play with nothing active goes to `defaultDevice`, else the first available device. Controlling playback needs **Spotify Premium**.

**API:** `GET /api/spotify/status`, `/devices`, `/playlists`, `/search?q=`; `POST /api/spotify/play {"uri":"spotify:playlist:…"}`, `POST /api/spotify/transfer {"deviceId":…}`.

**Testing:** `node scripts/spotify-simulator.js 8889` with `apiBase` / `accountsBase` pointed at it; `test/spotify.test.js`.

Also feeds the [music player](Module-music-player) (Spotify / Apple Music source selector for Loxone).

---

| Aspect | Value |
|---|---|
| Config section(s) | `spotify` — `clientId`, `redirectUri?`, `defaultDevice?`, `pollInterval` |
| Platform-status key | `spotify` |
| Registers devices | `spotify/player` |
| Routes | `src/routes/spotify.js` |

*Extracted from `src/spotify-client.js`. Source is authoritative — regenerate this page if the module changes.*
