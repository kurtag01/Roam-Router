#!/usr/bin/env bash
# Builds teleport-client (UniFi Teleport, unofficial, MIT) with Roam's patch
# (roam-tun.patch: kernel TUN mode, socket marks, hook, status file).
#
#   src/teleport/build.sh <arm64|amd64> <output dir>
#     -> <output dir>/usr/sbin/teleport-client
#        <output dir>/usr/share/licenses/teleport-client/LICENSE
#
# Pinned by versions.env (upstream commit, Go version + checksum). Cached in
# ~/openwrt-ib/go (toolchain, module cache, built binaries keyed by commit + patch).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../versions.env"
ARCH=$1 OUT=$2
case "$ARCH" in arm64|amd64) ;; *) echo "arch must be arm64 or amd64" >&2; exit 1 ;; esac
W="$HOME/openwrt-ib/go"; mkdir -p "$W"
GOROOT_="$W/go$GO_VERSION"
if [[ ! -x $GOROOT_/bin/go ]]; then
  echo "Downloading Go $GO_VERSION ..."
  curl -fSL -o "$W/go$GO_VERSION.tgz" "https://go.dev/dl/go$GO_VERSION.linux-amd64.tar.gz"
  echo "$GO_SHA256  $W/go$GO_VERSION.tgz" | sha256sum -c -
  rm -rf "$GOROOT_"; mkdir -p "$GOROOT_"
  tar -xzf "$W/go$GO_VERSION.tgz" -C "$GOROOT_" --strip-components=1
  rm -f "$W/go$GO_VERSION.tgz"
fi
KEY="${TELEPORT_CLIENT_COMMIT:0:12}-$(sha256sum "$HERE/roam-tun.patch" | cut -c1-12)-go$GO_VERSION"
BIN="$W/bin/teleport-client-$KEY-$ARCH"
SRC="$W/src-$KEY"
if [[ ! -x $BIN ]]; then
  if [[ ! -d $SRC ]]; then
    rm -rf "$SRC.tmp"
    git clone -q "$TELEPORT_CLIENT_REPO" "$SRC.tmp"
    git -C "$SRC.tmp" -c advice.detachedHead=false checkout -q "$TELEPORT_CLIENT_COMMIT"
    git -C "$SRC.tmp" apply "$HERE/roam-tun.patch"
    mv "$SRC.tmp" "$SRC"
  fi
  mkdir -p "$W/bin"
  (cd "$SRC" && env PATH="$GOROOT_/bin:$PATH" GOROOT="$GOROOT_" GOPATH="$W/path" GOTOOLCHAIN=local \
     GOFLAGS=-mod=readonly CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" \
     go build -trimpath -ldflags "-s -w -X main.version=roam-${TELEPORT_CLIENT_COMMIT:0:7}" -o "$BIN.tmp" .)
  mv "$BIN.tmp" "$BIN"
fi
install -D -m 0755 "$BIN" "$OUT/usr/sbin/teleport-client"
install -D -m 0644 "$SRC/LICENSE" "$OUT/usr/share/licenses/teleport-client/LICENSE"
