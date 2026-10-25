'use strict';

// Keypad codes the guest portal wants on a lock (src/tenant-portal.js
// publishes tenant/<property>/codes = { lock: 'nuki/123', codes: [{ id, name,
// pin, from, to }] }), kept in sync by the lock's own module — Nuki, Tedee.
//
// Only codes this creates are touched: their name starts with "LSH-<id>".
// Anything the owner set up in the lock's app stays as it is. A lock that
// had wanted codes and no longer appears (property removed, moved to another
// lock, portal off) gets its LSH codes removed. Codes carry the stay's
// window, so the lock itself refuses them outside it even if a sync is late.
//
//   watchLockCodes(store, 'nuki', async (lockKey, codes) => { …apply… })

const KEY_RE = /^tenant\/([^/]+)\/codes$/;
const MANAGED_RE = /^LSH-([a-z0-9]{6})\b/;
const RECONCILE_MS = 15 * 60_000;

function wanted(store, type) {
  const out = new Map(); // lockKey → { codes, props }
  for (const key of Object.keys(store.data || {})) {
    const m = KEY_RE.exec(key);
    if (!m) continue;
    const v = store.get(key);
    if (!v?.lock || !String(v.lock).startsWith(`${type}/`)) continue;
    const entry = out.get(v.lock) || { codes: [], props: [] };
    entry.codes.push(...(v.codes || []));
    entry.props.push(m[1]);
    out.set(v.lock, entry);
  }
  return out;
}

function watchLockCodes(store, type, sync, { delayMs = 2000, log = type } = {}) {
  let timer = null;
  let running = false;
  let again = false;
  const known = new Map(); // lockKey → properties last seen with it
  const tag = `[${log}]`;

  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      const want = wanted(store, type);
      for (const lockKey of new Set([...want.keys(), ...known.keys()])) {
        const w = want.get(lockKey) || { codes: [], props: known.get(lockKey) || [] };
        let status;
        try {
          const r = await sync(lockKey, w.codes);
          status = `OK · ${w.codes.length} code(s)${r?.added || r?.removed ? ` · +${r.added || 0} −${r.removed || 0}` : ''}`;
          if (r?.added || r?.removed) console.log(`${tag} ${lockKey}: keypad codes +${r.added || 0} −${r.removed || 0}`);
        } catch (err) {
          status = `Error: ${err.message}`;
          console.error(`${tag} ${lockKey}: keypad code sync failed — ${err.message}`);
        }
        for (const p of w.props) {
          if (store.get(`tenant/${p}/lockCodes`) !== status) store.set(`tenant/${p}/lockCodes`, status);
        }
        if (want.has(lockKey)) known.set(lockKey, w.props); else known.delete(lockKey);
      }
    } finally {
      running = false;
      if (again) { again = false; kick(); }
    }
  };
  const kick = () => { clearTimeout(timer); timer = setTimeout(run, delayMs); timer.unref?.(); };

  const onChange = ({ key }) => { if (KEY_RE.test(key)) kick(); };
  store.on('change', onChange);
  const every = setInterval(kick, RECONCILE_MS);
  every.unref?.();
  kick();
  return { stop: () => { store.off('change', onChange); clearInterval(every); clearTimeout(timer); }, run };
}

// Diff a lock's codes by the id in their name: which existing ones to
// delete, which wanted ones to add.   existing: [{ id, name }]   want: [{ id, … }]
function diffCodes(existing, want) {
  const wantIds = new Set(want.map((c) => c.id));
  const have = new Set();
  const remove = [];
  for (const e of existing) {
    const id = MANAGED_RE.exec(e.name || '')?.[1];
    if (!id) continue; // not ours
    if (wantIds.has(id) && !have.has(id)) have.add(id);
    else remove.push(e);
  }
  return { remove, add: want.filter((c) => !have.has(c.id)) };
}

module.exports = { watchLockCodes, diffCodes, MANAGED_RE };
