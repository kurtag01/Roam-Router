#!/bin/bash
# Builds the ready-to-flash Roam host image. Runs as root inside a throw-away privileged
# Debian container (build.sh host-image); nothing on the build machine needs root.
#   make-image.sh <pi-os-lite.img> <out.img> <bundle dir> <boot files dir>
set -euo pipefail
BASE=$1 OUT=$2 BUNDLE=$3 BOOTF=$4
W=/tmp/mk; mkdir -p $W
PKGS="lxc iw rfkill usbmuxd openssl zstd curl docker.io docker-compose"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq fdisk e2fsprogs >/dev/null

part() { sfdisk -d "$1" | sed -n "s|^.*img$2 : start= *\([0-9]*\), size= *\([0-9]*\),.*|\1 \2|p"; }

echo "== Copying Raspberry Pi OS"
cp --sparse=always "$BASE" "$OUT"
NEED=$(( $(du -sm "$BUNDLE" | cut -f1) + 700 ))   # bundle + packages + slack, MB
truncate -s +${NEED}M "$OUT"
echo ", +" | sfdisk -q -N 2 --no-reread --no-tell-kernel "$OUT"
read -r S1 N1 < <(part "$OUT" 1); read -r S2 N2 < <(part "$OUT" 2)
L1=$(losetup -f --show -o $((S1*512)) --sizelimit $((N1*512)) "$OUT")
L2=$(losetup -f --show -o $((S2*512)) --sizelimit $((N2*512)) "$OUT")
cleanup() { umount -q $W/boot $W/root 2>/dev/null; losetup -d $L1 $L2 2>/dev/null; }
trap cleanup EXIT
e2fsck -fy $L2 >/dev/null || [ $? -le 2 ]
resize2fs -p $L2 >/dev/null
mkdir -p $W/boot $W/root
mount $L1 $W/boot; mount $L2 $W/root
R=$W/root

echo "== Downloading Pi OS (arm64) packages: $PKGS"
# apt runs here (amd64) but resolves against the image's own package database and sources.
cp $R/usr/share/keyrings/*.pgp /usr/share/keyrings/ 2>/dev/null || true
cp $R/usr/share/keyrings/*.gpg /usr/share/keyrings/ 2>/dev/null || true
D=$R/opt/roam-setup/debs; mkdir -p $D/partial $W/lists/partial $W/cache
APT=(-o Dir::Etc::Parts=$R/etc/apt/apt.conf.d -o Dir::State::status=$R/var/lib/dpkg/status
	-o Dir::State::Lists=$W/lists -o Dir::Cache=$W/cache -o Dir::Cache::archives=$D
	-o Dir::Etc::SourceList=/dev/null -o Dir::Etc::SourceParts=$R/etc/apt/sources.list.d
	-o Dir::Etc::Preferences=/dev/null -o Dir::Etc::PreferencesParts=$R/etc/apt/preferences.d
	-o APT::Architecture=arm64 -o APT::Architectures::=arm64 -o Debug::NoLocking=1
	-o APT::Get::Download-Only=1 -o DPkg::Pre-Install-Pkgs::= -o APT::Update::Post-Invoke::=)
apt-get "${APT[@]}" update -qq
apt-get "${APT[@]}" install -y -qq $PKGS >/dev/null
rm -rf $D/partial $D/lock
# Check: the bundled .debs alone (plus what the image already has) must satisfy every
# dependency. apt sees ONLY a local repository made from them, and must resolve the
# install with nothing missing. (dpkg --dry-run would not check dependencies.)
apt-get install -y -qq apt-utils >/dev/null
offline_check() {   # offline_check <dir with .debs>
	local C=$W/chk; rm -rf $C; mkdir -p $C/lists/partial $C/cache/archives/partial
	(cd "$1" && apt-ftparchive packages . > Packages 2>/dev/null)
	echo "deb [trusted=yes] file:$1 ./" > $C/local.list
	local O=(-o Dir::State::status=$R/var/lib/dpkg/status -o Dir::State::Lists=$C/lists -o Dir::Cache=$C/cache
		-o Dir::Etc::SourceList=$C/local.list -o Dir::Etc::SourceParts=/dev/null -o Dir::Etc::Parts=/dev/null
		-o APT::Architecture=arm64 -o APT::Architectures::=arm64 -o Debug::NoLocking=1)
	apt-get "${O[@]}" update -qq >/dev/null 2>&1
	apt-get "${O[@]}" -s install $PKGS > $C/sim.txt 2>&1; local rc=$?
	rm -f "$1/Packages"; return $rc
}
offline_check $D || { tail -15 $W/chk/sim.txt; echo "ERROR: bundled packages do not install offline" >&2; exit 1; }
echo "   offline install check: $(grep -c '^Inst ' $W/chk/sim.txt) packages, nothing missing"
echo "   $(ls $D/*.deb | wc -l) packages, $(du -sh $D | cut -f1)"

echo "== Adding the Roam bundle"
cp -r "$BUNDLE/." $R/opt/roam-setup/
chown -R root:root $R/opt/roam-setup
chmod 700 $R/opt/roam-setup
chmod 755 $R/opt/roam-setup/install.sh $R/opt/roam-setup/firstboot.sh
install -m 644 $R/opt/roam-setup/roam-firstboot.service $R/etc/systemd/system/
ln -sf ../roam-firstboot.service $R/etc/systemd/system/multi-user.target.wants/roam-firstboot.service

echo "== First-boot settings (boot partition)"
for f in user-data meta-data roam-options.txt; do [ -f "$BOOTF/$f" ] && cp "$BOOTF/$f" $W/boot/; done
ls $W/boot | grep -E 'user-data|meta-data|roam-options' | tr '\n' ' '; echo
df -h $R | tail -1
sync
cleanup; trap - EXIT
[ -n "${OWNER:-}" ] && chown "$OWNER" "$OUT"
