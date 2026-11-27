#!/bin/bash
# Copy settings from a standalone Roam router (Advanced Settings > System > Backup,
# or "sysupgrade -b") into the router container, keeping the container's own wiring.
#   sudo ./migrate-settings.sh roam-backup.tar.gz
set -euo pipefail
B="${1:-}"; R=/var/lib/lxc/roam/rootfs
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
[[ -f $B ]] || { echo "usage: $0 backup.tar.gz" >&2; exit 1; }
[[ -d $R/etc ]] || { echo "router container not installed" >&2; exit 1; }
systemctl stop roam-apps roam-router 2>/dev/null || true
tar -xzf "$B" -C "$R"
# Re-apply the container wiring (LAN bridge with eth0 + host link, app names, flags) on next start.
tar -xzOf "$(dirname "$0")"/roam-openwrt-*-rootfs.tar.gz ./etc/uci-defaults/96-roam-container > "$R/etc/uci-defaults/96-roam-container"
chmod 755 "$R/etc/uci-defaults/96-roam-container"
systemctl start roam-router roam-apps
echo "Settings restored into the router container."
