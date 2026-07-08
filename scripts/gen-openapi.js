'use strict';
// Generate public/openapi.json from src/api-routes.js — a faithful OpenAPI 3.0
// description of the live LSH REST API. Re-run after adding/removing routes:
//   node scripts/gen-openapi.js
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'src', 'api-routes.js');
const OUT = path.join(__dirname, '..', 'public', 'openapi.json');
const pkg = require('../package.json');

const src = fs.readFileSync(ROUTES, 'utf8').split('\n');

const sectionRe = /^\s*\/\/\s*[─-]+\s*(.+?)\s*[─-]+\s*$/;
const routeRe   = /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/;

let tag = 'General';
const items = [];
for (const line of src) {
  const sm = line.match(sectionRe);
  if (sm) { tag = sm[1].trim(); continue; }
  const rm = line.match(routeRe);
  if (rm) items.push({ method: rm[1], raw: rm[2], tag });
}

// Express path → OpenAPI path + params. Strips regex/wildcard modifiers:
//   /devices/:deviceKey(*)          -> /devices/{deviceKey}
//   /satel/partition/:num/:action(arm|disarm) -> /satel/partition/{num}/{action}
function convert(raw) {
  const params = [];
  const p = raw.replace(/:([A-Za-z0-9_]+)(\([^)]*\))?/g, (_, name) => {
    params.push(name);
    return `{${name}}`;
  });
  return { openapiPath: p, params };
}

const titleCase = s => s.replace(/(^|[\s/])([a-z])/g, (_, a, b) => a + b.toUpperCase());

const paths = {};
const tagSet = new Map();
for (const it of items) {
  const { openapiPath, params } = convert(it.raw);
  tagSet.set(it.tag, (tagSet.get(it.tag) || 0) + 1);
  if (!paths[openapiPath]) paths[openapiPath] = {};

  const words = it.raw.replace(/[/:()*|]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const summary = `${it.method.toUpperCase()} ${it.raw}`;

  const op = {
    tags: [it.tag],
    summary,
    operationId: `${it.method}_${it.raw.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    parameters: params.map(name => ({
      name, in: 'path', required: true,
      schema: { type: 'string' },
      description: name === 'deviceKey' ? 'Device key (slashes URL-encoded, e.g. fibaro%2Froom_443)' : undefined,
    })),
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } },
      401: { description: 'Authentication required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
    },
  };

  if (it.method === 'post' || it.method === 'put' || it.method === 'patch') {
    op.requestBody = { required: false, content: { 'application/json': { schema: { type: 'object' } } } };
  }
  // trim undefined param descriptions
  op.parameters.forEach(p => { if (p.description === undefined) delete p.description; });
  if (op.parameters.length === 0) delete op.parameters;

  paths[openapiPath][it.method] = op;
}

const tags = [...tagSet.entries()].map(([name, count]) => ({ name, description: `${count} endpoint${count > 1 ? 's' : ''}` }));

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'LSH — LoxoneSwaggerHelper API',
    version: pkg.version || '1.0.0',
    description:
      'REST API for the LSH smart-home hub (Victron Energy, 30+ integrations, relays, ' +
      'cameras, SIP intercom, HomeKit, and a two-way Loxone bridge).\n\n' +
      '**Auth:** every endpoint (except `POST /auth/login` and `POST /auth/setup`) requires ' +
      'either the `lsh-session` cookie (from a browser login) or an API token. Pass the token ' +
      'as `?token=<value>` (Loxone-friendly) or as `Authorization: Bearer <value>`. Create ' +
      'tokens in the dashboard under Settings → API Tokens.\n\n' +
      '**Envelope:** JSON endpoints reply `{ "success": true, "data": … }` or ' +
      '`{ "success": false, "error": "…" }`. Binary endpoints (snapshots, XML, logs) return ' +
      'their native content type.\n\n' +
      `Generated from \`src/api-routes.js\` — ${items.length} endpoints.`,
    license: { name: 'Repository', url: 'https://github.com/dagoomax/lsh' },
  },
  servers: [
    { url: '/api', description: 'This LSH server' },
    { url: 'http://192.168.1.229:3000/api', description: 'Casablanca (LAN)' },
  ],
  tags,
  security: [{ tokenQuery: [] }, { bearerAuth: [] }, { cookieAuth: [] }],
  paths,
  components: {
    securitySchemes: {
      tokenQuery: { type: 'apiKey', in: 'query', name: 'token', description: 'API token as ?token=' },
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'API token or JWT' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'lsh-session', description: 'Browser session cookie' },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true }, data: {} },
        required: ['success'],
      },
      ApiError: {
        type: 'object',
        properties: { success: { type: 'boolean', example: false }, error: { type: 'string' } },
        required: ['success'],
      },
    },
  },
};

fs.writeFileSync(OUT, JSON.stringify(spec, null, 2));
console.log(`Wrote ${OUT}: ${items.length} endpoints, ${tags.length} tags`);
console.log('Tags:', [...tagSet.keys()].join(', '));
