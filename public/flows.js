// Node-RED-style flow editor for LSH automations.
(function () {
  const OPS = ['>', '<', '>=', '<=', '==', '!=', 'changes'];
  const ICONS = { trigger: '⚡', condition: '⌥', device: '🔌', relay: '⏻', notify: '🔔', scene: '✨', delay: '⏱', debug: '🐞' };

  // Node type catalogue: colour, output count, and the config fields to render.
  const TYPES = {
    trigger: {
      label: 'Trigger', color: '#ff9838', outs: 1,
      fields: (n) => [
        field('Store key', 'text', n, 'key', { list: 'store-keys', ph: 'battery/soc' }),
        row([
          select('When', n, 'op', OPS, 'changes'),
          field('Value', 'text', n, 'value', { ph: '20' }),
        ]),
      ],
    },
    condition: {
      label: 'Condition', color: '#ffc53d', outs: 2,
      fields: (n) => [row([ select('Op', n, 'op', OPS.filter(o => o !== 'changes'), '>'),
                            field('Value', 'text', n, 'value', { ph: '30' }) ]),
                      hint('output 1 = matches · output 2 = else')],
    },
    device: {
      label: 'Device', color: '#4a9dff', outs: 1,
      fields: (n) => [
        field('Device key', 'text', n, 'deviceKey', { list: 'device-keys', ph: 'shelly/…' }),
        row([ field('Sensor', 'text', n, 'sensor', { ph: 'switch' }),
              field('Value', 'text', n, 'value', { ph: 'on' }) ]),
      ],
    },
    relay: {
      label: 'Relay', color: '#2ee66b', outs: 1,
      fields: (n) => [row([ field('Index', 'number', n, 'index', { ph: '0' }),
                            select('State', n, 'on', ['on', 'off'], 'on', v => v === 'on') ])],
    },
    notify: {
      label: 'Notify', color: '#a875ff', outs: 1,
      fields: (n) => [ select('Level', n, 'level', ['info', 'warning', 'critical'], 'info'),
                       field('Message', 'text', n, 'message', { ph: 'SOC is {value}%' }) ],
    },
    scene: {
      label: 'Scene', color: '#ff5db1', outs: 1,
      fields: (n) => [ selectDynamic('Scene', n, 'sceneId', () => SCENES.map(s => [s.id, s.name])) ],
    },
    delay: {
      label: 'Delay', color: '#8ea2ff', outs: 1,
      fields: (n) => [ field('Seconds', 'number', n, 'seconds', { ph: '5' }) ],
    },
    debug: {
      label: 'Debug', color: '#22d3ee', outs: 0,
      fields: (n) => [ field('Name', 'text', n, 'name', { ph: 'debug 1' }),
                       hint('Wire a node into this to watch its message below.') ],
    },
  };

  let FLOWS = [];
  let SCENES = [];
  let current = null; // { id, name, enabled, nodes: [] }

  const GRID = 22;
  let gridOn = localStorage.getItem('flow-grid') !== '0'; // default on
  const snap = (v) => (gridOn ? Math.round(v / GRID) * GRID : v);

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas'), wires = $('wires'), wrap = $('canvas-wrap');

  function applyGrid() {
    wrap.classList.toggle('grid', gridOn);
    const cb = $('grid-toggle'); if (cb) cb.checked = gridOn;
  }

  // ── Config field builders (return {label, el, sync}) ──────────────────────
  function field(label, type, node, key, opts = {}) {
    const inp = document.createElement('input');
    inp.type = type; if (opts.ph) inp.placeholder = opts.ph; if (opts.list) inp.setAttribute('list', opts.list);
    inp.value = node.config[key] ?? '';
    inp.addEventListener('input', () => { node.config[key] = type === 'number' ? Number(inp.value) : inp.value; });
    return wrapField(label, inp);
  }
  function select(label, node, key, options, def, map) {
    const sel = document.createElement('select');
    for (const o of options) { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; sel.appendChild(opt); }
    const cur = node.config[key];
    sel.value = (map ? options.find(o => map(o) === cur) : cur) ?? def;
    node.config[key] = map ? map(sel.value) : sel.value;
    sel.addEventListener('change', () => { node.config[key] = map ? map(sel.value) : sel.value; });
    return wrapField(label, sel);
  }
  function selectDynamic(label, node, key, getPairs) {
    const sel = document.createElement('select');
    for (const [val, txt] of getPairs()) { const o = document.createElement('option'); o.value = val; o.textContent = txt; sel.appendChild(o); }
    if (node.config[key]) sel.value = node.config[key]; else node.config[key] = sel.value;
    sel.addEventListener('change', () => { node.config[key] = sel.value; });
    return wrapField(label, sel);
  }
  function wrapField(label, el) {
    const l = document.createElement('label'); l.textContent = label;
    const w = document.createElement('div'); w.appendChild(l); w.appendChild(el); return w;
  }
  function row(children) { const r = document.createElement('div'); r.className = 'fn-row'; children.forEach(c => r.appendChild(c)); return r; }
  function hint(text) { const h = document.createElement('div'); h.style.cssText = 'font-size:10px;color:var(--text-muted)'; h.textContent = text; return h; }

  // ── Node rendering ────────────────────────────────────────────────────────
  function renderNode(node) {
    const t = TYPES[node.type];
    const el = document.createElement('div');
    el.className = 'flow-node'; el.dataset.id = node.id;
    el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
    el.style.setProperty('--nc', t.color); // node colour drives border glow, ports, wires

    const head = document.createElement('div');
    head.className = 'fn-head';
    head.innerHTML = `<span class="fn-ico">${ICONS[node.type] || '●'}</span><span class="fn-title">${t.label}</span><span class="fn-del" title="Delete">✕</span>`;
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'fn-body';
    t.fields(node).forEach(f => body.appendChild(f));
    el.appendChild(body);

    // input port (all node types accept input, harmless on triggers)
    const pin = document.createElement('div'); pin.className = 'port in'; pin.dataset.node = node.id; pin.dataset.dir = 'in';
    el.appendChild(pin);
    // output port(s)
    for (let p = 0; p < t.outs; p++) {
      const pout = document.createElement('div'); pout.className = 'port out';
      pout.dataset.node = node.id; pout.dataset.dir = 'out'; pout.dataset.port = p;
      pout.style.top = t.outs === 1 ? '18px' : (14 + p * 22) + 'px';
      el.appendChild(pout);
    }

    head.querySelector('.fn-del').addEventListener('click', (e) => { e.stopPropagation(); deleteNode(node.id); });
    head.addEventListener('mousedown', (e) => startNodeDrag(e, node, el));
    canvas.appendChild(el);
  }

  function renderAll() {
    canvas.querySelectorAll('.flow-node').forEach(n => n.remove());
    if (current) current.nodes.forEach(renderNode);
    $('empty-hint').style.display = (current && current.nodes.length) ? 'none' : 'block';
    renderWires();
  }

  // ── Wires ─────────────────────────────────────────────────────────────────
  function portCenter(nodeId, dir, port = 0) {
    const sel = dir === 'in'
      ? `.port.in[data-node="${nodeId}"]`
      : `.port.out[data-node="${nodeId}"][data-port="${port}"]`;
    const el = canvas.querySelector(sel);
    if (!el) return null;
    const cr = canvas.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
  }
  function wirePath(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }
  function renderWires(temp) {
    wires.innerHTML = '';
    if (current) {
      for (const node of current.nodes) {
        const color = (TYPES[node.type] || {}).color || 'var(--accent)';
        (node.wires || []).forEach((targets, port) => {
          for (const tid of targets || []) {
            const a = portCenter(node.id, 'out', port), b = portCenter(tid, 'in');
            if (!a || !b) continue;
            const d = wirePath(a, b);
            // glowing base wire in the source node's colour
            const base = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            base.setAttribute('class', 'flow-wire'); base.setAttribute('d', d);
            base.style.stroke = color; base.style.filter = `drop-shadow(0 0 5px ${color})`;
            base.addEventListener('click', () => { removeWire(node.id, port, tid); });
            wires.appendChild(base);
            // animated light travelling along the wire
            const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            flow.setAttribute('class', 'flow-wire-anim'); flow.setAttribute('d', d);
            wires.appendChild(flow);
          }
        });
      }
    }
    if (temp) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'flow-wire-temp'); path.setAttribute('d', wirePath(temp.a, temp.b));
      wires.appendChild(path);
    }
  }
  function removeWire(fromId, port, toId) {
    const node = current.nodes.find(n => n.id === fromId);
    node.wires[port] = (node.wires[port] || []).filter(id => id !== toId);
    renderWires();
  }

  // ── Node drag ─────────────────────────────────────────────────────────────
  function startNodeDrag(e, node, el) {
    e.preventDefault();
    const cr = canvas.getBoundingClientRect();
    const ox = e.clientX - cr.left - node.x, oy = e.clientY - cr.top - node.y;
    function move(ev) {
      node.x = Math.max(0, snap(ev.clientX - cr.left - ox));
      node.y = Math.max(0, snap(ev.clientY - cr.top - oy));
      el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
      renderWires();
    }
    function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  // ── Wire drag (connect) ───────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    const port = e.target.closest('.port.out');
    if (!port) return;
    e.preventDefault();
    const fromId = port.dataset.node, fromPort = Number(port.dataset.port);
    const cr = canvas.getBoundingClientRect();
    const a = portCenter(fromId, 'out', fromPort);
    function move(ev) { renderWires({ a, b: { x: ev.clientX - cr.left, y: ev.clientY - cr.top } }); }
    function up(ev) {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      const inPort = ev.target.closest ? ev.target.closest('.port.in') : null;
      if (inPort && inPort.dataset.node !== fromId) {
        const node = current.nodes.find(n => n.id === fromId);
        node.wires[fromPort] = node.wires[fromPort] || [];
        if (!node.wires[fromPort].includes(inPort.dataset.node)) node.wires[fromPort].push(inPort.dataset.node);
      }
      renderWires();
    }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });

  // ── Add / delete node ─────────────────────────────────────────────────────
  function addNode(type) {
    if (!current) newFlow();
    const t = TYPES[type];
    const scrollX = wrap.scrollLeft, scrollY = wrap.scrollTop;
    const node = { id: 'n' + Math.random().toString(36).slice(2, 8), type, config: {},
      x: snap(scrollX + 80 + (current.nodes.length % 5) * 30), y: snap(scrollY + 80 + (current.nodes.length % 5) * 30),
      wires: Array.from({ length: t.outs }, () => []) };
    current.nodes.push(node);
    renderNode(node);
    $('empty-hint').style.display = 'none';
  }
  function deleteNode(id) {
    current.nodes = current.nodes.filter(n => n.id !== id);
    for (const n of current.nodes) n.wires = (n.wires || []).map(w => (w || []).filter(t => t !== id));
    renderAll();
  }

  // ── Flow management ───────────────────────────────────────────────────────
  function newFlow() {
    current = { id: null, name: 'New flow', enabled: true, nodes: [] };
    $('flow-name').value = current.name; $('flow-enabled').checked = true;
    $('flow-select').value = '__new';
    renderAll();
  }
  function selectFlow(id) {
    const f = FLOWS.find(x => x.id === id);
    if (!f) return newFlow();
    current = JSON.parse(JSON.stringify(f));
    current.nodes = current.nodes || [];
    $('flow-name').value = current.name; $('flow-enabled').checked = current.enabled !== false;
    renderAll();
  }
  function renderFlowList() {
    const sel = $('flow-select'); sel.innerHTML = '';
    for (const f of FLOWS) { const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; sel.appendChild(o); }
    const on = document.createElement('option'); on.value = '__new'; on.textContent = '— New flow —'; sel.appendChild(on);
    if (current && current.id) sel.value = current.id; else sel.value = '__new';
  }

  async function saveFlow() {
    if (!current) return;
    current.name = $('flow-name').value.trim() || 'Flow';
    current.enabled = $('flow-enabled').checked;
    const res = await fetch('/api/automation/flows', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current),
    });
    const j = await res.json();
    const rEl = $('flow-result');
    if (j.success) {
      current = j.data;
      await loadFlows(); renderFlowList(); $('flow-select').value = current.id;
      rEl.textContent = '✓ Deployed'; rEl.className = 'test-result ok';
    } else { rEl.textContent = '✗ ' + j.error; rEl.className = 'test-result err'; }
    setTimeout(() => { rEl.textContent = ''; }, 3000);
  }
  async function testFlow() {
    if (!current || !current.id) { await saveFlow(); }
    if (!current.id) return;
    const res = await fetch(`/api/automation/flows/${current.id}/run`, { method: 'POST' });
    const j = await res.json();
    const rEl = $('flow-result');
    rEl.textContent = j.success ? '✓ Test fired' : '✗ ' + j.error;
    rEl.className = 'test-result ' + (j.success ? 'ok' : 'err');
    setTimeout(() => { rEl.textContent = ''; }, 3000);
  }
  async function deleteFlow() {
    if (!current || !current.id) return newFlow();
    if (!confirm(`Delete flow "${current.name}"?`)) return;
    await fetch(`/api/automation/flows/${current.id}`, { method: 'DELETE' });
    await loadFlows(); renderFlowList();
    if (FLOWS.length) selectFlow(FLOWS[0].id); else newFlow();
  }

  async function loadFlows() {
    try { const r = await fetch('/api/automation/flows'); const j = await r.json(); FLOWS = j.data || []; } catch { FLOWS = []; }
  }

  // ── Palette + data ────────────────────────────────────────────────────────
  function buildPalette() {
    const p = $('palette');
    for (const [type, t] of Object.entries(TYPES)) {
      const b = document.createElement('button');
      b.className = 'palette-node';
      b.innerHTML = `<span class="dot" style="background:${t.color};box-shadow:0 0 9px ${t.color}"></span>${ICONS[type] || ''} ${t.label}`;
      b.style.setProperty('--pc', t.color);
      b.addEventListener('click', () => addNode(type));
      p.appendChild(b);
    }
  }
  async function loadData() {
    // store keys + device keys for the datalists, scenes for the scene node
    try {
      const dl1 = document.createElement('datalist'); dl1.id = 'store-keys';
      const dl2 = document.createElement('datalist'); dl2.id = 'device-keys';
      const r = await fetch('/api/devices'); const j = await r.json();
      const keys = new Set(), devs = new Set();
      for (const d of j.data || []) {
        devs.add(d.key);
        for (const path of Object.keys(d.readings || {})) keys.add(`${d.key}/${path}`);
      }
      [...keys].sort().forEach(k => { const o = document.createElement('option'); o.value = k; dl1.appendChild(o); });
      [...devs].sort().forEach(k => { const o = document.createElement('option'); o.value = k; dl2.appendChild(o); });
      document.body.appendChild(dl1); document.body.appendChild(dl2);
    } catch {}
    try { const r = await fetch('/api/automation/scenes'); const j = await r.json(); SCENES = j.data || []; } catch {}
  }

  // ── Debug panel (live tap output via Socket.IO) ───────────────────────────
  let dbgCount = 0;
  function setupDebug() {
    const log = $('debug-log'), countEl = $('debug-count'), panel = $('debug-panel');
    $('debug-clear').addEventListener('click', () => { log.innerHTML = ''; dbgCount = 0; countEl.textContent = '0'; });
    $('debug-toggle').addEventListener('click', () => {
      const c = panel.classList.toggle('collapsed');
      $('debug-toggle').textContent = c ? '▴' : '▾';
    });
    if (typeof io === 'undefined') return;
    let socket;
    try { socket = io(); } catch { return; }
    socket.on('flow-debug', (d) => {
      const empty = log.querySelector('.dbg-empty'); if (empty) empty.remove();
      const row = document.createElement('div'); row.className = 'dbg-row';
      const t = new Date(d.time || Date.now()).toLocaleTimeString();
      const val = typeof d.payload === 'object' ? JSON.stringify(d.payload) : String(d.payload);
      row.innerHTML = `<span class="dbg-time">${t}</span>`
        + `<span class="dbg-name">${escapeHtml(d.label || 'debug')}</span>`
        + `<span class="dbg-msg">${d.key ? `<span class="k">${escapeHtml(d.key)}</span> = ` : ''}<span class="v">${escapeHtml(val)}</span></span>`;
      log.insertBefore(row, log.firstChild);
      while (log.children.length > 200) log.removeChild(log.lastChild);
      countEl.textContent = String(++dbgCount);
      if (panel.classList.contains('collapsed')) { panel.classList.remove('collapsed'); $('debug-toggle').textContent = '▾'; }
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ── Boot ──────────────────────────────────────────────────────────────────
  (async function init() {
    buildPalette();
    applyGrid();
    setupDebug();
    await loadData();
    await loadFlows();
    if (FLOWS.length) selectFlow(FLOWS[0].id); else newFlow();
    renderFlowList();

    $('flow-select').addEventListener('change', (e) => e.target.value === '__new' ? newFlow() : selectFlow(e.target.value));
    $('btn-new-flow').addEventListener('click', () => { newFlow(); renderFlowList(); });
    $('btn-save-flow').addEventListener('click', saveFlow);
    $('btn-test-flow').addEventListener('click', testFlow);
    $('btn-del-flow').addEventListener('click', deleteFlow);
    $('grid-toggle').addEventListener('change', (e) => {
      gridOn = e.target.checked;
      localStorage.setItem('flow-grid', gridOn ? '1' : '0');
      applyGrid();
    });
    window.addEventListener('resize', () => renderWires());
    wrap.addEventListener('scroll', () => renderWires());
  })();
})();
