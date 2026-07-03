# Loxone templates for LSH

Importable Loxone Config templates that drive LSH devices over its REST API.

Before importing, replace **`YOUR_LSH_TOKEN`** in each file with a real API token
(from `persist/api-tokens.json`), and set the `Address` to your LSH host
(`http://<lsh-ip>:3000`).

## Control (Virtual Output)

Right-click **Virtual Outputs → Import Virtual Output**:

- `loxone-lsh-somfy.xml` — 14 Somfy blinds: Open/Close, Stop, Position (0–100)
- `loxone-lsh-fibaro-all.xml` — 44 Fibaro devices: switches, shutters, dimmers
- `loxone-lsh-fibaro-dimmers.xml` — just the 5 Fibaro dimmers

## Feedback (Virtual HTTP Input)

Right-click **Virtual Inputs → Import Virtual HTTP Input**:

- `loxone-lsh-fibaro-all-input.xml`
- `loxone-lsh-fibaro-dimmers-input.xml`

## Notes

- Commands use `GET` with the `?token=` query param.
- Device keys are `%2F`-encoded in the path (`fibaro%2Froom_443`, `somfy%2Fio___…`).
- Dimmers are 0–99; shutters/blind positions are 0–100.
- Somfy RTS motors are one-way (no position feedback); io motors report state.
