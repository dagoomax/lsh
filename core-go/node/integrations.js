'use strict';

// Helper for the Go core: prints the effective config (config.js, with its
// env-var overrides) and the integrations from src/integrations.js whose
// `when` matches it — those are plain JS predicates, so Node evaluates them.

const path = require('path');
const fs = require('fs');
const root = process.argv[2] || path.join(__dirname, '..', '..');
const config = require(path.join(root, 'config'))();
const integrations = require(path.join(root, 'src', 'integrations')).map((it) => {
  let on = false;
  try { on = !!it.when(config); } catch { /* bad config section → off */ }
  const installed = fs.existsSync(path.join(root, 'src', `${it.file}.js`));
  return { file: it.file, label: it.label, expose: it.expose || null, on, installed };
});
process.stdout.write(JSON.stringify({ config, integrations }));
