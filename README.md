# Roam: OpenWrt travel router for Raspberry Pi 4

Stock **OpenWrt 25.12.6** (same packages, kernel and security updates as the official
image) with a simpler, card-based web interface laid out like a commercial travel router.
It has no GL.iNet software or artwork. The full OpenWrt interface (LuCI) is still there,
under **Advanced Settings** in the sidebar.

**Download:** the newest images are on the [Releases page](https://github.com/kurtag01/Roam-Router/releases/latest):
- `roam-host-pi4-<version>.img.xz`: Pi 4 as router **plus Games (RomM) and Plex**. Flash to an SD card ([Roam host](#roam-host-router--games--plex-on-raspberry-pi-os)).
- `roam-<version>-rpi4-factory.img.gz`: Pi 4 as a router only. Flash to an SD card.

Installed routers update themselves from the same page: see [Updates](#updates).

## Flash it

Image: `output/openwrt-25.12.6-roam-bcm27xx-bcm2711-rpi-4-squashfs-factory.img.gz`

- **Raspberry Pi Imager:** Choose OS › Use custom › pick the `.img.gz` › choose the SD card › Write.
  (balenaEtcher works the same way.)
- **Linux terminal:** `gunzip -c output/*rpi-4-squashfs-factory.img.gz | sudo dd of=/dev/sdX bs=4M conv=fsync status=progress`
  Check `/dev/sdX` with `lsblk` first: this erases that disk.

Use the **sysupgrade** image (same folder) to upgrade a Pi that already runs this firmware,
from Advanced Settings › System › Backup / Flash Firmware.

## First start

1. Plug the Panda adapter in **before** powering on. The first boot takes about 1–2 minutes.
2. Connect to the router:
   - **Wi-Fi:** `Roam-XXXX` (the last 4 characters of the Pi's Ethernet MAC), password `roam-pi-setup`.
   - **Cable:** use the Ethernet port.
3. Open **http://192.168.8.1**. The first page asks you to **choose the admin password** (also used for SSH as `root`), then signs you straight in.
   - **Strong passwords are required by default:** at least 14 characters; 3 of lower case, upper case, numbers and symbols (or 20+ characters); no runs like `aaaa` or `1234`; no common words like "password". A meter and checklist show progress, and **Suggest a strong password** fills in a random one (save it in a password manager).
   - **The "Require a strong password" switch** can be turned off; then any non-empty password is accepted. The choice is remembered for System › Admin password, which uses the same rules.
   - **Until a password is chosen, nobody can sign in or SSH in:** first boot gives `root` a random password nobody knows (stock OpenWrt has none, so any password would work). The router checks the rules itself, and only accepts the form from its own page, so another website can't set the password for you.
4. **Internet › Repeater › Scan for networks** connects the router to hotel or home Wi-Fi.
5. **Wireless:** change the Wi-Fi name and password from the defaults.

The router uses **192.168.8.x** for its own network, so it doesn't clash with the
192.168.1.x networks that most hotels and homes use.

## What's in the interface

| Page | What it does |
|---|---|
| Dashboard | Internet source, Wi-Fi networks, client count, VPN and system status (refreshes live). |
| Internet | **Repeater:** scan and join, hidden networks, disconnect. **MAC address of the repeater radio:** Factory, Random (new address on every start) or Custom, with "copy from device" to get through captive portals. **Ethernet:** use the port as LAN or as Internet (DHCP, static IP or PPPoE). **USB tethering:** status for Android and iPhone. |
| Wireless | **My Wi-Fi** and **Guest Wi-Fi** (guest is isolated): name, security (WPA2, WPA2/WPA3 or WPA3), password, hidden. **MAC address (BSSID) of each broadcast network:** Factory, Random or Custom. **Radios:** channel and country, which radio broadcasts and which connects to the Internet, and **broadcast power** (High by default, Medium ≈ 14 dBm, Low ≈ 8 dBm; the card shows the power the radio reports). |
| Clients | Connected devices with name, IP, MAC and signal; block and unblock. |
| VPN | Add a WireGuard configuration from any provider: drag the `.conf` file onto the WireGuard card or the import window, choose it, paste it, or type the values into a form. Everything is checked before it is saved (an OpenVPN `.ovpn` is recognised and sent to the OpenVPN page). On/off, handshake and traffic. **Kill switch.** OpenVPN is under Advanced. |
| Network | **Encrypted DNS** (DNS-over-HTTPS): off, Cloudflare, Quad9, Mullvad (optionally with ad blocking), AdGuard, Google or a custom server. Also: router LAN address, DHCP range and lease time, plain custom DNS, DNS rebind protection. |
| System | **Hostname**, time zone, admin password (strong-password rules with an on/off switch, password generator), restart, links to backup, firmware and software. |
| Updates | Current Roam and OpenWrt version, **Check for updates**, **Install update** with progress, daily automatic check (on by default). The Dashboard shows when an update is available. See [Updates](#updates). |
| Advanced Settings | All of standard OpenWrt LuCI: firewall, routing, VLANs, packages, logs, SSH and so on. |

**Radio roles** (set automatically on first boot, changeable on the Wireless page):
- **Panda + built-in Wi-Fi:** the Panda broadcasts your Wi-Fi, and the Pi's built-in radio connects to the upstream network.
- **One radio only:** it does both, on the upstream network's channel.

A Wi-Fi 6E adapter that would default to 6 GHz is set to 5 GHz, because 6 GHz only allows WPA3 and many devices can't see it.

## Panda adapter support

The image includes drivers and firmware for every Panda chipset family:
- **RT3070, RT5372, RT5572** (PAU05, PAU06, PAU09, ...): `rt2800usb`
- **MT7610U:** `mt76x0u`
- **MT7612U** (PAU0D): `mt76x2u`
- **MT7921AU** (PAU0F AXE3000): `mt7921u`

Run `lsusb` over SSH to see which chip yours has.

## Security

- Firewall: the upstream networks (repeater, Ethernet in Internet mode, tethering and the VPN) are in OpenWrt's `wan` zone, so nothing from them can reach the router or your devices.
- The web interface and SSH are only reachable from your own network.
- No TRIM or telemetry has been added.
- Guest Wi-Fi gets Internet access only. Guests can't see each other or your devices, and can't reach the router's interface.
- HTTPS for the web interface is available at `https://192.168.8.1` with a self-signed certificate. It isn't forced.
- Rollback protection: changes made in the interface roll back automatically if they make the router unreachable.

## Appearance

The moon/sun button in the top bar switches between **Auto** (follows your device's light or dark setting), **Dark** and **Light**. Each browser remembers its own choice. Dark mode also applies to the full OpenWrt pages under Advanced Settings.

## Encrypted DNS

Network › Encrypted DNS sends every DNS lookup, from the router and from your devices, to the chosen provider over HTTPS. It uses OpenWrt's `https-dns-proxy` package. Devices that try to use their own DNS server are redirected to it.

- **Off by default.** Hotel and airport sign-in pages usually need the network's own DNS: turn this off, sign in, then turn it back on.
- **Your settings come back.** Turning it off restores your previous DNS settings.
- **No third-party check.** The package's startup lookup of `heartbeat.mossdef.org` is disabled.

## VPN kill switch

VPN › Kill switch makes sure your devices (main and guest Wi-Fi, LAN) can reach the Internet **only through the WireGuard tunnel**. If the tunnel drops or hasn't connected yet, their traffic and DNS lookups are blocked instead of going out over the hotel or home network.

`/usr/libexec/roam/killswitch on|off|status` implements it:
- **Firewall:** the tunnel gets its own firewall zone, and LAN and guest may only forward to that zone. Their forwardings to `wan` are disabled.
- **DNS:** the uplinks stop supplying DNS servers, so lookups use the VPN's DNS (Quad9 and Cloudflare if the config has none).
- **Extra DNS protection:** a firewall rule stops the router from sending any DNS out the uplink, except to one bootstrap server. That server is only used to look up the VPN server's hostname, so the tunnel can still connect.
- **The router itself keeps its connection,** so it can always rebuild the tunnel.

Turning the VPN off or removing it also turns the kill switch off, because otherwise there would be no Internet at all. To sign in to a hotel portal, turn the kill switch off first.

**Tested** in the VM with a real WireGuard server and a test "laptop" on the LAN:

| Situation | Laptop result |
|---|---|
| Kill switch on, tunnel up | Online through the VPN |
| Kill switch on, tunnel down | Traffic and DNS blocked |
| Kill switch off, tunnel down | Traffic leaks out unprotected (what the kill switch prevents) |
| VPN removed | Everything restored |

## Privacy on upstream networks

**Appear as a Windows PC (default):** routers that fingerprint devices, such as UniFi and eero, identify a device by its DHCP request, mainly the list of options it asks for (option 55) and its vendor tag (option 60). BusyBox's list (`1,3,6,12,15,28,42,121`) is labeled "OpenWrt". With this profile, the DHCP request matches a Windows 10/11 PC:
- option 55 is `1,3,6,15,31,33,43,44,46,47,119,121,249,252`
- the vendor tag is "MSFT 5.0"
- the client ID is derived from the (randomized) MAC
- the router's TTL is 128

The DHCP packets themselves still carry TTL 64, because BusyBox sets that itself.

Switch under System › Privacy on other networks. **Minimal** sends even less information, but its pattern is recognizable as OpenWrt or Linux. `/usr/libexec/roam/dhcp-profile windows|minimal 0|1` makes the same change from the command line.

On hotel, home and phone networks (Repeater, Ethernet in Internet mode, tethering), the router also:
- **No hostname:** doesn't send one by default. You can switch this under System › Privacy on other networks.
- **No DHCP client ID (option 61):** doesn't send one. The default OpenWrt client ID is a fixed ID that stays the same even when the MAC address changes.
- **No vendor class (option 60):** doesn't send "udhcp <version>", which is what labels a device as OpenWrt. OpenWrt has no setting for this, so `/etc/init.d/roam-privacy` adds a `novendorid` option to its DHCP client at every boot.
- **Generic time servers:** uses `pool.ntp.org`, not `openwrt.pool.ntp.org`.

The MAC address is the only identifier left. Set it to Random or Custom under Internet › Repeater.

The hostname itself can't be blank: Linux needs one, and OpenWrt replaces a blank name with "OpenWrt". It stays on the router unless you allow sending it.

## How it was tested

- An x86 build of this firmware ran in a QEMU VM with two simulated Wi-Fi radios (`mac80211_hwsim`) and was driven through the web interface in Firefox.
- **Login and first-boot setup:** the login page, first-boot setup and the default Wi-Fi all worked.
- **Repeater:** scan, then join a WPA2 network. The router got an address from that network.
- **Repeater MAC:** set to a custom MAC and confirmed on the radio interface.
- **Broadcast MAC (BSSID):** set to a custom value and confirmed on the interface.
- **Hostname:** changed, and confirmed in the system config and the kernel.
- **WireGuard:** importing a config created the interface, split default routes and the firewall zone.
- **Admin password:** set, then a wrong password was rejected and the new one logged in.
- **Other pages:** Dashboard, Clients, Network and VPN all rendered, and the mobile layout works.
- **Pi image:** checked to contain all drivers, firmware and interface files.
- **Not tested on real hardware:** the real Pi 4 and the Panda adapter.

## Updates

Routers update only from **this project's GitHub releases**, never straight from OpenWrt (a stock OpenWrt image would remove Roam, and upgrading packages one by one on a router is unsafe). Each release is OpenWrt plus Roam, built by GitHub Actions, tested by a maintainer, and **signed**: the router checks the signature (Ed25519, OpenWrt's `usign`) and the file's checksum before changing anything.

- **Where:** the router's **Updates** page. It checks daily (a random time between 03:00 and 09:00, and 10 minutes after boot); nothing installs until you click **Install update**.
- **Standalone Pi:** the router downloads the release's sysupgrade image, verifies it, and flashes it with OpenWrt's `sysupgrade`; settings are kept. Keep it powered during the ~2 minutes. If anything fails before flashing, nothing changes.
- **Roam host (Pi OS + router + apps):** the Pi does the update (`/usr/local/lib/roam/roam-update`, started by `roam-update.path` when the Updates page asks): it downloads and verifies everything first, saves the router settings (`sysupgrade -b`), swaps in the new router, and checks it answers. **If the new router doesn't come up within 3 minutes, or the update stops halfway, the Pi puts the previous router and host files back.** New app versions are downloaded before the swap. Log: `/var/log/roam-update.log`; settings saved before each update: `/var/lib/roam-settings-before-<version>.tgz` (newest 3).
- **Release key:** `keys/roam-release.pub` (built into every image). The secret key is the `ROAM_SIGNING_KEY` repository secret; maintainers: see [RELEASING.md](RELEASING.md).
- **Testing:** `uci set roam.update.base_url=http://host:port/dir` (router) or `ROAM_UPDATE_BASE=...` in `/etc/roam/host.conf` (Pi) points the updater at a folder with release files instead of GitHub.

**Tested** (x86 VMs, local release server):
- **Standalone:** 1.0.0 → 1.0.1 from the Updates page. Wi-Fi name, broadcast power, admin password and update settings were kept; the page followed the restart and reconnected. A checksum list with an added line was refused (bad signature), and a corrupted firmware under a valid signature was refused before flashing.
- **Roam host:** updates started from the router's page through `roam-update.path`. 1.0.0 → 1.0.1 → 1.0.3 kept the router's settings and password. A release whose router can't start (1.0.2) was rolled back after 3 minutes, and the router showed "Update undone". An updater stopped on purpose right after the swap rolled back within seconds.
- **Bugs found by these tests and fixed:** under systemd, `lxc-attach` couldn't find `/bin/sh` (systemd's PATH), so every update from the page would have failed or rolled back; and the update overwrote the running updater script, which crashed it with the router stopped. The updater now runs from a copy and has the stop-halfway rollback.

## Rebuild

```
./build.sh            # Raspberry Pi 4 image  -> output/
./build.sh x86test    # x86 VM test image with simulated radios (+ a fake "HotelWiFi")
./build.sh release    # everything for a GitHub release -> output/release/ (see RELEASING.md)
```

Versions (Roam, OpenWrt, Raspberry Pi OS) are set in `versions.env`; app image versions are pinned in `src/host/apps/compose.yml`.

The OpenWrt Image Builder is downloaded to `~/openwrt-ib/` and checked against OpenWrt's sha256sums. Its Makefiles can't handle the space in this folder's name, which is why it lives there.

**Where things live:**
- Interface source: `src/files/`
  - Theme: `usr/share/ucode/luci/template/themes/roam/` and `www/luci-static/roam/`
  - Pages: `www/luci-static/resources/view/roam/`
  - First-boot defaults: `etc/uci-defaults/95-roam-defaults`
  - Wi-Fi setup and MAC helpers: `usr/libexec/roam/`
- Test-only files: `src/test-files/`
- Package list: the top of `build.sh`

---

# Roam host: router + games + Plex on Raspberry Pi OS

Instead of the standalone image, the Pi can run **Raspberry Pi OS (64-bit)**. On top of that:
- **The router:** Roam OpenWrt runs as an LXC container, with the same interface and features. The container gets the Pi's Ethernet port, both Wi-Fi radios and USB tethering devices.
- **The apps:** they run in Docker next to the router and are reachable only from the router's own network:

| What | Address |
|---|---|
| Router | http://192.168.8.1 |
| Games (RomM, play in the browser) | http://games.lan (or http://192.168.8.2) |
| Plex | http://plex.lan:32400/web |
| The Pi itself (SSH) | 192.168.8.2 |

The router's **Dashboard** gets an **Apps** card showing whether Games and Plex are running, with their addresses and buttons to open them. The sidebar's **Apps** page has the details: where to put ROMs and media, and what to do on the first visit. The router itself checks the status (`/usr/libexec/roam/app-status`), so it works over HTTPS and from any device.

## How it fits together

```
 hotel/home Wi-Fi ── brcmfmac ┐                          ┌─ Panda (AP) ── your devices
 phone (USB tether) ──────────┤   OpenWrt container      ├─ eth0 (LAN port)
                              │   192.168.8.1            └─ lanhost ═══ rhost (Pi OS, 192.168.8.2)
                                                                          ├─ RomM  :80
                                                                          └─ Plex  :32400
```

- **The host is a LAN client.** Its internet goes through the router, so the router's firewall, VPN, kill switch and encrypted DNS also cover the Pi and its apps.
- **Hot-plugged devices** (a re-plugged Wi-Fi adapter, a USB-tethered phone) are handed to the router automatically through a udev rule.
- **If the router container stops or fails,** the Ethernet port goes back to Pi OS on DHCP, so the Pi can still be reached for repairs.
- **Storage:** app settings are on the SD card in `/var/lib/roam-apps`. Media and games are on the USB drive mounted at `/srv/roam`:
  - `media/{Movies,TV Shows,Music}`
  - `games/library/roms/<console>`

## Ready-to-flash image (easiest)

`output/roam-host-pi4-<date>.img.xz` is Raspberry Pi OS Lite (64-bit, trixie) with everything bundled: the router, RomM, Plex and all the packages they need. It needs no Internet to set up.

1. **Flash it** to an SD card of 8 GB or more. In Raspberry Pi Imager choose "Use custom" (or use `xz -dc … | sudo dd of=/dev/sdX bs=4M`). Don't apply OS customisation: the image already has cloud-init settings on the boot partition (`user-data`: user `roam`, hostname `roam-host`, SSH by key only). **For SSH access, add your public key to `user-data` on the boot partition before the first boot** (instructions are in the file); then `ssh roam@192.168.8.2`. Builds use `src/host-image/boot/user-data` if you create one (it is not in git, since it holds your key), otherwise the template `user-data.example`.
2. **Boot the Pi.** The first start takes about 5–10 minutes:
   1. The SD card's root partition is expanded.
   2. The bundled packages are installed.
   3. **The router starts.** The Wi-Fi `Roam-XXXX` appears and http://192.168.8.1 works.
   4. The app images are loaded, and RomM and Plex start.

   While this runs, the router's Dashboard shows **"Setting up"** with the current step. The log is in `/var/log/roam-firstboot.log`. If something fails, the setup runs again at the next boot.
3. **Optional:** options for `install.sh` can go in `roam-options.txt` on the boot partition, on one line, e.g. `--plex-claim claim-xxxx`.
4. **Link Plex to your Plex account** (once): Apps › Plex › **Link your Plex account**. Get a code at https://plex.tv/claim (valid 4 minutes), paste it, and the router links the server; then add libraries in Plex. Until then, Plex shows **Not linked** and says you have no access when you sign in.

**If Games stays "Starting / stopped"** while Plex runs (an image built before 26 Nov 2026), the game database's one-time setup timed out. If you haven't created a RomM account yet, reset it on the Pi: `sudo systemctl stop roam-apps && sudo find /var/lib/roam-apps/romm-db -mindepth 1 -delete && sudo systemctl start roam-apps`, then allow about 3 minutes. Newer images set up and check the database before starting the apps.

Afterwards, to put media and games on a USB drive: `sudo /opt/roam-setup/install.sh --usb /dev/sda1` (settings are kept), then reboot.

Build it with `./build.sh ct-arm64 && ./build.sh host-bundle && ./build.sh host-image`. This needs Docker, and no root on the build machine:
- **Images:** pulls the arm64 app images and `docker save`s them.
- **Packages:** downloads the Pi OS packages with apt, resolved against the image's own package database, and checks that they install offline.
- **Assembly:** grows and fills the image inside a throw-away privileged container.

## Install on an existing Raspberry Pi OS

1. **Flash Raspberry Pi OS Lite (64-bit)** to an SD card with Raspberry Pi Imager. Under "OS customisation":
   - set hostname `roam-host`, a username and a password
   - enable SSH with public-key login
   - leave Wi-Fi unconfigured
2. **Connect the Pi's Ethernet to a network with Internet,** plug in the USB drive, and boot.
3. **Copy `output/roam-host/` to the Pi and run:** `sudo ./install.sh --usb /dev/sda1` (add `--plex-claim claim-…` if you like). Nothing on the network changes yet.
4. **Optional:** bring over your settings from the standalone router with `sudo ./migrate-settings.sh <backup>.tar.gz`.
5. **Run `sudo reboot`.** From then on the Pi is the router.

**Tested** in an x86 Debian 13 VM with simulated Wi-Fi:
- **Install and boot:** the install runs and OpenWrt boots inside the container.
- **Wi-Fi:** the radios are handed over and the access point comes up.
- **Uplink:** the router went online through a handed-over uplink NIC.
- **Host link:** the host reached the internet through the router, and `games.lan` / `plex.lan` resolved.
- **Apps:** RomM and Plex served their pages.
- **Hotplug:** a newly appearing tethering device was moved into the router.
- **Restarts:** stopping and restarting the router (Ethernet returned to the host and moved back), and a full reboot, all came back on their own.
- **Real Pi 4 (8 GB):** deployed and survived an unattended reboot.
  - **Router:** Wi-Fi uplink with random MAC, access point, and settings migrated from the standalone router.
  - **Apps and memory:** RomM and Plex reachable as `games.lan` and `plex.lan`; about 740 MB of RAM in use.
  - **Fix found on real hardware:** Pi OS's NetworkManager keeps Wi-Fi soft-blocked until a country is set. The installer and the start hook now run `nmcli radio wifi on`.
- **First-start path** (`install.sh --images … --start`, which the image's first boot uses), tested in the VM: router up first, app images loaded from the archive, apps started, all services enabled, and the Dashboard progress file cleared.
- **First flash on the real Pi failed:** the router never came up. `apt-get install ./debs/*.deb` preferred its online sources for the same package versions, so with no internet it failed. The build-time `apt -s` check couldn't catch this, because simulation never downloads. Now:
  - **Install:** first boot installs the bundle with `dpkg -i`.
  - **Build check:** apt sees only a local repository made from the bundled packages and must resolve the whole install. It was confirmed to fail when a package is removed.
  - **Result:** after the fix, the same Pi finished setting up offline, with router, games and Plex all answering.
- **Second flash on the real Pi: router and Plex fine, Games stuck on "Starting".** MariaDB creates RomM's database and user only on its very first start, and gives up if its temporary server takes over 30 s, which happened on the busy first boot. Every later start reused the half-built database, so RomM was refused ("Host … is not allowed to connect"). The installer now does that first start on its own, waits for MariaDB's "init process done", and wipes and retries if it failed. Tested on the Pi: database ready in 37 s, Games answering about 2½ minutes later.
- **RomM "No scan worker is listening" (real Pi):** the Pi has no battery-backed clock, so it boots with an old time and jumps forward once the router has internet. RomM's job queue (Valkey) expires keys by wall-clock time, so the jump wiped the workers' registrations. Their next heartbeats recreated records that listed no queues, so RomM saw no scan worker. `roam-clock-jump.timer` (`OnClockChange`) now runs `/usr/local/lib/roam/clock-jump`, which restarts RomM after any jump of more than 60 s. Tested on the Pi: a 2-minute jump triggered the restart, and the scan worker came back.
- **Third flash: Plex "no access", scan worker gone again.** Plex Media Server was running but unclaimed (no claim code in the image), so signing in was refused. The Apps page now links it with a plex.tv/claim code: the router posts it to Plex's `/myplex/claim`, which Plex accepts from its local network (tested with a fake code: plex.tv answered 403 and the page showed the error). The clock-jump watcher had been enabled during first boot but only starts at the next boot, so the first boot's NTP jump wasn't caught; first boot now starts it.
- **First-run password, tested in the x86 VM:** setup page shown on a fresh boot. Sign-in with an empty or made-up password was refused, and SSH refused `root` with no password. Requests from another site, a DNS-rebinding host name, or without Origin/Referer were rejected; each strong-password rule was enforced by the router. A suggested password signed straight in, then worked for sign-in and SSH, and setup mode ended. With the switch off, `abc` was accepted.
- **Fourth flash: Games stuck on "Starting" again.** The clock-jump watcher restarted RomM while RomM was still building its database on first boot (the router got Internet in the middle of it). MariaDB can't undo half-applied table changes, so every later start failed ("Duplicate key"). The watcher now waits until RomM's page answers before restarting it (up to 20 minutes). Tested on the Pi: a jump during RomM's startup was held until RomM was up, then RomM restarted cleanly and the scan worker registered.
- **Watchdog fix found in the VM:** OpenWrt's procd grabbed the host's hardware watchdog, so the VM hard-reset about 30 s after the router stopped. The container is now denied `/dev/watchdog` (`lxc.cgroup2.devices.deny = c 10:130`). On a Pi, Pi OS's systemd holds the watchdog anyway.

**Limits:**
- **Plex transcoding:** the Pi 4 can't hardware-transcode for Plex. Direct play is fine; software transcoding manages about one 1080p stream.
- **Firmware upgrades:** use the router's **Updates** page (the stock firmware-flash page doesn't apply to the container). `install.sh` on an existing installation keeps the current router; it does not upgrade it.
