# Releasing Roam

Routers install a release only after a maintainer has tested it and published it. The
pieces:

| What | Where |
|---|---|
| Versions (Roam, OpenWrt, Raspberry Pi OS) | `versions.env` |
| App image versions (RomM, MariaDB, Plex) | `src/host/apps/compose.yml` (pinned) |
| Builds, signs and drafts releases | `.github/workflows/build.yml` |
| Weekly check for OpenWrt service releases | `.github/workflows/watch-openwrt.yml` |
| App and GitHub Actions update proposals | `.github/dependabot.yml` |
| Release public key (built into every image) | `keys/roam-release.pub` |
| Release secret key | GitHub secret `ROAM_SIGNING_KEY` (and an offline copy) |

## One-time repository setup

1. **Signing key secret:** Settings › Secrets and variables › Actions › New repository
   secret, name `ROAM_SIGNING_KEY`, value: the full contents of the secret key file
   (`backups/roam-release.sec`, two lines). Keep an offline copy (password manager);
   never commit it. Without the secret, tagged builds fail on purpose.
2. **Let the OpenWrt watcher open pull requests:** Settings › Actions › General ›
   Workflow permissions › tick "Allow GitHub Actions to create and approve pull
   requests".
3. **Public repository** (or routers cannot download releases): the updater fetches
   `https://github.com/<owner>/<repo>/releases/...` without credentials.
4. Optional: protect `main` (require the Build check before merging).

## Making a release

1. **Get the change onto `main`.** Typical sources:
   - the weekly "OpenWrt 25.12.x" pull request (bumps `OPENWRT_VERSION` and the patch
     version, and starts a build),
   - a Dependabot pull request for an app image,
   - your own changes, with `ROAM_VERSION` bumped in `versions.env`.
2. **Wait for the Build check** on the pull request (about 40–60 minutes). It builds
   everything; test images (standalone router) are attached to the run for 7 days.
3. **Test on real hardware** before merging, at least:
   - flash the standalone image or the host image on a spare SD card, run the first
     start (password page, Wi-Fi, Repeater, VPN, Games, Plex);
   - an **update from the current release** with settings (point a test router at the
     test files: see "Testing an update" below).
4. **Merge, then tag:** `git tag v1.2.3 && git push origin v1.2.3` (the tag must equal
   `v` + `ROAM_VERSION`). The Build workflow builds again, signs `SHA256SUMS`, and
   creates a **draft** release with all files.
5. **Publish the draft** (Releases › the draft › Edit › Publish). Only now do routers
   see it, the next time they check (daily, or Updates › Check for updates).

To pull a bad release: delete it or mark the previous release as "latest". Routers
never install a version older than they run, so fix forward with a new version.

## Version numbers

`MAJOR.MINOR.PATCH`: PATCH for OpenWrt service releases, app bumps and fixes; MINOR for
new features; MAJOR for a new OpenWrt series (e.g. 25.12 → 26.x) or anything that
changes how settings are stored.

## OpenWrt major upgrades

The watcher opens an issue when a new series appears; it never bumps across series.
Before switching: build with the new `OPENWRT_VERSION`, check the router log for
`roam: ... could not apply` (Roam patches two OpenWrt scripts: MAC addresses on the
Pi's built-in Wi-Fi, and the DHCP vendor-class option), and test an update from the
current release with real settings (VPN, kill switch, Repeater, guest Wi-Fi).

## Testing an update without GitHub

Build with the test version (`./build.sh release` with `ROAM_VERSION` raised), put
`output/release/` on any web server on your network (e.g. `python3 -m http.server`),
sign it if you built without the key:

    ROAM_SIGNING_KEY_FILE=path/to/roam-release.sec ./build.sh sign output/release/SHA256SUMS

then point a test device at it:

- standalone router: `uci set roam.update.base_url=http://<pc>:8000; uci commit roam`
- Roam host: add `ROAM_UPDATE_BASE=http://<pc>:8000` to `/etc/roam/host.conf` on the Pi
  and set the router's `roam.update.base_url` the same way

and use the Updates page. Remove the setting afterwards.

## If the signing key is lost or leaked

Generate a new pair (`usign -G -s new.sec -p keys/roam-release.pub` from any Image
Builder's `staging_dir/host/bin/`), update the secret, and release. Routers with the old
key cannot verify releases signed with the new one, so they need a one-time re-flash
with the new image (or, while the old key is still trusted and safe, publish one last
release signed with the old key that contains the new public key).
