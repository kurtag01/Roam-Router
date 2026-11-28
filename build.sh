#!/usr/bin/env bash
# Builds the "Roam" OpenWrt travel-router image with the official OpenWrt Image Builder.
#
#   ./build.sh            Raspberry Pi 4 SD-card image  ->  output/*rpi-4*-factory.img.gz
#   ./build.sh x86test    x86-64 test image (with simulated Wi-Fi radios) for a QEMU VM
#   ./build.sh ct-arm64   router as a container rootfs (Roam host); ct-x86 for a test VM
#   ./build.sh host-bundle  installer folder for an existing Raspberry Pi OS
#   ./build.sh host-image   ready-to-flash Pi OS image with router + apps (needs Docker)
#   ./build.sh release      all of the above + output/release/ (versioned files, manifest,
#                           SHA256SUMS, and SHA256SUMS.sig if a signing key is available)
#
# Versions come from versions.env. The GitHub repository that updates are fetched from is
# $ROAM_REPO (owner/name), else taken from the "origin" git remote. Signing key: the file
# $ROAM_SIGNING_KEY_FILE, or the key itself in $ROAM_SIGNING_KEY (CI secret).
#
# No root needed. The Image Builder lives in ~/openwrt-ib (its Makefiles cannot handle
# the space in "OpenWRT Project").
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=versions.env
. "$HERE/versions.env"
VER="$OPENWRT_VERSION"
ROAM_REPO="${ROAM_REPO:-$(git -C "$HERE" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+/[^/]+)$#\1#p' | sed 's/\.git$//' || true)}"
PUBKEY="$HERE/keys/roam-release.pub"
# release_info <target>: the /etc/roam-release file baked into each build
release_info() {
  printf 'ROAM_VERSION=%s\nOPENWRT_VERSION=%s\nROAM_TARGET=%s\nROAM_REPO=%s\nROAM_BUILD_DATE=%s\n' \
    "$ROAM_VERSION" "$OPENWRT_VERSION" "$1" "$ROAM_REPO" "$(date -u +%Y-%m-%d)"
}
WORK="$HOME/openwrt-ib"
MODE="${1:-rpi4}"

if [[ $MODE == host-bundle ]]; then
  # Installer folder for the "Roam host" (Raspberry Pi OS + router container + apps).
  OUT="$HERE/output/roam-host"; rm -rf "$OUT"; mkdir -p "$OUT"
  cp -r "$HERE/src/host/." "$OUT/"
  cp "$HERE/output/container/roam-openwrt-arm64-rootfs.tar.gz" "$OUT/"
  release_info host > "$OUT/release"
  [[ -f $PUBKEY ]] && cp "$PUBKEY" "$OUT/release.pub"
  (cd "$HERE/output" && tar -czf roam-host.tar.gz roam-host && sha256sum roam-host.tar.gz > roam-host.tar.gz.sha256)
  echo "Done: $OUT and output/roam-host.tar.gz"; exit 0
fi

if [[ $MODE == host-image ]]; then
  # Ready-to-flash Raspberry Pi OS Lite (64-bit) image with the Roam host preinstalled:
  # router container + RomM + Plex install themselves at first boot, no Internet needed.
  # Needs Docker (any user in the "docker" group); run ct-arm64 + host-bundle first.
  PIOS_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-$PIOS_RELEASE/$PIOS_FILE"
  PI="$WORK/pi-os"; mkdir -p "$PI"
  XZ="$PI/$(basename "$PIOS_URL")"
  [[ -f $PI/base.img && $(cat "$PI/base.img.src" 2>/dev/null) == "$PIOS_FILE" ]] || rm -f "$PI/base.img"
  if [[ ! -f $PI/base.img ]]; then
    [[ -f $XZ ]] || curl -fSL -o "$XZ" "$PIOS_URL"
    (cd "$PI" && curl -fsSL "$PIOS_URL.sha256" | sha256sum -c -)
    xz -dkc "$XZ" > "$PI/base.img"
    echo "$PIOS_FILE" > "$PI/base.img.src"
  fi
  [[ -d $HERE/output/roam-host ]] || { echo "run ./build.sh host-bundle first" >&2; exit 1; }
  DK="docker --context default"; $DK info >/dev/null 2>&1 || DK=docker
  IMAGES=$(sed -n 's/^ *image: *//p' "$HERE/src/host/apps/compose.yml")
  B="$PI/bundle"; rm -rf "$B"; mkdir -p "$B"
  cp -r "$HERE/output/roam-host/." "$B/"
  cp "$HERE/src/host-image/firstboot.sh" "$HERE/src/host-image/roam-firstboot.service" "$B/"
  echo "Fetching app images (arm64): $IMAGES"
  for i in $IMAGES; do $DK pull -q --platform linux/arm64 "$i" >/dev/null; done
  $DK save --platform linux/arm64 $IMAGES | zstd -q -T0 -12 > "$B/apps-images.tar.zst"
  ls -la "$B/apps-images.tar.zst"
  # cloud-init settings for the boot partition: your own src/host-image/boot/user-data if it
  # exists (not in git: it holds your SSH key), else the template user-data.example.
  BOOTF="$PI/bootfiles"; rm -rf "$BOOTF"; mkdir -p "$BOOTF"
  SB="$HERE/src/host-image/boot"
  cp "$SB/meta-data" "$BOOTF/"
  if [[ -f $SB/user-data ]]; then cp "$SB/user-data" "$BOOTF/"; else cp "$SB/user-data.example" "$BOOTF/user-data"; fi
  [[ -f $SB/roam-options.txt ]] && cp "$SB/roam-options.txt" "$BOOTF/"
  OUTIMG="roam-host-pi4-$ROAM_VERSION.img"
  # Root needed only for loop-mounting the image: done inside a throw-away container.
  $DK run --rm --platform linux/amd64 --privileged -e OWNER="$(id -u):$(id -g)" -v "$PI:/pi" -v "$HERE/src/host-image:/mk:ro" -v "$BOOTF:/bootf:ro" \
     debian:trixie-slim /mk/make-image.sh /pi/base.img "/pi/$OUTIMG" /pi/bundle /bootf
  echo "Compressing ..."
  xz -T0 -6 -f "$PI/$OUTIMG"
  mv "$PI/$OUTIMG.xz" "$HERE/output/"
  (cd "$HERE/output" && sha256sum "$OUTIMG.xz" > "$OUTIMG.xz.sha256")
  rm -rf "$B"
  echo "Done: output/$OUTIMG.xz"; exit 0
fi

if [[ $MODE == release ]]; then
  # Everything a GitHub release needs, in output/release/.
  "$0" rpi4 && "$0" ct-arm64 && "$0" host-bundle && "$0" host-image
  R="$HERE/output/release"; rm -rf "$R"; mkdir -p "$R"; V="$ROAM_VERSION"
  cp "$HERE"/output/*roam*rpi-4-squashfs-factory.img.gz "$R/roam-$V-rpi4-factory.img.gz"
  cp "$HERE"/output/*roam*rpi-4-squashfs-sysupgrade.img.gz "$R/roam-$V-rpi4-sysupgrade.img.gz"
  cp "$HERE/output/roam-host.tar.gz" "$R/roam-host-$V.tar.gz"
  cp "$HERE/output/roam-host-pi4-$V.img.xz" "$R/"
  cat > "$R/roam-release.json" <<EOT
{
  "version": "$V",
  "openwrt": "$OPENWRT_VERSION",
  "date": "$(date -u +%Y-%m-%d)",
  "repo": "$ROAM_REPO",
  "files": {
    "rpi4": "roam-$V-rpi4-sysupgrade.img.gz",
    "rpi4-factory": "roam-$V-rpi4-factory.img.gz",
    "host": "roam-host-$V.tar.gz",
    "host-image": "roam-host-pi4-$V.img.xz"
  }
}
EOT
  (cd "$R" && sha256sum roam-* > SHA256SUMS)
  "$0" sign "$R/SHA256SUMS"
  ls -la "$R"; echo "Done: output/release (version $V)"; exit 0
fi

if [[ $MODE == sign ]]; then
  # sign <file>: writes <file>.sig with the release key (usign/signify Ed25519 format).
  F="$2"; USIGN=$(ls "$WORK"/openwrt-imagebuilder-*/staging_dir/host/bin/usign 2>/dev/null | head -1)
  [[ -n $USIGN ]] || { echo "usign not found (build any image first)" >&2; exit 1; }
  KEYF="${ROAM_SIGNING_KEY_FILE:-}"; TMPK=""
  if [[ -z $KEYF && -n ${ROAM_SIGNING_KEY:-} ]]; then TMPK=$(mktemp); printf '%s\n' "$ROAM_SIGNING_KEY" > "$TMPK"; KEYF="$TMPK"; fi
  if [[ -z $KEYF ]]; then echo "WARNING: no signing key; $F is NOT signed (routers will refuse it)" >&2; exit 0; fi
  "$USIGN" -S -m "$F" -s "$KEYF" -x "$F.sig"; [[ -n $TMPK ]] && rm -f "$TMPK"
  "$USIGN" -V -m "$F" -p "$PUBKEY" -x "$F.sig" -q && echo "Signed $F (verified against keys/roam-release.pub)"
  exit 0
fi

case "$MODE" in
  rpi4)    TGT="bcm27xx/bcm2711"; TGTN="bcm27xx-bcm2711"; PROFILE="rpi-4" ;;
  x86test) TGT="x86/64";          TGTN="x86-64";          PROFILE="generic" ;;
  # Router as an LXC container on Raspberry Pi OS (aarch64) / test VM (x86_64):
  ct-arm64) TGT="armsr/armv8";     TGTN="armsr-armv8";     PROFILE="generic" ;;
  ct-x86)  TGT="x86/64";           TGTN="x86-64";          PROFILE="generic" ;;
  *) echo "usage: $0 [rpi4|x86test|ct-arm64|ct-x86|host-bundle|host-image|release]" >&2; exit 1 ;;
esac
CONTAINER=0; [[ $MODE == ct-* ]] && CONTAINER=1

# Packages on top of the stock image.
PKGS=(
  luci luci-ssl                       # web UI (HTTPS available)
  -wpad-basic-mbedtls wpad-mbedtls    # full WPA2/WPA3 + Enterprise support
  kmod-mac80211 iwinfo usbutils
  # Panda USB Wi-Fi adapters by chipset:
  kmod-rt2800-usb rt2800-usb-firmware # PAU05/PAU06/PAU09 (Ralink RT3070/RT5372/RT5572)
  kmod-mt76x0u                        # PAU0A-type (MediaTek MT7610U)
  kmod-mt76x2u                        # PAU0D (MediaTek MT7612U)
  kmod-mt7921u                        # PAU0F AXE3000 (MediaTek MT7921AU, Wi-Fi 6/6E)
  # USB tethering (Android, iPhone):
  kmod-usb-net-rndis kmod-usb-net-cdc-ether kmod-usb-net-cdc-ncm kmod-usb-net-ipheth usbmuxd
  # VPN:
  luci-proto-wireguard wireguard-tools qrencode
  luci-app-openvpn openvpn-mbedtls
  # Encrypted DNS (DNS-over-HTTPS):
  https-dns-proxy luci-app-https-dns-proxy
  # Notifications by email (phone push uses the built-in wget):
  msmtp
)
[[ $MODE == x86test ]] && PKGS+=(kmod-mac80211-hwsim ip-full kmod-veth)
# Container: the host's kernel and drivers are used, so no kernel modules/firmware/USB tools.
if (( CONTAINER )); then
  PKGS=(luci luci-ssl -wpad-basic-mbedtls wpad-mbedtls wifi-scripts iwinfo iw
        luci-proto-wireguard wireguard-tools qrencode luci-app-openvpn openvpn-mbedtls
        https-dns-proxy luci-app-https-dns-proxy msmtp)
fi

IBNAME="openwrt-imagebuilder-$VER-$TGTN.Linux-x86_64"
IB="$WORK/$IBNAME"
mkdir -p "$WORK"
# GNU awk is required; use a private copy in ~/openwrt-ib/hostbin if the system lacks it.
if ! command -v gawk >/dev/null; then
  if [[ ! -x $WORK/hostbin/gawk ]]; then
    echo "GNU awk missing: fetching Ubuntu's gawk package (no install, no root) ..."
    T=$(mktemp -d); (cd "$T" && apt download gawk >/dev/null && dpkg-deb -x gawk_*.deb x)
    mkdir -p "$WORK/hostbin"; cp "$T/x/usr/bin/gawk" "$WORK/hostbin/"; ln -sf gawk "$WORK/hostbin/awk"; rm -rf "$T"
  fi
  export PATH="$WORK/hostbin:$PATH"
fi
if [[ ! -d $IB ]]; then
  URL="https://downloads.openwrt.org/releases/$VER/targets/$TGT"
  echo "Downloading Image Builder for $TGT ..."
  SHA=$(curl -fsSL "$URL/sha256sums" | awk -v f="*$IBNAME.tar.zst" '$2==f{print $1}')
  [[ -n $SHA ]] || { echo "no checksum for $IBNAME in $URL/sha256sums" >&2; exit 1; }
  # A cached download (e.g. CI cache) is reused if its checksum still matches.
  echo "$SHA  $WORK/$IBNAME.tar.zst" | sha256sum -c --status - 2>/dev/null || curl -fSL -o "$WORK/$IBNAME.tar.zst" "$URL/$IBNAME.tar.zst"
  echo "$SHA  $WORK/$IBNAME.tar.zst" | sha256sum -c -
  tar --zstd -xf "$WORK/$IBNAME.tar.zst" -C "$WORK"
fi

# Stage the overlay files in a path without spaces, with correct permissions.
STAGE="$WORK/files-$MODE"
mkdir -p "$STAGE"
rsync -a --delete "$HERE/src/files/" "$STAGE/"
[[ $MODE == x86test || $MODE == ct-x86 ]] && rsync -a "$HERE/src/test-files/" "$STAGE/"
(( CONTAINER )) && rsync -a "$HERE/src/container-files/" "$STAGE/"
sed -i "s|roam.css?v=1|roam.css?v=$(date +%Y%m%d%H%M)|" "$STAGE/usr/share/ucode/luci/template/themes/roam/header.ut"
chmod 0755 "$STAGE/etc/init.d/"* "$STAGE/etc/uci-defaults/"* "$STAGE/usr/libexec/roam/"*
# Version stamp + release key for the updater (/usr/libexec/roam/update).
case "$MODE" in rpi4) T=rpi4 ;; x86test) T=x86test ;; *) T=container ;; esac
release_info "$T" > "$STAGE/etc/roam-release"
mkdir -p "$STAGE/etc/roam"
if [[ -f $PUBKEY ]]; then cp "$PUBKEY" "$STAGE/etc/roam/release.pub"; else rm -f "$STAGE/etc/roam/release.pub"; fi
# UniFi Teleport client (experimental VPN option), built from pinned source.
case "$MODE" in rpi4|ct-arm64) GOARCH_=arm64 ;; *) GOARCH_=amd64 ;; esac
"$HERE/src/teleport/build.sh" "$GOARCH_" "$STAGE"
chmod 0755 "$STAGE/lib/netifd/proto/teleport.sh" "$STAGE/lib/netifd/teleport-hook"

mkdir -p "$IB/tmp"
make -C "$IB" image PROFILE="$PROFILE" PACKAGES="${PKGS[*]}" FILES="$STAGE" \
     EXTRA_IMAGE_NAME="roam" ROOTFS_PARTSIZE=512

mkdir -p "$HERE/output"
OUTDIR="$IB/bin/targets/$TGT"
if (( CONTAINER )); then
  mkdir -p "$HERE/output/container"
  ARCH=${MODE#ct-}
  cp -v "$OUTDIR"/*roam-$TGTN-generic-rootfs.tar.gz "$HERE/output/container/roam-openwrt-$ARCH-rootfs.tar.gz"
  (cd "$HERE/output/container" && sha256sum *.tar.gz > SHA256SUMS)
elif [[ $MODE == rpi4 ]]; then
  cp -v "$OUTDIR"/*roam*rpi-4-squashfs-factory.img.gz "$OUTDIR"/*roam*rpi-4-squashfs-sysupgrade.img.gz "$HERE/output/"
  cp -v "$OUTDIR"/*roam*rpi-4.manifest "$HERE/output/" 2>/dev/null || true
  (cd "$HERE/output" && sha256sum *.img.gz > SHA256SUMS)
else
  mkdir -p "$HERE/output/test-vm"
  cp -v "$OUTDIR"/*roam*generic-ext4-combined-efi.img.gz "$HERE/output/test-vm/"
fi
echo "Done. Images are in: $HERE/output"
