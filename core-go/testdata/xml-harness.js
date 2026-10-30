'use strict';

// Builds the Loxone XML exports with the real src/loxone-xml.js / src/zip.js
// for loxone_test.go to compare against the Go port.
const path = require('path');
const { buildInputsXml, buildOutputsXml, buildScenesXml } = require(path.join(__dirname, '..', '..', 'src', 'loxone-xml'));
const { zipStore } = require(path.join(__dirname, '..', '..', 'src', 'zip'));
const { devices, scenes, opts } = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const inputs = buildInputsXml(devices, opts);
const outputs = buildOutputsXml(devices, opts);
const zip = zipStore(inputs.map((data, i) => ({ name: `lsh-loxone-inputs-${i + 1}.xml`, data }))).toString('base64');
const perDevice = devices.map((d) => [buildInputsXml([d], opts), buildOutputsXml([d], opts)]);
process.stdout.write(JSON.stringify({ inputs, outputs, scenes: buildScenesXml(scenes, opts), zip, perDevice }),
  () => process.exit(0));
