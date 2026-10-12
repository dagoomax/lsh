# `src/music-player.js`

‹ [Home](Home) · [Modules Index](Modules) · [Export to Loxone](Export-to-Loxone) ›

**Category:** Integration client  ·  **~135 lines**

One player in front of [Spotify](Module-spotify-client) and [Apple Music](Module-apple-music) with a **source selector**, made for Loxone: one set of Virtual Outputs / Inputs drives whichever service is selected. Registered as `music/player` when Spotify or Apple Music is configured.

| Sensor | Meaning |
|---|---|
| `source` (0–2) | `0` = stop, `1` = Spotify, `2` = Apple Music — wire a Loxone **Radio Buttons** block's output straight in. Switching while playing pauses the old source and starts the new one. |
| `useSpotify` / `useAppleMusic` | pulse inputs for the same thing |
| `playing`, `prev`, `next`, `volume` | sent to the selected source |
| `spotifyReady` / `appleMusicReady` | Spotify signed in / a Music page is open — for status LEDs |
| `track`, `artist`, `album`, `device`, `sourceName` | mirrored from the selected source (dashboard only — Loxone virtual inputs are numeric) |

Commands go to the live client in `apiClients`, so they keep working after a service's settings are saved. The selected source survives restarts.

**Loxone import:** Settings → Loxone XML Templates → **Music outputs.xml / Music inputs.xml**, or `GET /api/loxone/musicout.xml` and `/api/loxone/musicin.xml` (`?token=` / `?tokenId=`, `?host=`, `?polling=`); `GET /api/loxone/music.zip` bundles both. See [Export to Loxone](Export-to-Loxone).

---

| Aspect | Value |
|---|---|
| Config section(s) | `music` — `name`, `defaultSource`, `enabled` |
| Registers devices | `music/player` |
| Tests | `test/music-player.test.js` |

*Extracted from `src/music-player.js`. Source is authoritative — regenerate this page if the module changes.*
