# `src/apple-music.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Integration client  ·  **~177 lines**

**Apple Music** for LSH. Apple has no API to control the Music app, iPhones or HomePods remotely, so music **plays in the browser**: the dashboard's **Music** page (`/react/music`) runs Apple's MusicKit JS, signed in with the listener's Apple ID (full tracks need an Apple Music subscription).

**Developer token:** LSH holds the MusicKit private key (Apple Developer account → Media ID with MusicKit → Key with Media Services → `.p8`) and signs the developer token (ES256 JWT, 12 h, cached). Settings → Media → Apple Music checks it against Apple.

**Device `applemusic/player`:** while a Music page is open somewhere it reports every 2 s; LSH shows the most recently active page as `applemusic/player` — `playing`, `prev` / `next`, `volume`, labels `track`, `artist`, `album`, `device`. Commands are queued and picked up by the page on its next report. `POST /api/apple-music/play {"kind":"playlist","id":"pl.…"}` starts a song / album / playlist / station there.

Also feeds the [music player](Module-music-player) (Spotify / Apple Music source selector for Loxone).

---

| Aspect | Value |
|---|---|
| Config section(s) | `appleMusic` — `teamId`, `keyId`, `privateKey` \| `keyFile`, `storefront` |
| Platform-status key | `appleMusic` |
| Registers devices | `applemusic/player` |
| Routes | `src/routes/apple-music.js` |

*Extracted from `src/apple-music.js`. Source is authoritative — regenerate this page if the module changes.*
