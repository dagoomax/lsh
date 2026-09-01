// Embedded coding-assistant chat: calls the real Anthropic API (Claude Opus 5
// by default) with file read/write/list + bash tools scoped to this repo.
// This is genuinely capable of modifying the running application's own code
// — LSH also controls door locks and the alarm panel (satel-client.js,
// homekit-bridge.js) — so access is deliberately narrowed on top of the
// existing admin-only gate (see requireAdmin in api-routes.js):
//
//   1. LAN/localhost only (isLocalRequest below) — never reachable over a
//      remote-access tunnel (Tailscale et al. use the 100.64.0.0/10 CGNAT
//      range, explicitly excluded even though it "looks" private).
//   2. Every file tool is confined to this repo via resolveInRepo() — same
//      containment check regardless of what the model asks for.
//   3. Nothing here auto-restarts the server or touches git — those stay
//      manual follow-up steps (the Settings "Restart Server" button, or the
//      user's own git commands), so a bad turn can't also take the running
//      instance down or push anything.
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');

const REPO_ROOT = path.join(__dirname, '..');

// config.js exports the *loadConfig function*, not a resolved object —
// server.js is the only caller that invokes it. Every other module in this
// codebase reads config.json fresh via its own helper (see readConfigFile()
// in api-routes.js) rather than requiring config.js directly, so do the
// same here instead of `require('../config')`, which would silently hand
// back the function itself (config.claudeCode would always be undefined).
function readClaudeCodeConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config.json'), 'utf8'));
  } catch { /* no config.json yet */ }
  const cc = fileConfig.claudeCode || {};
  return {
    enabled: !!cc.enabled,
    apiKey: process.env.ANTHROPIC_API_KEY || cc.apiKey || '',
    model: cc.model || 'claude-opus-5',
    // Only needed for an identity-linked personal API key (vs. one created
    // directly inside a workspace, which never needs this) — see the
    // anthropic-workspace-id 400 this unblocks. wrkspc_... format.
    workspaceId: cc.workspaceId || '',
  };
}
const MAX_FILE_READ_BYTES = 300 * 1024;
const MAX_BASH_OUTPUT = 40 * 1024;
const BASH_TIMEOUT_MS = 120 * 1000;

// ── Access control ──────────────────────────────────────────

// req.ip reflects the direct TCP peer (server.js never sets `trust proxy`),
// so this can't be spoofed via X-Forwarded-For — check the socket, not a
// header, on purpose.
function isLocalRequest(req) {
  const addr = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (addr === '127.0.0.1' || addr === '::1' || addr === 'localhost') return true;

  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  // Deliberately NOT allowed: 100.64.0.0/10 (CGNAT / Tailscale) — that's
  // exactly the "remote access" path this feature must stay off of.
  return false;
}

// ── Path safety (shared by every file tool) ─────────────────

function resolveInRepo(relPath) {
  const resolved = path.resolve(REPO_ROOT, relPath || '.');
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`Path escapes the repository root: ${relPath}`);
  }
  return resolved;
}

// ── Tools ────────────────────────────────────────────────────

const tools = [
  betaTool({
    name: 'read_file',
    description:
      'Read a text file from the LSH repository. Path is relative to the repo root (e.g. "src/api-routes.js"). ' +
      `Truncates files over ${MAX_FILE_READ_BYTES / 1024}KB — for large files, use bash (grep/sed) to read a range instead.`,
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative file path' } },
      required: ['path'],
    },
    run: async ({ path: relPath }) => {
      const full = resolveInRepo(relPath);
      const buf = fs.readFileSync(full);
      const truncated = buf.length > MAX_FILE_READ_BYTES;
      const text = buf.subarray(0, MAX_FILE_READ_BYTES).toString('utf8');
      return truncated ? `${text}\n\n[... truncated, file is ${buf.length} bytes]` : text;
    },
  }),

  betaTool({
    name: 'write_file',
    description:
      'Write (create or overwrite) a text file in the LSH repository. Path is relative to the repo root. ' +
      'Creates parent directories as needed. Prefer this over bash heredocs for anything more than a one-liner.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative file path' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
    run: async ({ path: relPath, content }) => {
      const full = resolveInRepo(relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${relPath}`;
    },
  }),

  betaTool({
    name: 'list_dir',
    description: 'List a directory in the LSH repository. Path is relative to the repo root; "." for the repo root itself.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative directory path', default: '.' } },
      required: [],
    },
    run: async ({ path: relPath }) => {
      const full = resolveInRepo(relPath || '.');
      const entries = fs.readdirSync(full, { withFileTypes: true });
      return entries
        .map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`)
        .sort()
        .join('\n') || '(empty directory)';
    },
  }),

  betaTool({
    name: 'bash',
    description:
      'Run a shell command in the LSH repository root (e.g. npm run build, node --check, grep, git diff, git status). ' +
      `Runs with a ${BASH_TIMEOUT_MS / 1000}s timeout. Output is captured, not interactive — don't run commands that wait for input.`,
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command to run' } },
      required: ['command'],
    },
    run: async ({ command }) => {
      console.log(`[ClaudeCode] bash: ${command}`);
      return new Promise((resolve) => {
        exec(command, { cwd: REPO_ROOT, timeout: BASH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          let out = `$ ${command}\n`;
          if (stdout) out += stdout;
          if (stderr) out += (stdout ? '\n' : '') + `[stderr]\n${stderr}`;
          if (err) out += `\n[exit code ${err.code ?? 1}${err.killed ? ', killed (timeout)' : ''}]`;
          if (out.length > MAX_BASH_OUTPUT) {
            out = out.slice(0, MAX_BASH_OUTPUT) + `\n[... output truncated at ${MAX_BASH_OUTPUT / 1024}KB]`;
          }
          resolve(out);
        });
      });
    },
  }),
];

const SYSTEM_PROMPT = `You are an embedded coding assistant inside the LSH ("Lightweight Smart Home") dashboard, \
helping the person running this install customize their own LSH instance — from small CSS/config tweaks up to \
writing new integration drivers. You're working directly in the live repository at ${REPO_ROOT} via the \
read_file/write_file/list_dir/bash tools; there is no separate staging copy.

Project shape (see CLAUDE.md and README.md in the repo root for the full picture): plain CommonJS Node, no build \
step for the server itself; server.js is the composition root; src/*-client.js files are the integration-client \
pattern (constructor(config, store, sensorRegistry), async start(), stop()); react-dashboard/ is a separate Vite \
React app that needs \`npm run build\` after changes (dist/ is committed). Read CLAUDE.md and relevant existing \
code before writing anything, to match the codebase's actual conventions rather than inventing your own.

This process controls physical things — door locks, an alarm panel, HomeKit. Be precise and conservative with \
bash commands that change system state. You are not able to restart the server or push to git yourself — after \
code changes, tell the user what to do next (e.g. "restart the server from Settings to pick this up") rather than \
attempting it.`;

// ── Conversation state ──────────────────────────────────────
// Single shared conversation (this is a local-admin tool, not a multi-tenant
// chat product) — reset via resetConversation(). Lost on process restart,
// same as any other in-memory state in this app.
let history = [];

function getHistory() {
  return history;
}

function resetConversation() {
  history = [];
}

async function sendMessage(userText) {
  const cc = readClaudeCodeConfig();
  if (!cc.enabled) throw new Error('Claude Code chat is not enabled (config.claudeCode.enabled)');
  if (!cc.apiKey) throw new Error('No Anthropic API key configured (config.claudeCode.apiKey or ANTHROPIC_API_KEY)');

  const client = new Anthropic({
    apiKey: cc.apiKey,
    ...(cc.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': cc.workspaceId } } : {}),
  });

  history.push({ role: 'user', content: userText });

  const runner = client.beta.messages.toolRunner({
    model: cc.model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools,
    messages: history,
    max_iterations: 30,
  });

  const toolLog = [];
  let finalMessage = null;
  for await (const message of runner) {
    finalMessage = message;
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolLog.push({ name: block.name, input: block.input });
      }
    }
  }

  history = runner.params.messages;

  const replyText = (finalMessage?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n');

  return { reply: replyText, toolLog, stopReason: finalMessage?.stop_reason || null };
}

module.exports = { isLocalRequest, sendMessage, getHistory, resetConversation, readClaudeCodeConfig };
