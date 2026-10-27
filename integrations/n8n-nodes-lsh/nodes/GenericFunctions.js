'use strict';

// LSH REST API calls shared by the LSH and LSH Trigger nodes. LSH answers
// { success, data, error }; this returns data or throws the error.

async function lshRequest(method, path, body, qs) {
  const c = await this.getCredentials('lshApi');
  const base = String(c.baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('LSH URL must start with http:// or https://');
  const opts = { method, url: `${base}/api${path}`, json: true };
  if (body !== undefined) opts.body = body;
  if (qs) opts.qs = qs;
  let res;
  try {
    res = await this.helpers.httpRequestWithAuthentication.call(this, 'lshApi', opts);
  } catch (err) {
    const msg = err?.response?.body?.error || err?.cause?.response?.data?.error || err?.description || err?.message;
    throw new Error(`LSH ${method} ${path}: ${msg}`);
  }
  if (res && typeof res === 'object' && res.success === false) throw new Error(`LSH ${method} ${path}: ${res.error || 'failed'}`);
  return res && typeof res === 'object' && 'data' in res ? res.data : res;
}

// "21.5" → 21.5, "true" → true, '{"hue":10}' → object; anything else stays a string
function parseValue(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  if (/^[[{]/.test(t)) { try { return JSON.parse(t); } catch { /* text */ } }
  return v;
}

// a device with readings → a flat, workflow-friendly item
function simplifyDevice(d) {
  const values = {};
  for (const [p, r] of Object.entries(d.readings || {})) values[p] = r.value;
  return { key: d.key, label: d.label || d.key, room: d.room || null, type: d.type || null, icon: d.icon || null, values };
}

const byName = (a, b) => a.name.localeCompare(b.name);

module.exports = { lshRequest, parseValue, simplifyDevice, byName };
