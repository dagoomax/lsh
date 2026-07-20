# LSH — Home Assistant add-on

*Polska instrukcja instalacji: [`INSTALACJA.md`](INSTALACJA.md).*

Packages LSH as a Home Assistant Supervisor app/add-on, for running it directly on Home Assistant OS instead of on separate hardware/Docker host. See `../README.md` (`## Docker`) for the plain-Docker deployment this mirrors, and the top-level conversation/README for why you'd run LSH alongside Home Assistant at all — short version: LSH's ~40 integrations plus HomeKit bridge run in ~80–130 MB as a single process, and Home Assistant can consume LSH's devices over its REST API.

## Install

1. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ (top right) → Repositories**.
2. Add the plain repo URL: `https://github.com/dagoomax/lsh` — not a `/tree/...` link, Supervisor needs a git-clonable URL. It reads `repository.yaml` at the repo root, then finds `haos-addon/lsh/config.yaml` automatically (add-on config discovery is a recursive glob, unlike the repo-manifest lookup, which only checks the root).
3. The **LSH** add-on appears in the store. Install it, then start it.
4. First start clones and builds LSH from GitHub (a few minutes) — see `lsh/DOCS.md` for what happens after that, port list, and data-persistence details.

## Why it's structured this way

- **`../repository.yaml`** (repo root, not this folder) — the repo-level manifest Supervisor reads when you add this URL as a custom repository. It has to sit at the true git root: Supervisor's repository-manifest lookup checks only `<repo root>/repository.yaml`, not subfolders — unlike add-on `config.yaml` discovery, which recurses and finds `lsh/config.yaml` wherever it lives.
- **`lsh/config.yaml`** — the add-on manifest (name, ports/networking, watchdog, persistence).
- **`lsh/Dockerfile`** — builds the image. It clones LSH's own source from `github.com/dagoomax/lsh` at build time rather than copying local files, because Supervisor scopes each add-on's Docker build context to its own folder — it can't see `../../src`, `../../package.json`, etc. even though this Dockerfile lives inside the same repo. It deliberately keeps the same Debian base and native-module toolchain as the repo-root `Dockerfile` (not Home Assistant's Alpine base image) — LSH compiles native deps via node-gyp, and re-deriving that under musl/apk wasn't worth the risk for this wrapper.
- **`lsh/run.sh`** — bridges Supervisor's single persistent `/data` directory to the paths LSH's own code expects (`/app/config.json`, `/app/persist`, `/app/certs`), via symlinks, seeding `config.json` from the example on first run.

## Known limitations

- No Supervisor `options`/`schema` panel — configure LSH through its own Settings UI, same as any other LSH deployment.
- No Ingress (sidebar-embedded UI) — reached directly on its own port.
- Declares `amd64` and `aarch64` only; armv7 (32-bit Pi) isn't tested against LSH's native-module build.
