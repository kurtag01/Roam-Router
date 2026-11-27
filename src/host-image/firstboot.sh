#!/bin/bash
# Roam host image: one-time setup at first boot (run by roam-firstboot.service).
# Installs the bundled packages, the router container and the apps, with no Internet
# needed. Progress shows on the router's Dashboard (http://192.168.8.1) and in
# /var/log/roam-firstboot.log. If it fails it runs again at the next boot.
set -uo pipefail
B=/opt/roam-setup
exec >> /var/log/roam-firstboot.log 2>&1
echo "=== $(date) Roam first start"

# The user account (cloud-init / Raspberry Pi Imager) exists by now: the unit runs after
# cloud-config.service. (Don't wait for cloud-init as a whole: its last stage waits for
# multi-user.target, which waits for this service.)

OPTS=()
[[ -s /boot/firmware/roam-options.txt ]] && read -r -a OPTS < /boot/firmware/roam-options.txt

if "$B/install.sh" --offline --images "$B/apps-images.tar.zst" --start "${OPTS[@]}"; then
	# Keep install.sh, files and the router rootfs for later use (e.g. --usb); drop the rest.
	rm -rf "$B/debs" "$B/apps-images.tar.zst"
	touch "$B/done"
	systemctl disable roam-firstboot.service
	echo "=== $(date) first start finished"
else
	echo "=== $(date) first start FAILED; it will run again at the next boot"
	exit 1
fi
