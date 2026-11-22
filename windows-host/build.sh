#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
root="$(cd .. && pwd)"
compiler="${MAKENSIS:-makensis}"
mkdir -p "$PWD/dist" "$root/artifacts/msfwr/public/downloads"
host="$PWD/dist/Msfwr.exe"
target="$root/artifacts/msfwr/public/downloads/msfwr-Setup-x64.exe"
signing=()
if [[ $# -ne 0 ]]; then
  if [[ $# -ne 2 || $1 != --sign-with || $2 != /* || ! -f $2 || ! -x $2 || ! $2 =~ ^[a-zA-Z0-9_./-]+$ ]]; then
    echo 'Usage: bash build.sh [--sign-with /absolute/path/to/signer]' >&2
    exit 2
  fi
  if ! "$compiler" -CMDHELP '!uninstfinalize' 2>&1 | grep -q '^Usage: !uninstfinalize '; then
    echo 'Signing requires a newer NSIS with !uninstfinalize support. Set MAKENSIS to its executable path.' >&2
    exit 2
  fi
  # Keep provider output out of the preview until a Windows trust check passes.
  tmp="$(mktemp -d "$PWD/dist/signing.XXXXXXXX")"
  trap 'rm -rf -- "$tmp"' EXIT
  host="$tmp/Msfwr.exe"
  target="$tmp/msfwr-Setup-x64.exe"
  signing=(-DRELEASE_SIGNER="$2")
fi
# Version shown in the Msfwr window and in Windows Settings > Apps. The release
# workflow sets MSFWR_VERSION to the tag; local builds use git describe.
version="${MSFWR_VERSION:-$(git -C "$root" describe --tags --always 2>/dev/null || echo dev)}"
if [[ ! $version =~ ^v?[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$ ]]; then
  version=dev
fi
display_version="${version#v}"
if [[ ! $display_version =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  display_version=0.0.0
fi
# Per-company provisioning (optional). The admin console emits a build command
# that bakes a company's relay URL, RA ID and signed license into the
# installer, so its PCs need no manual setup. Values are validated here so a
# malformed one does not silently ship.
ldflags="-s -w -H=windowsgui -X main.version=$version"
if [[ -n ${MSFWR_EMBED_RELAY:-} || -n ${MSFWR_EMBED_RA:-} || -n ${MSFWR_EMBED_LICENSE:-} ]]; then
  if [[ ! ${MSFWR_EMBED_RELAY:-} =~ ^https://[A-Za-z0-9.-]+$ ]]; then
    echo 'MSFWR_EMBED_RELAY must be an https origin, e.g. https://support.example.com' >&2; exit 2
  fi
  if [[ ! ${MSFWR_EMBED_RA:-} =~ ^[0-9]{6}$ ]]; then
    echo 'MSFWR_EMBED_RA must be a six-digit RA ID.' >&2; exit 2
  fi
  if [[ -n ${MSFWR_EMBED_LICENSE:-} && ! ${MSFWR_EMBED_LICENSE} =~ ^L1(\.[A-Za-z0-9_-]+){5}$ ]]; then
    echo 'MSFWR_EMBED_LICENSE is not a valid license token.' >&2; exit 2
  fi
  ldflags+=" -X main.embeddedRelay=${MSFWR_EMBED_RELAY} -X main.embeddedRA=${MSFWR_EMBED_RA} -X main.embeddedLicense=${MSFWR_EMBED_LICENSE:-}"
  echo "Building a per-company client for RA-${MSFWR_EMBED_RA} on ${MSFWR_EMBED_RELAY}"
fi
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="$ldflags" -o "$host" .
if (( ${#signing[@]} )); then
  "$2" "$host"
fi
"$compiler" -V2 -DHOST_FILE="$host" -DINSTALLER="$target" -DVERSION="$display_version" "${signing[@]}" installer.nsi
if (( ${#signing[@]} )); then
  release="$(mktemp -d "$PWD/dist/release.XXXXXXXX")"
  mv -- "$host" "$target" "$release/"
  target="$release/msfwr-Setup-x64.exe"
fi
ls -lh "$target"
