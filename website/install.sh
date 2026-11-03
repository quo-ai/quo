#!/bin/sh
# Installs the Quo desktop app (https://quo.computer) for you, from its latest GitHub release:
#   curl -fsSL https://quo.computer/install.sh | sh
# macOS: Quo.app in /Applications (or ~/Applications). Linux: the AppImage in ~/.local/bin, with a menu entry.
# The download is checked against the SHA-512 the release publishes. No admin rights. Run it again to update.
# Windows: in PowerShell, irm https://quo.computer/install.ps1 | iex
set -eu

RELEASES=https://github.com/quo-ai/quo/releases/latest/download
say() { printf '%s\n' "$*"; }
fail() { printf 'Quo: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "this needs curl."
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t quo)
trap 'rm -rf "$tmp"' EXIT INT TERM

# The SHA-512 (base64) a release list (latest*.yml) gives for a file.
expected() {
  curl -fsSL "$RELEASES/$2" | awk -v f="$1" '$1 == "-" && $2 == "url:" { found = ($3 == f); next } found && $1 == "sha512:" { print $2; exit }'
}

# Downloads a file from the latest release and checks it against the release's checksum.
fetch() {
  say "Downloading $1..."
  curl -fL --progress-bar -o "$tmp/$1" "$RELEASES/$1"
  sum=$(expected "$1" "$2")
  [ -n "$sum" ] || fail "the release doesn't list a checksum for $1."
  if command -v openssl >/dev/null 2>&1; then
    got=$(openssl dgst -sha512 -binary "$tmp/$1" | openssl base64 -A)
  elif command -v sha512sum >/dev/null 2>&1 && command -v xxd >/dev/null 2>&1; then
    got=$(sha512sum "$tmp/$1" | cut -d' ' -f1 | xxd -r -p | base64 | tr -d '\n')
  else
    fail "this needs openssl (or sha512sum and xxd) to check the download."
  fi
  [ "$got" = "$sum" ] || fail "the download doesn't match the release's checksum, so it wasn't installed. Try again."
  say "Checked: it matches the release."
  if [ "${QUO_DRY_RUN:-}" = 1 ]; then say "(Dry run: nothing installed.)"; exit 0; fi
}

case "$(uname -s)" in
  Darwin)
    fetch Quo-mac-universal.zip latest-mac.yml
    dest=/Applications
    [ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
    rm -rf "$dest/Quo.app"
    ditto -x -k "$tmp/Quo-mac-universal.zip" "$dest"
    say "Installed $dest/Quo.app. Run this again to update."
    open "$dest/Quo.app" || true
    ;;
  Linux)
    case "$(uname -m)" in
      x86_64 | amd64) file=Quo-linux-x86_64.AppImage list=latest-linux.yml deb=Quo-linux-amd64.deb ;;
      aarch64 | arm64) file=Quo-linux-arm64.AppImage list=latest-linux-arm64.yml deb=Quo-linux-arm64.deb ;;
      *) fail "there's no Quo build for $(uname -m) yet." ;;
    esac
    fetch "$file" "$list"
    data=${XDG_DATA_HOME:-$HOME/.local/share}
    bin=$HOME/.local/bin
    mkdir -p "$bin" "$data/applications" "$data/icons"
    install -m 755 "$tmp/$file" "$bin/quo"
    curl -fsSL -o "$data/icons/quo.png" https://quo.computer/assets/brand/quo-app-icon-1024.png || true
    # Named as the app names itself (its window class), so the taskbar shows Quo's icon and quo:// links open Quo.
    rm -f "$data/applications/quo.desktop"
    cat > "$data/applications/quo-desktop.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Quo
Comment=Private AI that works offline
Exec="$bin/quo" %U
Icon=$data/icons/quo.png
Categories=Utility;Office;
StartupWMClass=quo-desktop
MimeType=x-scheme-handler/quo;
EOF
    if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$data/applications" >/dev/null 2>&1 || true; fi
    if command -v xdg-mime >/dev/null 2>&1; then xdg-mime default quo-desktop.desktop x-scheme-handler/quo >/dev/null 2>&1 || true; fi
    say "Installed $bin/quo, with Quo in your app menu. It updates itself."
    if ! (ldconfig -p 2>/dev/null || true) | grep -q 'libfuse\.so\.2'; then
      say "The AppImage needs FUSE 2 (Ubuntu and Debian: sudo apt install libfuse2t64). Or install the .deb instead: $RELEASES/$deb"
    fi
    case ":$PATH:" in *":$bin:"*) ;; *) say "To start it from a terminal as 'quo', add $bin to your PATH." ;; esac
    ;;
  *) fail "on Windows, run this in PowerShell instead:  irm https://quo.computer/install.ps1 | iex" ;;
esac
