#!/bin/bash
# Roam host installer: Raspberry Pi OS (64-bit) + OpenWrt router container + apps.
#
#   sudo ./install.sh [--usb /dev/sdXN] [--plex-claim claim-xxxx] [--eth eth0] [--no-apps] [--reset-router]
#                     [--offline] [--images apps-images.tar.zst] [--start]
#
# Run it while the Pi is connected to the Internet by Ethernet. Nothing changes on the
# network until you reboot; after the reboot the Pi IS the router.
# The ready-to-flash image (build.sh host-image) runs it once at first boot with
#   --offline   packages come from ./debs (no Internet needed)
#   --images    app images come from a "docker save" archive instead of the Internet
#   --start     start the router right away, then the apps (no reboot)
# Addresses:
#   router  http://192.168.8.1      games  http://games.lan     plex  http://plex.lan:32400/web
#   the Pi itself (SSH)  192.168.8.2
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ETH=eth0; USB=""; PLEX_CLAIM=""; APPS=1; RESET=0; OFFLINE=0; IMAGES=""; START=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--usb) USB="$2"; shift 2 ;;
		--plex-claim) PLEX_CLAIM="$2"; shift 2 ;;
		--eth) ETH="$2"; shift 2 ;;
		--no-apps) APPS=0; shift ;;
		--reset-router) RESET=1; shift ;;
		--offline) OFFLINE=1; shift ;;
		--images) IMAGES="$2"; shift 2 ;;
		--start) START=1; shift ;;
		*) echo "unknown option: $1" >&2; exit 1 ;;
	esac
done

die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run with sudo"
case "$(uname -m)" in aarch64) ARCH=arm64 ;; x86_64) ARCH=x86 ;; *) die "unsupported CPU $(uname -m)" ;; esac
ROOTFS="$HERE/roam-openwrt-$ARCH-rootfs.tar.gz"
[[ -f $ROOTFS ]] || die "missing $ROOTFS"
ip link show "$ETH" >/dev/null 2>&1 || die "no network interface $ETH (use --eth)"
# Owner of the media/games folders: the sudo user, else the first regular user (uid 1000).
OWNER=${SUDO_USER:-$(getent passwd 1000 | cut -d: -f1)}; OWNER=${OWNER:-root}
PUID=$(id -u "$OWNER"); PGID=$(id -g "$OWNER")
[[ -z $IMAGES || -f $IMAGES ]] || die "missing $IMAGES"
C=/var/lib/lxc/roam
# First-start progress, shown on the router's Dashboard (file inside the container).
progress() { echo "== $1"; (( START )) && [[ -d $C/rootfs/etc ]] && echo "$1" > $C/rootfs/etc/roam-host-setup; return 0; }

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
APTOPT=(-y -qq -o DPkg::Lock::Timeout=900)
if (( OFFLINE )) && compgen -G "$HERE/debs/*.deb" >/dev/null; then
	# Exactly the .deb files bundled in the image (all dependencies included), installed
	# with dpkg: apt would prefer its online sources for the same versions and fail offline.
	systemctl stop apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true
	ok=0
	for try in 1 2 3 4 5 6; do
		if dpkg -i --force-confdef --force-confold "$HERE"/debs/*.deb >/tmp/roam-dpkg.log 2>&1; then ok=1; break; fi
		grep -qi 'lock' /tmp/roam-dpkg.log || break
		echo "  package database busy; waiting"; sleep 20
	done
	(( ok )) || tail -20 /tmp/roam-dpkg.log
	if (( ! ok )); then
		echo "  bundled packages failed; trying the Internet"
		apt-get update -qq || true
		apt-get install "${APTOPT[@]}" lxc iw rfkill usbmuxd openssl zstd curl >/dev/null
		(( APPS )) && apt-get install "${APTOPT[@]}" docker.io docker-compose >/dev/null
	fi
else
	apt-get update -qq
	apt-get install "${APTOPT[@]}" lxc iw rfkill usbmuxd openssl zstd curl >/dev/null
	if (( APPS )); then
		apt-get install "${APTOPT[@]}" docker.io >/dev/null
		apt-get install "${APTOPT[@]}" docker-compose >/dev/null 2>&1 || apt-get install "${APTOPT[@]}" docker-compose-plugin >/dev/null 2>&1 || true
	fi
fi
compose() { if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi; }

echo "== Host files"
cp -r "$HERE/files/." /
sed -i "s/@ETH@/$ETH/g" /etc/NetworkManager/conf.d/90-roam.conf
chmod 755 /usr/local/lib/roam/lxc-start-host /usr/local/lib/roam/host-link /usr/local/lib/roam/roam-hotplug \
	/usr/local/lib/roam/clock-jump /usr/local/lib/roam/roam-update
# Settings the updater (roam-update) reuses; other lines (e.g. ROAM_UPDATE_BASE) are kept.
mkdir -p /etc/roam
{ grep -vE '^(ETH|APPS)=' /etc/roam/host.conf 2>/dev/null || true; echo "ETH=$ETH"; echo "APPS=$APPS"; } > /etc/roam/host.conf.new
mv /etc/roam/host.conf.new /etc/roam/host.conf
# Version + release key for updates (see build.sh release).
[[ -f $HERE/release ]] && cp "$HERE/release" /etc/roam-host-release
[[ -f $HERE/release.pub ]] && install -m 644 "$HERE/release.pub" /usr/local/lib/roam/release.pub
while read -r m; do case "$m" in ''|\#*) ;; *) modprobe "$m" 2>/dev/null || echo "  (module $m not available)";; esac; done < /etc/modules-load.d/roam.conf

command -v nmcli >/dev/null && nmcli radio wifi on 2>/dev/null || true

echo "== Router container"
if [[ -d $C/rootfs && $RESET == 0 ]]; then
	echo "  keeping the existing router (settings preserved); use --reset-router to start fresh"
else
	rm -rf "$C/rootfs"; mkdir -p "$C/rootfs"
	tar -xzf "$ROOTFS" -C "$C/rootfs"
fi
sed "s/@ETH@/$ETH/" /usr/local/lib/roam/lxc.conf.in > "$C/config"

if (( START )); then
	# The router comes up now; the apps follow once they are installed.
	systemctl daemon-reload
	systemctl enable roam-router.service >/dev/null
	progress "installing the apps"
	systemctl restart roam-router.service || echo "  WARNING: router did not start (see: journalctl -u roam-router)"
fi

if (( APPS )); then
	echo "== Apps"
	STORE=/srv/roam
	mkdir -p $STORE
	if [[ -n $USB ]]; then
		[[ -b $USB ]] || die "$USB is not a block device"
		UUID=$(blkid -s UUID -o value "$USB"); FST=$(blkid -s TYPE -o value "$USB")
		[[ -n $UUID ]] || die "$USB has no filesystem (format it first)"
		OPTS="nofail,x-systemd.device-timeout=10s"
		case "$FST" in vfat|exfat|ntfs|ntfs3) OPTS="$OPTS,uid=$PUID,gid=$PGID,umask=002" ;; esac
		sed -i '\| /srv/roam |d' /etc/fstab
		echo "UUID=$UUID /srv/roam $FST $OPTS 0 2" >> /etc/fstab
		systemctl daemon-reload
		mountpoint -q $STORE || mount $STORE
		echo "  USB drive $USB ($FST) mounted on $STORE"
	else
		echo "  no --usb given: media and games are stored on the SD card in $STORE"
	fi
	mkdir -p "$STORE/media/Movies" "$STORE/media/TV Shows" "$STORE/media/Music" "$STORE/games/assets"
	for p in nes snes n64 gb gbc gba nds genesis sms gamegear psx atari2600 arcade; do mkdir -p "$STORE/games/library/roms/$p"; done
	chown -R "$PUID:$PGID" "$STORE/media" "$STORE/games" 2>/dev/null || true

	A=/opt/roam-apps; D=/var/lib/roam-apps
	mkdir -p $A $D/plex $D/romm-db $D/romm/resources $D/romm/redis $D/romm/config
	chown -R "$PUID:$PGID" $D/plex
	cp "$HERE/apps/compose.yml" $A/compose.yml
	if [[ ! -f $A/.env ]]; then
		cat > $A/.env <<EOT
HOST_IP=192.168.8.2
APPDATA=$D
GAMES=$STORE/games
MEDIA=$STORE/media
PUID=$PUID
PGID=$PGID
TZ=$(cat /etc/timezone 2>/dev/null || echo UTC)
DB_PASSWORD=$(openssl rand -hex 16)
DB_ROOT_PASSWORD=$(openssl rand -hex 16)
ROMM_SECRET=$(openssl rand -hex 32)
PLEX_CLAIM=$PLEX_CLAIM
EOT
		chmod 600 $A/.env
	elif [[ -n $PLEX_CLAIM ]]; then
		sed -i "s/^PLEX_CLAIM=.*/PLEX_CLAIM=$PLEX_CLAIM/" $A/.env
	fi
	systemctl start docker.service
	if [[ -n $IMAGES ]]; then
		progress "loading the game and Plex apps (a few minutes)"
		zstd -dc "$IMAGES" | docker load
	else
		echo "  downloading app images (this can take a while)..."
		(cd $A && compose pull -q)
	fi
	cat > /etc/systemd/system/roam-apps.service <<EOT
[Unit]
Description=Roam apps (RomM, Plex)
After=roam-router.service docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$A
ExecStart=/bin/sh -c 'docker compose up -d 2>/dev/null || docker-compose up -d'
ExecStop=/bin/sh -c 'docker compose down 2>/dev/null || docker-compose down'

[Install]
WantedBy=multi-user.target
EOT
fi

# MariaDB creates the RomM database and user only on its very first start, and gives up
# if its temporary server takes over 30 s to come up (easy on a busy first boot from an
# SD card). That leaves a half-built database RomM can never log in to, so do the first
# start on its own, wait for "init process done", and wipe + retry if it failed.
init_romm_db() {
	local d=/var/lib/roam-apps/romm-db try i log
	[[ -n $(ls -A $d 2>/dev/null) ]] && return 0
	for try in 1 2 3; do
		(cd /opt/roam-apps && compose up -d romm-db) >/dev/null 2>&1
		for i in $(seq 1 60); do
			sleep 5
			log=$(cd /opt/roam-apps && compose logs romm-db 2>&1)
			grep -q 'init process done' <<<"$log" && { echo "  game database ready"; return 0; }
			grep -q 'Unable to start server' <<<"$log" && break
		done
		echo "  game database setup timed out (try $try); retrying"
		(cd /opt/roam-apps && compose rm -sf romm-db) >/dev/null 2>&1
		find $d -mindepth 1 -delete
	done
	echo "  WARNING: game database setup failed; see README (Games stays 'Starting')"
}

systemctl daemon-reload
systemctl enable roam-router.service roam-update.path >/dev/null
(( APPS )) && systemctl enable docker.service roam-apps.service roam-clock-jump.service roam-clock-jump.timer >/dev/null
if (( APPS )); then
	progress "setting up the game library database"
	init_romm_db
fi

if (( START )); then
	if (( APPS )); then
		# Enabled units only start on the next boot; the clock jump (NTP via the router)
		# usually comes during this one, so start the watcher before the apps.
		systemctl start roam-clock-jump.service roam-clock-jump.timer || true
		systemctl start roam-update.path || true
		progress "starting the game and Plex apps"
		systemctl start roam-apps.service || echo "  WARNING: apps did not start (see: journalctl -u roam-apps)"
	fi
	rm -f $C/rootfs/etc/roam-host-setup
	echo "== Done: router and apps are running."
	exit 0
fi

cat <<EOT

== Done. Reboot to switch over:  sudo reboot
After the reboot the Pi is the router. Connect to its Wi-Fi (or Ethernet port), then open:
  router   http://192.168.8.1
  games    http://games.lan          (RomM; create the admin account on first visit)
  plex     http://plex.lan:32400/web
  Pi (SSH) ssh $OWNER@192.168.8.2
If the router fails to start, the Ethernet port returns to Pi OS (DHCP) for repairs.
EOT
