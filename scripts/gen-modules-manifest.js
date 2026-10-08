#!/usr/bin/env node
// Generates modules.json — the manifest src/module-manager.js uses to fetch
// integrations from GitHub on demand. Derived entirely from the source, so
// re-run it whenever an integration is added or its requires change:
//
//   node scripts/gen-modules-manifest.js
//
// Rules:
//   core    = server.js/config.js hard requires + everything those files
//             require at top level (transitively), plus any tryRequire'd
//             integration that server.js loads unconditionally.
//   module  = each `tryRequire('./src/x')` guarded by `if (config.…)` in
//             server.js, and each entry in src/integrations.js. Its files are the entry plus every local file it
//             requires (top-level or lazy) that isn't core; its npm deps are
//             the bare requires in those files, minus core's.
//   package.json's dependencies are rewritten to core's deps only — module
//   deps move into the manifest and are npm-installed on demand.

const fs   = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const ROOT = path.join(__dirname, '..');
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const prevManifest = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf8')); } catch { return null; }
})();
// Full dependency versions — package.json once slimmed only holds core's, so
// module dep versions come from the previous manifest after the first run.
const allDeps = { ...pkg.dependencies };
for (const m of Object.values(prevManifest?.modules || {})) Object.assign(allDeps, m.deps);

const BUILTIN = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const pkgName = (spec) => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

// Parse one file's requires. topLevel = require at column 0 (incl.
// `try { x = require(...) }` guards), the rest are lazy (inside functions).
function parseRequires(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = { local: [], bare: [] };
  for (const line of src.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    // Column 0, or a bare `require('x'),` element of a top-level list
    // (api-routes.js ROUTE_GROUPS) — lazy requires inside functions are
    // always assignments/calls, never a bare list element.
    const topLevel = !/^\s/.test(line) || /^\s+require\('[^']+'\),?\s*$/.test(line);
    for (const m of line.matchAll(/(tryRequire|require|import)\('([^']+)'/g)) {
      if (m[1] === 'tryRequire') continue; // optional — handled as modules
      const spec = m[2];
      if (spec.startsWith('.')) {
        let p = path.resolve(path.dirname(file), spec);
        if (!p.endsWith('.js') && !p.endsWith('.json')) p += '.js';
        if (fs.existsSync(p)) out.local.push({ p, topLevel });
      } else if (!BUILTIN.has(spec) && !BUILTIN.has(pkgName(spec))) {
        out.bare.push({ name: pkgName(spec), topLevel });
      }
    }
  }
  return out;
}

function closure(entries, { lazy, stop = new Set() }) {
  const files = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (files.has(f) || stop.has(f)) continue;
    files.add(f);
    for (const r of parseRequires(f).local) if (lazy || r.topLevel) stack.push(r.p);
  }
  return files;
}

// ── server.js: find each tryRequire and the config guard around it ──────
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').split('\n');
const integrations = [];
serverSrc.forEach((line, i) => {
  const m = line.match(/tryRequire\('\.\/src\/([^']+)'/);
  if (!m) return;
  const indent = line.match(/^\s*/)[0].length;
  // Walk outward through the enclosing blocks, collecting every `if (…)`
  // condition (negated when we came up through its `} else {`). Stops at the
  // function body's indent (2). The AND of them is exactly when server.js
  // loads this module; none at all → loaded unconditionally → core.
  const conds = [];
  let negate = false;
  for (let j = i - 1, want = indent; j >= 0 && want > 2; j--) {
    const l = serverSrc[j];
    const li = l.match(/^\s*/)[0].length;
    if (!l.trim() || li >= want || /^\s*\) \{/.test(l)) continue; // `) {` closes a multi-line if
    want = li;
    // the `if` this else belongs to sits at the same indent — let it match
    if (/^\s*\} else \{/.test(l)) { negate = true; want = li + 1; continue; }
    if (/^\s*(\} else )?if \(/.test(l)) {
      // Conditions can span lines — join down to the tryRequire line and
      // take everything up to the first `) {`.
      const cond = serverSrc.slice(j, i).join(' ').replace(/\s+/g, ' ').match(/if \((.*?)\)\s*\{/)[1];
      conds.push(negate ? `!(${cond})` : `(${cond})`);
    }
    negate = false;
  }
  const guard = conds.some((c) => /config\./.test(c)) ? conds.reverse().join(' && ') : null;
  const keys = guard ? [...new Set([...guard.matchAll(/config\.(\w+)/g)].map((g) => g[1]))] : [];
  integrations.push({ id: m[1].replace(/-client$/, ''), entry: `src/${m[1]}.js`, configKeys: keys, guard });
});

// …plus the table-driven ones server.js starts in a loop (src/integrations.js).
// Their `when` is a `(config) => expr` arrow — its body is the condition.
for (const it of require(path.join(ROOT, 'src', 'integrations.js'))) {
  const body = it.when.toString().replace(/^\(?\s*config\s*\)?\s*=>\s*/, '');
  const guard = `(${body})`;
  const keys = [...new Set([...guard.matchAll(/config\.(\w+)/g)].map((g) => g[1]))];
  integrations.push({ id: it.file.replace(/-client$/, ''), entry: `src/${it.file}.js`, configKeys: keys, guard });
}

// Unguarded, or on-by-default (`config.x !== false`) → always loaded → core.
const isCore = (x) => !x.guard || /^\(config\.[\w?.]+ !==? false\)$/.test(x.guard);
const coreEntries = [path.join(ROOT, 'server.js'), path.join(ROOT, 'config.js'),
  ...integrations.filter(isCore).map((x) => path.join(ROOT, x.entry))];
const core = closure(coreEntries, { lazy: false });

const coreDeps = new Set();
for (const f of core) for (const b of parseRequires(f).bare) coreDeps.add(b.name);

const modules = {};
for (const it of integrations.filter((x) => !isCore(x))) {
  const files = closure([path.join(ROOT, it.entry)], { lazy: true, stop: core });
  const deps = {};
  for (const f of files) {
    for (const b of parseRequires(f).bare) {
      if (!coreDeps.has(b.name) && allDeps[b.name]) deps[b.name] = allDeps[b.name];
    }
  }
  modules[it.id] = {
    entry: it.entry,
    configKeys: it.configKeys,
    when: it.guard, // JS expression over `config` — src/module-manager.js evaluates it
    files: [...files].map((f) => path.relative(ROOT, f)).sort(),
    deps,
  };
}

const manifest = {
  repo: 'dagoomax/lsh',
  core: [...core].map((f) => path.relative(ROOT, f)).filter((f) => f.startsWith('src/')).sort(),
  modules,
};
fs.writeFileSync(path.join(ROOT, 'modules.json'), JSON.stringify(manifest, null, 2) + '\n');

// Slim package.json to core deps (keep anything core needs or that isn't
// claimed by any module — e.g. packages only scripts/ use).
const moduleDeps = new Set(Object.values(modules).flatMap((m) => Object.keys(m.deps)));
const slim = {};
for (const [name, ver] of Object.entries(allDeps)) {
  if (coreDeps.has(name) || !moduleDeps.has(name)) slim[name] = ver;
}
pkg.dependencies = Object.fromEntries(Object.entries(slim).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`core: ${manifest.core.length} files, ${Object.keys(slim).length} deps`);
console.log(`modules: ${Object.keys(modules).length} (${moduleDeps.size} deps moved out of package.json)`);
