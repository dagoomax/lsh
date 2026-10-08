# Wiring Emulator

‹ [Home](Home) · [Dashboard](Dashboard) ›

**Where:** Settings → System → Wiring emulator · **Code:** `react-dashboard/src/components/settings/wiring/` · **Tests:** `test/wiring-sim.test.js`

A wiring assistant and circuit emulator for Z-Wave in-wall modules. Diagrams, terminals and limits are converted from the manufacturers' installation manuals (Z-Wave Alliance product catalogue); the manuals themselves open on demand from the private manuals repository (see **Device manuals**). The **ℹ Info** button in the emulator explains everything below in the app, in the dashboard's language.

## Devices

| Device | Diagrams |
|---|---|
| FIBARO Single Switch 2 (FGS-213) | one switch · two-key switch (key 2 → scenes) |
| FIBARO Double Switch 2 (FGS-223) | one switch · two-key switch, two lights |
| FIBARO Dimmer 2 (FGD-212) | 3-wire / 2-wire × one switch / two-key switch |
| FIBARO Roller Shutter 3 (FGR-223) | standard blind motor · blind with built-in driver |
| Shelly Qubino Wave 1PM | toggle switch · push-button |
| Shelly Qubino Wave 2PM | two toggle switches · two push-buttons |

## Modes

- **Assistant** — the manual's diagram, wire by wire, with what each terminal is for, the device's limits and rules, and a tools & materials checklist.
- **Practice** — draw the wiring yourself (click a point, click empty space for bends, click the end; pick the conductor colour), add WAGO-style connectors from the palette (221-2411 inline, 221-412, 221-413, 2273-204, 221-415 or equivalents), then **Check wiring** (missing / wrong connections) and **Power on**.
- **Real wall box** — the incoming cable is one L, one N and one PE conductor; the assistant inserts the connectors a real box needs and the materials list counts them.
- **Enlarge (⤢)** — full-screen popup with zoom and pan.

## What the simulation does

Ports are nodes; wires, closed switch contacts, internal bridges, connectors and closed module outputs are merged into nets. Lamps and motor windings sit between nets; mains L / N / PE are the sources. Module behaviour follows the manuals: momentary vs toggle inputs, 2-wire dimmer powered through its load, the dimmer's switch supplied from Sx, shutter interlock and limit switches.

Flagged: short circuits and earth faults (breaker trips), live on N, missing neutral, outputs to neutral or straight to live, Sx on live/neutral, inputs on neutral, motor driven both ways, missing PE, too many conductors per terminal / connector port, mains conductor splits in a real box, and wire colours that don't match their role (EU: brown/black/grey line, blue neutral, green-yellow earth).

It is a simplified practice tool — no currents, cable lengths or load limits. Always follow the device manual and local regulations, and leave mains work to a qualified electrician.

## Adding a device

1. Put the manual in the manuals repo (`index.json` entry with SHA-256).
2. Add a device to `wiring/devices.js`: terminals (with `role`: `L`, `N`, `in`, `out`, `sx`), `bridges`, `power`, `inputs`, `channels` or `shutter`, `specs`, `rules`, and one `scenario` per manual diagram (parts + wires).
3. Add every new phrase to the phrase book (`wiring/i18n-dict*.js`, 6 languages).
4. `npm test` — every diagram must pass its own check, power up without danger findings, have a working wall-box plan, and every phrase must be translated.
