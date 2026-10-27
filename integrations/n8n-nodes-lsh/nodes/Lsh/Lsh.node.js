'use strict';

const { lshRequest, parseValue, simplifyDevice, byName } = require('../GenericFunctions');

// LSH: devices (list, get, read a value, send a command), scenes and flows.
class Lsh {
  constructor() {
    this.description = {
      displayName: 'LSH',
      name: 'lsh',
      icon: 'file:lsh.svg',
      group: ['transform'],
      version: 1,
      subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
      description: 'Read and control LSH smart-home devices, run scenes and flows',
      defaults: { name: 'LSH' },
      inputs: ['main'],
      outputs: ['main'],
      credentials: [{ name: 'lshApi', required: true }],
      properties: [
        {
          displayName: 'Resource', name: 'resource', type: 'options', noDataExpression: true, default: 'device',
          options: [{ name: 'Device', value: 'device' }, { name: 'Scene', value: 'scene' }, { name: 'Flow', value: 'flow' }],
        },
        {
          displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'sendCommand',
          displayOptions: { show: { resource: ['device'] } },
          options: [
            { name: 'Send Command', value: 'sendCommand', action: 'Send a command to a device', description: 'Switch, dim, set a temperature…' },
            { name: 'Get Value', value: 'getValue', action: 'Get one value of a device' },
            { name: 'Get', value: 'get', action: 'Get a device with all its values' },
            { name: 'Get Many', value: 'getAll', action: 'Get many devices' },
          ],
        },
        {
          displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'run',
          displayOptions: { show: { resource: ['scene', 'flow'] } },
          options: [
            { name: 'Run', value: 'run', action: 'Run a scene or flow' },
            { name: 'Get Many', value: 'getAll', action: 'List scenes or flows' },
          ],
        },
        {
          displayName: 'Device Name or ID', name: 'deviceKey', type: 'options', required: true, default: '',
          typeOptions: { loadOptionsMethod: 'getDevices' },
          displayOptions: { show: { resource: ['device'], operation: ['sendCommand', 'getValue', 'get'] } },
          description: 'Choose from the list, or specify a device key (e.g. shelly/shellyplus1-abc) using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        },
        {
          displayName: 'Value Name or ID', name: 'sensor', type: 'options', required: true, default: '',
          typeOptions: { loadOptionsMethod: 'getSensors', loadOptionsDependsOn: ['deviceKey'] },
          displayOptions: { show: { resource: ['device'], operation: ['getValue'] } },
          description: 'Choose from the list, or specify a sensor path using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        },
        {
          displayName: 'Control Name or ID', name: 'sensor', type: 'options', required: true, default: '',
          typeOptions: { loadOptionsMethod: 'getControls', loadOptionsDependsOn: ['deviceKey'] },
          displayOptions: { show: { resource: ['device'], operation: ['sendCommand'] } },
          description: 'What to set — only controllable values are listed. Choose from the list, or specify a sensor path using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        },
        {
          displayName: 'Value', name: 'value', type: 'string', required: true, default: '',
          displayOptions: { show: { resource: ['device'], operation: ['sendCommand'] } },
          placeholder: 'true, 50, 21.5, {"hue":30,"saturation":80}',
          description: 'true/false for switches, a number for dimmers and set points; numbers and true/false are sent as such',
        },
        {
          displayName: 'Simplify', name: 'simplify', type: 'boolean', default: true,
          displayOptions: { show: { resource: ['device'], operation: ['get', 'getAll'] } },
          description: 'Whether to return { key, label, room, values } instead of the full device with sensor metadata',
        },
        {
          displayName: 'Filters', name: 'filters', type: 'collection', placeholder: 'Add Filter', default: {},
          displayOptions: { show: { resource: ['device'], operation: ['getAll'] } },
          options: [
            { displayName: 'Room', name: 'room', type: 'string', default: '', description: 'Only devices in this room' },
            { displayName: 'Key Starts With', name: 'prefix', type: 'string', default: '', placeholder: 'shelly/', description: 'Only devices whose key starts with this (the platform)' },
            { displayName: 'Search', name: 'q', type: 'string', default: '', description: 'Text in the device name or key' },
          ],
        },
        {
          displayName: 'Scene Name or ID', name: 'sceneId', type: 'options', required: true, default: '',
          typeOptions: { loadOptionsMethod: 'getScenes' },
          displayOptions: { show: { resource: ['scene'], operation: ['run'] } },
          description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        },
        {
          displayName: 'Flow Name or ID', name: 'flowId', type: 'options', required: true, default: '',
          typeOptions: { loadOptionsMethod: 'getFlows' },
          displayOptions: { show: { resource: ['flow'], operation: ['run'] } },
          description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        },
      ],
    };

    this.methods = {
      loadOptions: {
        async getDevices() {
          const list = await lshRequest.call(this, 'GET', '/devices');
          return (list || []).filter(Boolean).map((d) => ({ name: `${d.label || d.key}${d.room ? ` (${d.room})` : ''}`, value: d.key, description: d.key })).sort(byName);
        },
        async getSensors() {
          return sensorsOf.call(this, false);
        },
        async getControls() {
          return sensorsOf.call(this, true);
        },
        async getScenes() {
          return ((await lshRequest.call(this, 'GET', '/automation/scenes')) || []).map((s) => ({ name: s.name || s.id, value: s.id })).sort(byName);
        },
        async getFlows() {
          return ((await lshRequest.call(this, 'GET', '/automation/flows')) || []).map((f) => ({ name: f.name || f.id, value: f.id })).sort(byName);
        },
      },
    };
  }

  async execute() {
    const items = this.getInputData();
    const out = [];
    const resource = this.getNodeParameter('resource', 0);
    const operation = this.getNodeParameter('operation', 0);
    for (let i = 0; i < items.length; i++) {
      try {
        const push = (json) => (Array.isArray(json) ? json : [json]).forEach((j) => out.push({ json: j, pairedItem: { item: i } }));
        if (resource === 'device') {
          if (operation === 'getAll') {
            const f = this.getNodeParameter('filters', i, {});
            const simplify = this.getNodeParameter('simplify', i, true);
            const q = String(f.q || '').toLowerCase();
            const list = ((await lshRequest.call(this, 'GET', '/devices')) || []).filter(Boolean)
              .filter((d) => !f.room || String(d.room || '').toLowerCase() === String(f.room).toLowerCase())
              .filter((d) => !f.prefix || d.key.startsWith(f.prefix))
              .filter((d) => !q || `${d.label} ${d.key}`.toLowerCase().includes(q));
            push(list.map((d) => (simplify ? simplifyDevice(d) : d)));
          } else {
            const key = this.getNodeParameter('deviceKey', i);
            const enc = key.split('/').map(encodeURIComponent).join('/');
            if (operation === 'get') {
              const d = await lshRequest.call(this, 'GET', `/devices/${enc}`);
              push(this.getNodeParameter('simplify', i, true) ? simplifyDevice(d) : d);
            } else if (operation === 'getValue') {
              const sensor = this.getNodeParameter('sensor', i);
              const d = await lshRequest.call(this, 'GET', `/devices/${enc}`);
              const r = d.readings?.[sensor];
              push({ device: key, deviceLabel: d.label || key, sensor, label: r?.label || sensor, value: r ? r.value : null, unit: r?.unit || null, timestamp: r?.timestamp || null });
            } else if (operation === 'sendCommand') {
              const sensor = this.getNodeParameter('sensor', i);
              const value = parseValue(this.getNodeParameter('value', i));
              await lshRequest.call(this, 'POST', `/device/${enc}/command`, { sensor, value });
              push({ success: true, device: key, sensor, value });
            }
          }
        } else if (resource === 'scene' || resource === 'flow') {
          const base = resource === 'scene' ? '/automation/scenes' : '/automation/flows';
          if (operation === 'getAll') push(((await lshRequest.call(this, 'GET', base)) || []).map((x) => ({ id: x.id, name: x.name, ...(resource === 'flow' ? { enabled: x.enabled !== false } : {}) })));
          else {
            const id = this.getNodeParameter(resource === 'scene' ? 'sceneId' : 'flowId', i);
            const r = await lshRequest.call(this, 'POST', `${base}/${encodeURIComponent(id)}/run`, {});
            push({ success: true, [resource]: id, ...(r && typeof r === 'object' ? { result: r } : {}) });
          }
        }
      } catch (err) {
        if (this.continueOnFail()) { out.push({ json: { error: err.message }, pairedItem: { item: i } }); continue; }
        throw err;
      }
    }
    return [out];
  }
}

async function sensorsOf(controllableOnly) {
  const key = this.getCurrentNodeParameter('deviceKey');
  if (!key) return [];
  const d = await lshRequest.call(this, 'GET', `/devices/${String(key).split('/').map(encodeURIComponent).join('/')}`);
  return (d?.sensors || []).filter((s) => !controllableOnly || s.controllable)
    .map((s) => ({ name: `${s.label || s.name || s.path}${s.unit ? ` (${s.unit})` : ''}`, value: s.path, description: [s.path, s.type].filter(Boolean).join(' · ') }));
}

module.exports = { Lsh };
