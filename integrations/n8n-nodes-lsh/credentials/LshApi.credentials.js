'use strict';

// LSH address + an API token (LSH → Settings → API tokens). Commands, scenes
// and the trigger's webhook need an admin token.
class LshApi {
  constructor() {
    this.name = 'lshApi';
    this.displayName = 'LSH API';
    this.documentationUrl = 'https://github.com/dagoomax/lsh/tree/main/integrations/n8n-nodes-lsh';
    this.properties = [
      { displayName: 'LSH URL', name: 'baseUrl', type: 'string', default: '', placeholder: 'http://lsh.local:3000', required: true,
        description: 'The address n8n reaches LSH at, without /api' },
      { displayName: 'API Token', name: 'apiToken', type: 'string', typeOptions: { password: true }, default: '', required: true,
        description: 'Create one in LSH → Settings → API tokens' },
    ];
    this.authenticate = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiToken}}' } } };
    this.test = { request: { baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}', url: '/api/auth/me' } };
  }
}

module.exports = { LshApi };
