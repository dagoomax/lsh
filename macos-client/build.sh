#!/bin/bash
# Build the native macOS LSH client into build/LSH.app.
# Requires only the Xcode command-line tools (swiftc, iconutil, sips).
set -euo pipefail
cd "$(dirname "$0")"

APP=build/LSH.app
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# App icon from the dashboard logo (skipped if the SVG can't be rendered)
if [ ! -f AppIcon.icns ] && [ -f ../public/logo.svg ]; then
  tmp=$(mktemp -d)
  if qlmanage -t -s 1024 -o "$tmp" ../public/logo.svg >/dev/null 2>&1 && [ -f "$tmp/logo.svg.png" ]; then
    iconset="$tmp/AppIcon.iconset"
    mkdir -p "$iconset"
    for s in 16 32 128 256 512; do
      sips -z $s $s "$tmp/logo.svg.png" --out "$iconset/icon_${s}x${s}.png" >/dev/null
      sips -z $((s*2)) $((s*2)) "$tmp/logo.svg.png" --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null
    done
    iconutil -c icns "$iconset" -o AppIcon.icns && echo "Generated AppIcon.icns from public/logo.svg"
  fi
  rm -rf "$tmp"
fi
[ -f AppIcon.icns ] && cp AppIcon.icns "$APP/Contents/Resources/"

swiftc -O -parse-as-library \
  -target arm64-apple-macosx14.0 \
  LSHApp.swift \
  -o "$APP/Contents/MacOS/LSH"

cp Info.plist "$APP/Contents/"
codesign --force -s - "$APP" 2>/dev/null || true

echo "Built $APP"
echo "Run:     open $APP"
echo "Install: cp -r $APP /Applications/"
