'use strict';

// Drives the real src/routes/settings.js so settings_routes_test.go can
// compare its GET redaction and POST merge against the Go port. Patches the
// config read/write and setup-ID generation (captured by settings.js when it
// requires them) to use temp files and a fixed id — without touching the
// repo's own config.json.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const [mode, inFile, outFile, bodyFile] = process.argv.slice(2);

const helpers = require(path.join(root, 'src', 'routes', 'helpers'));
helpers.readConfigFile = () => JSON.parse(fs.readFileSync(inFile, 'utf8'));
const cfc = require(path.join(root, 'src', 'config-file-cache'));
cfc.writeConfigFile = (data) => fs.writeFileSync(outFile, JSON.stringify(data));
const hkuri = require(path.join(root, 'src', 'homekit-uri'));
hkuri.generateSetupID = () => 'ZZZZ';

const register = require(path.join(root, 'src', 'routes', 'settings'));

const handlers = {};
const router = {
  get: (p, ...h) => { handlers['GET ' + p] = h[h.length - 1]; },
  post: (p, ...h) => { handlers['POST ' + p] = h[h.length - 1]; },
};
register(router, { relayController: { config: {} }, requireAdmin: (_q, _s, n) => n() });

const res = { json: (v) => process.stdout.write(JSON.stringify(v)), status: () => res };
if (mode === 'get') {
  handlers['GET /settings']({}, res);
} else {
  handlers['POST /settings']({ body: JSON.parse(fs.readFileSync(bodyFile, 'utf8')) }, res);
  process.stdout.write(fs.readFileSync(outFile, 'utf8'));
}
