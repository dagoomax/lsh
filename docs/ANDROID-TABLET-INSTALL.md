# Installing LSH on an Android Tablet (Termux)

This runs the actual LSH **server** on an Android tablet, not just the
dashboard as a client. It's useful for turning a spare tablet into a
self-contained smart-home hub with no separate machine needed. If you just
want a tablet to *display* the dashboard (e.g. as a Wall Dashboard kiosk
pointed at a server running elsewhere), see the "Add to Home Screen" /
[Wall Dashboard](../README.md) instructions in the main README instead —
you don't need any of this.

There's no official Android build of Node.js apps; this uses
[Termux](https://termux.dev/), a terminal emulator that provides a normal
Linux userland (including a real Node.js binary) on unrooted Android. No
root required.

## What works / what doesn't

- Everything in `package.json` is pure JS or ships prebuilt binaries — no
  on-device compiling, `npm install` just works.
- The React dashboard's `dist/` is already committed in the repo, so there's
  no build step on the tablet.
- Ports below 1024 need root, which Termux doesn't have. Leave
  `server.https.enabled` / `server.letsEncrypt.enabled` off (port 443) and
  use the plain HTTP port (default 3000, ≥1024) instead — fine for a LAN
  device. If you need HTTPS, terminate it on another machine and reverse
  proxy to the tablet.
- Android aggressively kills background processes to save battery. Getting
  LSH to survive the screen turning off or a reboot requires the extra
  steps in [Keep it running](#keep-it-running) below — this is the part
  that actually takes effort, not the install itself.
- HomeKit's mDNS advertising generally works over Wi-Fi in Termux, but some
  Android vendors (esp. MIUI/Xiaomi, some Samsung skins) throttle multicast
  traffic when the screen is off even with a wake lock. If HomeKit
  accessories randomly disappear, that's the usual cause — worth knowing
  going in if HomeKit is a priority for this install.

## Requirements

- Android 7+ tablet, arm64 (virtually all modern tablets)
- ~500 MB free storage for Termux + Node + the repo + `node_modules`
- Same Wi-Fi network as the rest of your smart-home devices

## 1. Install Termux

Install from **F-Droid**, not the Play Store — the Play Store build of
Termux is deprecated and unmaintained, and its packages are years out of
date.

1. On the tablet, install the [F-Droid](https://f-droid.org/) app store app
   (an APK download, since F-Droid isn't on the Play Store either)
2. In F-Droid, search for and install **Termux**
3. Open Termux once so it finishes its first-run setup

## 2. Install Termux:Boot (recommended)

Also from F-Droid: **Termux:Boot**. This is a separate app that lets Termux
run a script when the device powers on — without it, LSH will not restart
after a reboot even though the install script sets up the script for it.

Install it, open it once (so Android registers its boot receiver), then
grant it whatever "autostart" / "allow background activity" toggle your
Android skin exposes for it — many OEMs (Xiaomi, Huawei, some Samsung/Oppo
builds) block boot-time apps by default under an "autostart manager"
setting separate from normal permissions.

## 3. Run the install script

In Termux:

```bash
pkg install -y git
git clone https://github.com/dagoomax/lsh.git ~/lsh-setup
bash ~/lsh-setup/scripts/install-android-termux.sh
```

(The script itself clones the real working copy to `~/lsh` — the
`~/lsh-setup` clone above is just to get the script onto the device; you can
delete it afterwards, or fetch just the script with `curl` if you'd rather
not clone twice. Adjust the `git clone` URL if your fork/remote differs from
`dagoomax/lsh`.)

The script:

- installs Node.js, git, ffmpeg, and PM2 from Termux's package repo (no
  compiling)
- clones (or updates) the repo into `~/lsh`
- runs `npm install`
- seeds `config.json` from `config.example.json` if one doesn't exist yet
- starts LSH under PM2 using the repo's existing `ecosystem.config.js`
- writes `~/.termux/boot/start-lsh.sh` for Termux:Boot to run on reboot

It's safe to re-run — it pulls the latest code and reloads PM2 rather than
duplicating anything.

## 4. First-time configuration

Edit `~/lsh/config.json` (copy semantics are identical to any other LSH
install — see the main `README.md` for the full per-platform reference).
At minimum, decide which platform sections you actually want enabled; a
tablet install often makes sense as a lightweight instance for just a
handful of integrations rather than mirroring a full production config.

After editing config.json, apply it:

```bash
cd ~/lsh
pm2 restart lsh
```

Then open `http://<tablet-ip>:3000/setup.html` from any device on the LAN
(the install script prints the tablet's IP at the end) to create the first
admin user — same first-run flow as any other LSH install.

## 5. Keep it running

This is the part specific to Android. Three things, all one-time:

**Wake lock** — stops Android from suspending the Termux process:

```bash
termux-wake-lock
```

This needs to be run once per Termux session; the boot script the installer
wrote already calls it automatically on startup, but if you're testing
manually in a fresh session, run it yourself.

**Battery optimization exemption** — otherwise Android's Doze mode will
still throttle background networking/CPU for Termux even with a wake lock
held. On the tablet: Settings → Apps → Termux → Battery → set to
"Unrestricted" (wording varies by Android version/vendor).

**Termux:Boot** — covered in step 2 above. Without it, a reboot (power loss,
Android update, manual restart) leaves LSH not running until you manually
open Termux and run `pm2 resurrect`.

Optional but recommended: also disable Termux's own auto-lock/screen-timeout
interaction by keeping the tablet plugged in if it's serving as a permanent
hub, and consider disabling the tablet's lock screen entirely if it's wall
mounted and dedicated to this.

## 6. Accessing the dashboard

From the tablet itself or any other device on the same network:

```
http://<tablet-ip>:3000/react/
```

Find `<tablet-ip>` via the install script's printed output, or in Termux
with `ip -4 addr show wlan0`. Give the tablet a static DHCP reservation on
your router so this address doesn't change — otherwise anything pointed at
it (HomeKit, other LSH instances, bookmarks) will break next time it gets a
new lease.

## 7. Updating

```bash
cd ~/lsh
git pull --ff-only
npm install
pm2 restart lsh
```

Or just re-run `scripts/install-android-termux.sh` — it does the same
thing.

## 8. Uninstalling

```bash
pm2 delete lsh
pm2 unstartup 2>/dev/null || true
rm -rf ~/lsh ~/.termux/boot/start-lsh.sh
```

Then uninstall the Termux and Termux:Boot apps normally if you're not
keeping them for anything else.

## Troubleshooting

- **`npm install` prints warnings about optional native build failures** —
  safe to ignore; these are optional accelerators with pure-JS fallbacks
  already present in `package.json` (nothing here needs `node-gyp`/a
  compiler for LSH's own dependency tree).
- **PM2 doesn't survive a reboot** — Termux:Boot isn't installed, isn't
  granted autostart on your Android skin, or Termux is still battery-
  restricted. Re-check step 2 and the battery exemption in step 5.
- **Server stops responding after the screen has been off a while** —
  missing/lost wake lock, or Doze killing background network access despite
  it. Re-run `termux-wake-lock` and double check the battery optimization
  setting actually stuck (some OEM "optimized" battery managers silently
  re-apply restrictions after updates).
- **HomeKit accessories disappear intermittently** — see the mDNS caveat
  under [What works / what doesn't](#what-works--what-doesnt); this is an
  Android multicast-throttling issue, not an LSH bug.
- **Port 443 / built-in Let's Encrypt won't bind** — expected, Termux has no
  root and can't bind ports below 1024. Use the default HTTP port on the
  LAN, or reverse-proxy from a machine that can bind 443.
