'use strict';

const crypto = require('crypto');
const { lshRequest, byName } = require('../GenericFunctions');

// LSH Trigger: starts the workflow when device values change. Activating the
// workflow subscribes this node's webhook URL in LSH (POST /api/webhooks);
// deactivating removes it. LSH signs each delivery with the secret it handed
// out (X-LSH-Signature: sha256=HMAC of the body), checked here.
class LshTrigger {
  constructor() {
    this.description = {
      displayName: 'LSH Trigger',
      name: 'lshTrigger',
      icon: 'file:lsh.svg',
      group: ['trigger'],
      version: 1,
      subtitle: '={{"on device changes"}}',
      description: 'Starts the workflow when LSH device values change',
      defaults: { name: 'LSH Trigger' },
      inputs: [],
      outputs: ['main'],
      credentials: [{ name: 'lshApi', required: true }],
      webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
      properties: [
        {
          displayName: 'LSH must be able to reach this n8n’s webhook URL (WEBHOOK_URL in n8n), and n8n must reach LSH.',
          name: 'notice', type: 'notice', default: '',
        },
        {
          displayName: 'Device Names or IDs', name: 'devices', type: 'multiOptions', default: [],
          typeOptions: { loadOptionsMethod: 'getDevices' },
          description: 'Devices to watch. Choose from the list, or specify keys using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Empty: use Key Patterns only.',
        },
        {
          displayName: 'Values', name: 'sensors', type: 'string', default: '',
          placeholder: 'power, on',
          description: 'Only these values of the chosen devices (sensor paths, comma-separated). Empty: every value.',
        },
        {
          displayName: 'Key Patterns', name: 'patterns', type: 'string', default: '',
          placeholder: 'shelly/*/power, airbnb/**',
          description: 'More store keys to watch, "<device key>/<value>": * matches within one segment, ** any number. "**" watches everything.',
        },
        {
          displayName: 'Output', name: 'output', type: 'options', default: 'each',
          options: [
            { name: 'One Item per Change', value: 'each' },
            { name: 'One Item per Delivery', value: 'batch', description: 'Changes within half a second arrive together, as a "changes" list' },
          ],
        },
        {
          displayName: 'Options', name: 'options', type: 'collection', placeholder: 'Add Option', default: {},
          options: [
            { displayName: 'At Most Once Every (Seconds)', name: 'throttleSeconds', type: 'number', default: 0, typeOptions: { minValue: 0, maxValue: 3600 },
              description: 'Per value: ignore further changes for this long after one is sent. 0: every change.' },
            { displayName: 'Only When Value Is', name: 'only', type: 'string', default: '', placeholder: 'true',
              description: 'Only changes to this value (compared as text), e.g. true for "turned on" or "motion"' },
            { displayName: 'Ignore Test Events', name: 'ignoreTest', type: 'boolean', default: false, description: 'Whether to drop the sample event sent by LSH’s "Test" button' },
          ],
        },
      ],
    };

    this.methods = {
      loadOptions: {
        async getDevices() {
          const list = await lshRequest.call(this, 'GET', '/devices');
          return (list || []).filter(Boolean).map((d) => ({ name: `${d.label || d.key}${d.room ? ` (${d.room})` : ''}`, value: d.key, description: d.key })).sort(byName);
        },
      },
    };

    this.webhookMethods = {
      default: {
        async checkExists() {
          const data = this.getWorkflowStaticData('node');
          if (!data.webhookId) return false;
          const url = this.getNodeWebhookUrl('default');
          try {
            const list = await lshRequest.call(this, 'GET', '/webhooks');
            const hit = (list || []).find((w) => w.id === data.webhookId);
            if (hit && hit.url === url && hit.enabled !== false) return true;
            if (hit) await lshRequest.call(this, 'DELETE', `/webhooks/${data.webhookId}`).catch(() => {});
          } catch { /* LSH unreachable: create() reports it */ }
          delete data.webhookId; delete data.secret;
          return false;
        },
        async create() {
          const keys = keysFrom(this.getNodeParameter('devices', []), this.getNodeParameter('sensors', ''), this.getNodeParameter('patterns', ''));
          if (!keys.length) throw new Error('Choose at least one device or key pattern to watch');
          const options = this.getNodeParameter('options', {});
          let name = 'n8n';
          try { const w = this.getWorkflow(); name = `n8n: ${w.name || w.id || 'workflow'}`; } catch { /* older n8n */ }
          const r = await lshRequest.call(this, 'POST', '/webhooks', { name, url: this.getNodeWebhookUrl('default'), keys, throttleSeconds: options.throttleSeconds || 0 });
          const data = this.getWorkflowStaticData('node');
          data.webhookId = r.id;
          data.secret = r.secret;
          return true;
        },
        async delete() {
          const data = this.getWorkflowStaticData('node');
          if (data.webhookId) {
            try { await lshRequest.call(this, 'DELETE', `/webhooks/${data.webhookId}`); } catch (err) { if (!/No such webhook|404/.test(err.message)) return false; }
          }
          delete data.webhookId; delete data.secret;
          return true;
        },
      },
    };
  }

  async webhook() {
    const req = this.getRequestObject();
    const body = this.getBodyData() || {};
    const data = this.getWorkflowStaticData('node');
    if (data.secret) {
      const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(body));
      if (!verify(data.secret, raw, req.headers?.['x-lsh-signature'])) {
        const res = this.getResponseObject();
        res.status(401).json({ error: 'bad signature' });
        return { noWebhookResponse: true };
      }
    }
    const options = this.getNodeParameter('options', {});
    if (body.event === 'test' && options.ignoreTest) return { workflowData: [[]] };
    let changes = Array.isArray(body.changes) ? body.changes : [];
    if (options.only !== undefined && options.only !== '') changes = changes.filter((c) => String(c.value) === String(options.only));
    if (!changes.length) return { workflowData: [[]] };
    const items = this.getNodeParameter('output', 'each') === 'batch'
      ? [{ json: { event: body.event, hub: body.hub || null, sentAt: body.sentAt, changes } }]
      : changes.map((c) => ({ json: { event: body.event, hub: body.hub || null, ...c } }));
    return { workflowData: [items] };
  }
}

// devices × values + patterns → LSH key patterns
function keysFrom(devices, sensors, patterns) {
  const list = (s) => String(s || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const vals = list(sensors);
  const keys = [];
  for (const d of Array.isArray(devices) ? devices : list(devices)) {
    if (vals.length) for (const v of vals) keys.push(`${d}/${v}`);
    else keys.push(`${d}/**`);
  }
  return [...new Set([...keys, ...list(patterns)])];
}

function verify(secret, raw, header) {
  const want = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const got = String(header || '');
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

module.exports = { LshTrigger, keysFrom, verify };
