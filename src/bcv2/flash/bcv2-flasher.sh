#!/usr/bin/env bash
# BCv2 easy flasher for macOS and Linux.
#
# Run it with:   bash bcv2-flasher.sh
#
# What it does, in order:
#   1. Downloads wchisp v0.3.0, the open-source WCH flashing tool, from its
#      GitHub release (github.com/ch32-rs/wchisp) and checks it against the
#      SHA-256 hash written below. It stops if the hash does not match.
#   2. Downloads the latest BCv2 firmware listed at
#      https://anasmalas.com/bcv2/firmware.json and checks it against the
#      SHA-256 hash in that list. It stops if the hash does not match.
#   3. Linux only: if no udev rule lets your user reach the card's USB
#      bootloader, it shows the rule and asks before adding it with sudo.
#   4. Waits for a card in bootloader mode, flashes and verifies it, and
#      turns the screen green (done) or red (failed). Repeat for more cards.
#
# It needs no admin rights apart from that optional udev rule, and keeps
# everything it downloads in one folder (printed when it starts). Delete
# that folder to remove it. Press Ctrl+C to quit.

set -euo pipefail

WCHISP_VERSION="v0.3.0"
MANIFEST_URL="https://anasmalas.com/bcv2/firmware.json"
FIRMWARE_PREFIX="https://anasmalas.com/"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64 | Linux-amd64)
    ASSET="linux-x64"
    WCHISP_SHA256="67e3d4eb0ffd3cc610d8927e3c3f452e2110531a3f14405dcaef87df219f200d" ;;
  Linux-aarch64 | Linux-arm64)
    ASSET="linux-aarch64"
    WCHISP_SHA256="3d7477c05c65f69091d041623a06c558c549dc27bfe2a043d9325f310f2ee40f" ;;
  Darwin-arm64)
    ASSET="macos-arm64"
    WCHISP_SHA256="a17dd422f7697bfe35c7c837c16bf99a7193300bcdc276c1253332b3a023e936" ;;
  Darwin-x86_64)
    ASSET="macos-x64"
    WCHISP_SHA256="ebbf46b0c64bb356cd58da2683c8809c50bdfe2181969f544933d24c8846f608" ;;
  *)
    echo "Sorry, there is no wchisp build for $(uname -s) $(uname -m)." >&2
    echo "Use the manual steps on https://anasmalas.com/bcv2/#update instead." >&2
    exit 1 ;;
esac

if [ "$(uname -s)" = "Darwin" ]; then
  CACHE="$HOME/Library/Caches/bcv2-flasher"
else
  CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/bcv2-flasher"
fi

die() {
  printf '\n%s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "This needs '$1', which was not found. Please install it and run this again."
}

need curl
need tar

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

fetch() {
  # HTTPS only, fail on HTTP errors, follow GitHub's redirect to its CDN.
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location -o "$2" "$1"
}

mkdir -p "$CACHE"
echo "BCv2 flasher. Files are kept in: $CACHE"

# 1. wchisp, checked against its pinned hash.
WCHISP="$CACHE/wchisp-$ASSET/wchisp"
ARCHIVE="$CACHE/wchisp-$WCHISP_VERSION-$ASSET.tar.gz"
if [ ! -f "$ARCHIVE" ] || [ "$(sha256_of "$ARCHIVE")" != "$WCHISP_SHA256" ]; then
  echo "Downloading wchisp $WCHISP_VERSION from GitHub..."
  fetch "https://github.com/ch32-rs/wchisp/releases/download/$WCHISP_VERSION/wchisp-$WCHISP_VERSION-$ASSET.tar.gz" "$ARCHIVE.part"
  mv "$ARCHIVE.part" "$ARCHIVE"
fi
[ "$(sha256_of "$ARCHIVE")" = "$WCHISP_SHA256" ] \
  || { rm -f "$ARCHIVE"; die "The wchisp download did not match its expected hash, so it was deleted and nothing was run."; }
tar -xzf "$ARCHIVE" -C "$CACHE"
chmod +x "$WCHISP"

# 2. Firmware, checked against the hash in the list on anasmalas.com.
echo "Checking for the latest firmware..."
MANIFEST="$(curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location "$MANIFEST_URL")" \
  || die "Could not reach $MANIFEST_URL."
field() {
  printf '%s' "$MANIFEST" | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p"
}
LATEST="$(field latest)"
FIRMWARE_URL="$(field download)"
FIRMWARE_SHA256="$(field sha256)"
case "$FIRMWARE_URL" in
  "$FIRMWARE_PREFIX"*) ;;
  *) die "The firmware list points somewhere unexpected ($FIRMWARE_URL), so nothing was downloaded." ;;
esac
case "$FIRMWARE_SHA256" in
  [0-9a-f]*) [ "${#FIRMWARE_SHA256}" -eq 64 ] || die "The firmware list has no valid hash." ;;
  *) die "The firmware list has no valid hash." ;;
esac
FIRMWARE="$CACHE/bcv2-rev1-product-$LATEST.bin"
if [ ! -f "$FIRMWARE" ] || [ "$(sha256_of "$FIRMWARE")" != "$FIRMWARE_SHA256" ]; then
  echo "Downloading firmware $LATEST..."
  fetch "$FIRMWARE_URL" "$FIRMWARE.part"
  mv "$FIRMWARE.part" "$FIRMWARE"
fi
[ "$(sha256_of "$FIRMWARE")" = "$FIRMWARE_SHA256" ] \
  || { rm -f "$FIRMWARE"; die "The firmware download did not match its expected hash, so it was deleted."; }

# 3. Linux: the card's bootloader must be reachable without sudo.
if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" -ne 0 ] \
  && ! grep -rqsi '55e0' /etc/udev/rules.d /usr/lib/udev/rules.d /lib/udev/rules.d; then
  RULE='SUBSYSTEM=="usb", ATTRS{idVendor}=="4348", ATTRS{idProduct}=="55e0", TAG+="uaccess"
SUBSYSTEM=="usb", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55e0", TAG+="uaccess"'
  echo
  echo "Linux needs a udev rule so your user can reach the card's USB bootloader"
  echo "(USB ID 4348:55e0 or 1a86:55e0) without sudo. It would add this file,"
  echo "/etc/udev/rules.d/60-bcv2-wchisp.rules:"
  echo
  printf '%s\n' "$RULE"
  echo
  printf 'Add it now? This asks for your password. [y/N] '
  read -r answer || answer=""
  case "$answer" in
    y | Y | yes | YES)
      printf '%s\n' "$RULE" | sudo tee /etc/udev/rules.d/60-bcv2-wchisp.rules >/dev/null
      sudo udevadm control --reload-rules
      sudo udevadm trigger ;;
    *)
      echo "Skipped. Without it the card may not be found; you can run this again any time." ;;
  esac
fi

# 4. The flashing screen.
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8* | *utf8* | *UTF8* | *utf-8*) BLOCK="██" ;;
  *) BLOCK="##" ;;
esac

glyph() {
  case "$1" in
    A) echo "01110 10001 11111 10001 10001" ;;
    D) echo "11110 10001 10001 10001 11110" ;;
    E) echo "11111 10000 11110 10000 11111" ;;
    F) echo "11111 10000 11110 10000 10000" ;;
    G) echo "01111 10000 10011 10001 01111" ;;
    H) echo "10001 10001 11111 10001 10001" ;;
    I) echo "11111 00100 00100 00100 11111" ;;
    L) echo "10000 10000 10000 10000 11111" ;;
    N) echo "10001 11001 10101 10011 10001" ;;
    O) echo "01110 10001 10001 10001 01110" ;;
    R) echo "11110 10001 11110 10100 10010" ;;
    S) echo "01111 10000 01110 00001 11110" ;;
    Y) echo "10001 01010 00100 00100 00100" ;;
  esac
}

big() {
  local word="$1" row line i letter bits j
  for row in 1 2 3 4 5; do
    line="  "
    for ((i = 0; i < ${#word}; i++)); do
      letter="${word:i:1}"
      bits="$(glyph "$letter" | cut -d ' ' -f "$row")"
      for ((j = 0; j < 5; j++)); do
        if [ "${bits:j:1}" = "1" ]; then line+="$BLOCK"; else line+="  "; fi
      done
      line+="  "
    done
    printf '%s\n' "$line"
  done
}

DONE_COUNT=0
FAILED_COUNT=0

show() {
  # $1: background colour code (40 black, 44 blue, 42 green, 41 red),
  # $2: big word, then the lines to print under it.
  local background="$1" word="$2"
  shift 2
  printf '\033[0;97;%sm\033[2J\033[H\n' "$background"
  big "$word"
  echo
  local line
  for line in "$@"; do printf '  %s\n' "$line"; done
  echo
  printf '  Done: %d   Failed: %d   Firmware: %s\n' "$DONE_COUNT" "$FAILED_COUNT" "$LATEST"
  printf '  Ctrl+C quits.\n'
}

bootloader_present() {
  local output
  output="$("$WCHISP" probe 2>&1 || true)"
  case "$output" in
    *"Found "[1-9]*" USB device"*) return 0 ;;
  esac
  return 1
}

trap 'printf "\033[0m\033[2J\033[H"; exit 0' INT TERM

show 40 READY "Plug DATA into this computer, then hold BOOT and plug in POWER." \
  "If the display lights up, it missed the bootloader: unplug POWER and press BOOT harder."
while true; do
  until bootloader_present; do sleep 0.25; done
  sleep 0.3
  show 44 FLASHING "Keep the card plugged in."
  if OUTPUT="$("$WCHISP" flash "$FIRMWARE" 2>&1)"; then
    DONE_COUNT=$((DONE_COUNT + 1))
    show 42 DONE "Card flashed and verified." "Unplug it. Plug in the next one, or press Ctrl+C to quit."
    printf '\a'
  else
    FAILED_COUNT=$((FAILED_COUNT + 1))
    # wchisp's last lines say what went wrong.
    detail=("")
    while IFS= read -r line; do detail+=("$line"); done < <(printf '%s\n' "$OUTPUT" | tail -n 4)
    show 41 FAILED "Unplug this card and try it again." "${detail[@]}"
    printf '\a'; sleep 0.2; printf '\a'
  fi
  # Keep the result up until this card leaves the bootloader.
  while bootloader_present; do sleep 0.25; done
done
