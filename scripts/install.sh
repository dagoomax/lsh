#!/bin/bash
# Fresh LSH install — core only. Integrations are fetched from GitHub on
# demand afterwards (src/module-manager.js): automatically at startup for
# anything configured in config.json, or from Settings → Integration Modules.
#
#   curl -fsSL https://raw.githubusercontent.com/dagoomax/lsh/main/scripts/install.sh | bash -s -- [dir] [ref]
#
#   dir  install directory (default: ./lsh)
#   ref  git tag/branch (default: main)
set -euo pipefail

REPO="dagoomax/lsh"
DIR="${1:-lsh}"
REF="${2:-main}"

command -v node >/dev/null || { echo "✗ Node.js not found — install v18+ from https://nodejs.org"; exit 1; }
command -v npm  >/dev/null || { echo "✗ npm not found"; exit 1; }
[ -e "$DIR" ] && { echo "✗ $DIR already exists"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Downloading $REPO@$REF"
curl -fsSL -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/tarball/$REF" | tar -xz -C "$TMP" --strip-components=1

# Drop every integration module file (modules.json → modules.*.files) —
# core files are never listed there.
node -e '
  const fs = require("fs"), path = require("path");
  const root = process.argv[1];
  const m = JSON.parse(fs.readFileSync(path.join(root, "modules.json"), "utf8"));
  const core = new Set(m.core);
  let n = 0;
  for (const mod of Object.values(m.modules))
    for (const f of mod.files)
      if (!core.has(f) && fs.existsSync(path.join(root, f))) { fs.unlinkSync(path.join(root, f)); n++; }
  console.log(`→ Core only: left out ${n} integration file(s)`);
' "$TMP"

mv "$TMP" "$DIR"
trap - EXIT
cd "$DIR"

echo "→ Installing core npm dependencies"
npm install --omit=dev --no-audit --no-fund

[ -f config.json ] || cp config.minimal.json config.json 2>/dev/null || cp config.example.json config.json

echo ""
echo "✓ LSH core installed in $DIR"
echo "  Start:  cd $DIR && npm start"
echo "  Configure integrations in Settings; their modules download automatically."
