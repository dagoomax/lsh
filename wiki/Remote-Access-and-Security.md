# Remote Access & Security

‹ [Home](Home) · [Security & Authentication](Security) · [Quick Start](Quick-Start) ›

How to reach an LSH install from outside the LAN safely. LSH's own auth (JWT session cookie + static query-string API tokens) was designed for a **trusted LAN**, so the goal is to avoid exposing it directly to the internet.

## Deployment reality (reference install "casablanca")

- Production runs on a **Raspberry Pi 5** (`casablanca`, Debian/RPi OS) at LAN `192.168.1.229`, serving LSH on **port 3000** (`~/lsh/server.js`), alongside Node-RED.
- The Pi is on a **Tailscale** tailnet as `100.86.235.13` (`casablanca`). Other tailnet peers: `mac-mini-gumax`, phones, etc.
- HomeKit advertises over mDNS, so on Docker the container needs host networking (Linux only).

## Recommended: Tailscale, no public ports

The most secure remote proxy is **no public proxy at all**. Tailscale gives every one of your devices a private, encrypted path to the Pi with zero forwarded router ports.

**1. HTTPS via `tailscale serve`** (preferred over installing a separate proxy on the Pi):

```bash
sudo tailscale serve --bg https / http://localhost:3000
```

Result: `https://casablanca.<tailnet>.ts.net` with an automatically-renewed real certificate (no self-signed warnings on phones), reachable **only** from the tailnet. TLS is terminated on the Pi.

**2. Restrict access with Tailscale ACLs** (admin console → Access Controls):

```json
{
  "acls": [
    { "action": "accept", "src": ["autogroup:admin"], "dst": ["casablanca:443,3000,22"] }
  ]
}
```

Give additional users (e.g. a contractor) only `casablanca:443` — far safer than sharing token URLs.

**3. Firewall the LAN side** so plain HTTP stays local (Loxone needs it) plus the tailnet:

```bash
sudo apt install ufw
sudo ufw allow from 192.168.1.0/24 to any port 3000
sudo ufw allow in on tailscale0
sudo ufw allow from 192.168.1.0/24 to any port 22
sudo ufw enable
```

## Harden SSH (do this)

Password auth invites brute-force. Since key auth already works:

- Set `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `sudo systemctl restart ssh`.
- **Or** enable Tailscale SSH (`sudo tailscale set --ssh`) and let tailnet identity replace keys entirely.
- **Check the router** for any existing port-forwards to the Pi (22/3000/…) and remove them — Tailscale makes them unnecessary. An internet-exposed SSH with a weak password is compromised within hours.

## Alternative: a public reverse proxy (only if unavoidable)

If someone without Tailscale must have access, do **not** open a raw port. Use one of:

- **Cloudflare Tunnel + Cloudflare Access** — no inbound ports; put an identity policy (email OTP / SSO) in front of the dashboard.
- **Reverse proxy (Caddy/nginx) terminating TLS** — only behind an authenticating layer, never exposing LSH's query-string tokens to the open internet (they leak into access logs).

A local-only Caddy config (used on the dev Mac) that terminates TLS and proxies to LSH:

```caddyfile
{
    local_certs
}
https://localhost, https://lsh.local, https://192.168.1.56 {
    reverse_proxy 127.0.0.1:3001
    encode gzip
}
http:// {
    redir https://{host}{uri} permanent
}
```

Run `caddy trust` once so browsers accept the local CA (also unblocks microphone access for the [SIP softphone](Cameras-and-SIP) without cert warnings).

**Avoid** Tailscale **Funnel** for permanent dashboard access — it makes the URL publicly reachable (fine only for a quick demo).

## API token hygiene

- One token **per consumer** (`loxone`, a per-person token, etc.) so you can revoke one without breaking others — see [Security & Authentication](Security).
- Rotate periodically; delete stale tokens in **Settings → API Tokens**.
- **Any exported document (PDF/XML) that embeds a token is a secret** — treat those files like passwords. Deleting the token invalidates every URL derived from it.
