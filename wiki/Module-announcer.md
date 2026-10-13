# `src/announcer.js`

‹ [Home](Home) · [Modules Index](Modules) · [Architecture](Architecture) ›

**Category:** Media  ·  **~314 lines**  ·  installable module `announcer`

Spoken announcements on AirPlay speakers (HomePod, AirPlay 2 speakers).

Text → speech (TTS) → chime + speech → src/airplay-client.js → speakers. What triggers one:

- Loxone (or anything) over HTTP — a Virtual Output that calls

```
  GET /api/announce/say?text=…&token=… or one of the saved messages
  (the `announce/lsh` device: every message is a command, so the regular
  Loxone export /api/loxone/outputs.xml?type=announce builds the Virtual
  Output; messages with {v} take Loxone's analog value)
```

- rules: "when <device value> turns on / changes / equals X, say …" — e.g.

```
  a Loxone input or a Loxone alarm state mirrored in LSH
```

- the dashboard, flows (device command), POST /api/announce

TTS engines: 'say' (macOS, offline), 'espeak' (espeak-ng, offline), 'google' (Google Translate voice, online), 'url' (your own TTS server, urlTemplate with {text} / {lang}); 'auto' = local voice for the language if there is one, else Google. Clips are cached in persist/tts-cache/.

```
config.announce = {
enabled, speakers: [airplay speaker ids] (default target), volume (0–100),
chime = true, lang = 'en', engine = 'auto', voice, urlTemplate,
quietHours: { from: '22:00', to: '07:00' } (skipped then unless urgent),
messages: [{ id, label, text, speakers?, volume?, urgent?, min?, max? }],
rules:    [{ id, deviceKey, path, when: 'on'|'change'|'equals', value?, text, speakers?, urgent? }],
}
```

---

| Aspect | Value |
|---|---|
| Config section(s) | `announce` |
| Enabled when | `config.announce?.enabled` |
| Platform-status key | `announce` |
| Registers devices | `announce/…` |
| npm dependencies | `@lox-audioserver/node-airplay-sender` `bonjour-service` |
| Other files | `src/airplay-client.js` `src/airplay-pairing.js` |
| Routes | `src/routes/announce.js` |
| Tests | `test/announcer.test.js` |

*Extracted from the header of `src/announcer.js`. Source is authoritative — regenerate this page if the module changes.*
