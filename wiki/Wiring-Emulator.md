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
| Room thermostat GA-1 / GA-2 (water heating, 100–240 V, 3 A) | zone 1 of a 230 V underfloor-heating wiring centre with two actuators · actuator straight on the thermostat |
| SmartBob SM-LITE-1616R (DIN-rail controller, 16 in / 16 relays) | push-button + light (input logic 1 and 2) · roller blind on two relays · load over 2500 W through a contactor · two DS18B20 temperature sensors on 1-Wire |

The GA thermostat diagrams come from its printed sheet (GA-1: 1 L, 2 N in, 3 N1 / 4 L1 out, 6–7 RT sensor; GA-2: 4 NO live while heating, 5 NC live while not) and the wiring-centre drawing: the thermostat takes L and N from zone 1's input and returns the switched live to that zone's L1; the zone's N + L1 output pairs each drive a 230 V thermoelectric actuator. Instead of remote buttons there are **Room** and **Setpoint** sliders — the thermostat calls for heat below setpoint − 0.25 °C and stops above setpoint + 0.25 °C; actuators glow when open.

The SmartBob diagrams come from its installation sheet. Unlike the in-wall modules it has a separate 24 V DC side (supply, inputs switched to 0 V or +24 V) and **potential-free** relay contacts (COM / NO / NC) that you feed from your own breakers. The emulator models the 24 V supply, DIN breakers and a contactor for this, flags 230 V on the 24 V side, DC shorts and reversed polarity, and shows only the terminals each diagram uses. Remote control buttons are labelled LAN instead of Z-Wave. A **Real module** panel shows SmartBob's product photo (bundled with the dashboard, `react-dashboard/public/wiring/`) with the connectors the diagram uses outlined, and a zoom lens on the connector of the current step or the terminal you last clicked. DS18B20 sensors sit in parallel on the 1-Wire bus (interface connector pins 1 supply / 4 data / 5 ground, as in the sheet's example — pin names are read from that drawing); each reads a temperature you set with a slider when it is correctly on the bus, and reversed sensors, a shorted data line and 24 V / 230 V on the 3.3 V interface are flagged.

## Real module view

Every device has a **Real module** panel next to the steps: a zoom lens on the exact terminal (or connector) of the current step — or the terminal you last clicked — over an overview with the diagram's terminals outlined.

- **Shelly Qubino Wave 1PM / 2PM** — the product render, zoomed onto the printed terminal (O · SW · L · N, N · O1 · L · O2 · SW1 · SW2).
- **FIBARO FGS-213 / FGS-223 / FGD-212 / FGR-223** — the product photo (the terminals are on the back), plus the terminal view from the module's manual for the zoom.
- **Thermostat GA-1 / GA-2** — the terminal diagram from the printed sheet (owner's photo, private manuals repo, loaded on demand).
- **SmartBob SM-LITE-1616R** — the product photo, zoomed onto the connector block (relays, inputs, 24 V, interface).

Images are bundled with the dashboard (`react-dashboard/public/wiring/`, ~0.5 MB in total; the owner has the rights to them); terminal boxes live in each device's `photo` entry and a test checks every terminal a diagram uses has one.

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
2. Add a device to `wiring/devices.js`: terminals (with `role`: `L`, `N`, `in`, `out`, `sx`, `com`, `dcplus`, `dcminus`), `bridges`, `power` (`{ L, N }` or `{ dc: { plus, minus } }`), `inputs` (reference `L`, `Sx`, `GND` or `V+`), `channels` (`out`, or potential-free `com` / `no` / `nc`) or `shutter` (also per scenario), `specs`, `rules`, and one `scenario` per manual diagram (parts + wires).
3. Add every new phrase to the phrase book (`wiring/i18n-dict*.js`, 6 languages).
4. `npm test` — every diagram must pass its own check, power up without danger findings, have a working wall-box plan, and every phrase must be translated.
