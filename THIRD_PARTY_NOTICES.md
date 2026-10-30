# Third-party notices

LSH includes or uses code from the projects below. Each keeps its own license;
nothing here changes those terms. Full license texts for the copyleft licenses
are in [`LICENSES/`](LICENSES/); npm packages ship their own license file in
`node_modules/<package>/`.

## Copyleft components

| Component | License | Used by | How it is included |
| --- | --- | --- | --- |
| [esphome-victron_ble](https://github.com/Fabian-Schmidt/esphome-victron_ble), Copyright Fabian Schmidt | GPL-3.0-or-later | `src/lsh-ble.js` (Victron BLE decoder) | ported to JavaScript; the file is distributed under GPL-3.0-or-later |
| [HA_DSC_Neo_ITv2](https://github.com/LawPaul/HA_DSC_Neo_ITv2), Copyright LawPaul (informed by NeoHub / DSC-TLink, GPL-3.0) | GPL-3.0-or-later | `src/dsc-itv2.js` (DSC PowerSeries Neo ITv2) | ported to JavaScript; the file is distributed under GPL-3.0-or-later |
| [@lox-audioserver/node-airplay-sender](https://github.com/lox-audioserver/node-airplay-sender) | AGPL-3.0 | `src/airplay-client.js` | npm package, installed on demand |
| [zigbee-on-host](https://github.com/Nerivec/zigbee-on-host) (via zigbee-herdsman, MIT) | GPL-3.0-or-later | `src/zigbee-client.js` | npm package, installed on demand |
| [hap-controller](https://github.com/Apollon77/hap-controller-node) | MPL-2.0 | `src/homekit-controller-client.js` | npm package, installed on demand, unmodified |

GPL-3.0: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt) ·
AGPL-3.0: [`LICENSES/AGPL-3.0.txt`](LICENSES/AGPL-3.0.txt) ·
MPL-2.0: `node_modules/hap-controller/LICENSE`

The source code of these files and of LSH as installed is available in this
repository; on a device it is the `~/lsh` checkout.

## Ported protocol code and data (permissive licenses)

| Source | License and copyright | Used by |
| --- | --- | --- |
| [python-karcher](https://github.com/lafriks/python-karcher) | MIT, Copyright (c) 2023 Lauris BH | `src/karcher-client.js`, `src/karcher-map.js` |
| [pysolarmanv5](https://github.com/jmccrohan/pysolarmanv5) | MIT, Copyright (c) 2021 Jonathan McCrohan | `src/sofar-client.js` |
| [python-roborock](https://github.com/Python-roborock/python-roborock) | Apache-2.0 | `src/roborock-cloud-client.js` |
| [homeassistant-smartcore](https://github.com/Atios-AG/homeassistant-smartcore) | MIT, Copyright (c) 2026 Dmitri Ivanov | `src/atios-client.js` (API calls only) |
| [ha-anker-solix-official](https://github.com/anker-charging/ha-anker-solix-official) | MIT, Copyright (c) 2026 Anker Innovations | `src/anker-solix-maps.json` |
| ha-unifiplay | MIT | `src/unifi-play-client.js` (protocol description only) |
| [Swagger UI](https://github.com/swagger-api/swagger-ui) | Apache-2.0, Copyright SmartBear Software | `public/lib/swagger-ui/` |

The MIT license of the projects above requires this notice:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Apache-2.0 text: `node_modules/jsbi/LICENSE` (same license).

## Needs clearance

| Source | Issue | Used by |
| --- | --- | --- |
| [solaraccelerator_connect_ha](https://github.com/aLAN-LDZ/solaraccelerator_connect_ha) | the repository has no license; the catalog and Polish names were copied from its `catalog.py` and `control.py` | `src/solaraccelerator-client.js` |

Until the author grants permission, rewrite that catalog independently or
leave the Solar Accelerator integration out of distributed builds.

## npm dependencies

The remaining ~870 npm packages (backend and `react-dashboard/`) are under
permissive licenses: MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, BlueOak-1.0.0,
Unlicense, CC-BY-4.0. `node-forge` is used under its BSD-3-Clause option.
List them with `npx license-checker --summary`.
