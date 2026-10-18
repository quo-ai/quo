#!/usr/bin/env bash
# Sandboxed Android dev loop: build the dev client in a rootless podman
# container and run it on a USB-connected phone, with Metro live reload.
#
#   npm run sandbox            # first run: image + deps + build/install, then Metro
#   npm run sandbox -- build   # rebuild + reinstall native app (after native changes)
#   npm run sandbox -- help    # all commands
#
# Isolation: the repo is mounted READ-ONLY (source, .git, .vscode can't be
# modified from inside); all writable state — node_modules, Gradle caches,
# build dirs, adb keys — lives in podman volumes. android/signing.properties
# is masked. Only the phone's single USB device node is passed through. No
# capabilities, no-new-privileges, read-only root fs, SELinux enforced.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="localhost/quo-android-dev:1"
CTR="quo-android-dev"
APP_ID="com.quo.app"
METRO_PORT=8081

# volume-name:path-in-repo — the writable overlays on the read-only repo.
BUILD_VOLUMES=(
  "quo-sbx-node-modules:node_modules"
  "quo-sbx-expo:.expo"
  "quo-sbx-android-gradle:android/.gradle"
  "quo-sbx-android-kotlin:android/.kotlin"
  "quo-sbx-android-build:android/build"
  "quo-sbx-app-build:android/app/build"
  "quo-sbx-app-cxx:android/app/.cxx"
  "quo-sbx-pack-build:android/starter_model_pack/build"
  "quo-sbx-assetpacks-build:modules/asset-packs/android/build"
)
HOME_VOLUME="quo-sbx-home" # ~/.gradle, ~/.android (adb key), ~/.npm, ~/.expo

# Host files hidden from the container (masked with /dev/null if present).
MASKED_FILES=(
  "android/signing.properties"
  "GoogleService-Info.plist"
  ".env"
  ".env.local"
)

die() { echo "android-sandbox: $*" >&2; exit 1; }
info() { echo "==> $*"; }

# /dev/bus/usb/BBB/DDD of the first device exposing an ADB interface
# (class ff / subclass 42 / protocol 01), or empty.
find_adb_usb_node() {
  local intf dev
  for intf in /sys/bus/usb/devices/*:*; do
    [[ -r "$intf/bInterfaceClass" ]] || continue
    [[ "$(cat "$intf/bInterfaceClass")$(cat "$intf/bInterfaceSubClass")$(cat "$intf/bInterfaceProtocol")" == "ff4201" ]] || continue
    dev="${intf%:*}"
    printf '/dev/bus/usb/%03d/%03d\n' "$((10#$(cat "$dev/busnum")))" "$((10#$(cat "$dev/devnum")))"
    return 0
  done
}

ctr_running() { [[ "$(podman container inspect -f '{{.State.Running}}' "$CTR" 2>/dev/null)" == "true" ]]; }
ctr_usb_node() { podman container inspect -f '{{index .Config.Labels "quo.usb"}}' "$CTR" 2>/dev/null || true; }
# Recreate the container whenever its run flags (this script, env opt-ins) change.
script_hash() { { cat "${BASH_SOURCE[0]}"; echo "${QUO_SANDBOX_BUNDLED_MODEL:-0}"; } | sha256sum | cut -c1-12; }
ctr_script_hash() { podman container inspect -f '{{index .Config.Labels "quo.script"}}' "$CTR" 2>/dev/null || true; }

in_ctr() {
  local tty=()
  [[ -t 0 && -t 1 ]] && tty=(-it)
  podman exec "${tty[@]}" -w /workspace "$CTR" "$@"
}

cmd_image() {
  info "Building toolchain image (first time: ~10 min, ~8 GB)"
  podman build -t "$IMAGE" -f "$ROOT/scripts/sandbox/Containerfile" "$ROOT/scripts/sandbox"
}

# Prints the phone's USB node if it can be passed through; otherwise prints
# why not to stderr and returns 1.
usable_usb_node() {
  local node
  node="$(find_adb_usb_node)"
  if [[ -z "$node" ]]; then
    echo "no phone with USB debugging found. Plug it in, enable Developer options > USB debugging, and pick 'File transfer' if asked." >&2
    return 1
  fi
  if [[ ! -r "$node" || ! -w "$node" ]]; then
    echo "$node is not accessible to $(id -un). Unlock the phone and replug, or install udev rules (sudo dnf install android-tools) and replug." >&2
    return 1
  fi
  # Fedora/SELinux: confined containers can't open passed-through devices
  # unless this boolean is on (it only covers devices given via --device).
  if command -v getsebool > /dev/null && [[ "$(getenforce 2>/dev/null)" == "Enforcing" ]] \
     && getsebool container_use_devices 2>/dev/null | grep -q -- '--> off'; then
    echo "SELinux blocks USB passthrough. Run once: sudo setsebool -P container_use_devices on" >&2
    return 1
  fi
  echo "$node"
}

# True when every masked host file still reads as empty inside the container.
masks_intact() {
  local f
  for f in "${MASKED_FILES[@]}"; do
    [[ -e "$ROOT/$f" ]] || continue
    [[ "$(podman exec "$CTR" sh -c "wc -c < /workspace/$f 2>/dev/null || echo 0")" == "0" ]] || return 1
  done
}

# Starts the container. Without a usable phone it still starts (builds work)
# and is recreated with the device once the phone becomes usable.
cmd_up() {
  local node
  node="$(usable_usb_node 2> /dev/null)" || node="none"

  if ctr_running; then
    [[ "$(ctr_usb_node)" == "$node" && "$(ctr_script_hash)" == "$(script_hash)" ]] && masks_intact && return 0
    info "Phone USB state or sandbox config changed (phone: $node) — recreating container"
  fi
  podman rm -f "$CTR" > /dev/null 2>&1 || true

  podman image exists "$IMAGE" || cmd_image

  local args=() spec vol path f
  for spec in "${BUILD_VOLUMES[@]}"; do
    vol="${spec%%:*}"; path="${spec#*:}"
    # Mountpoints must already exist inside the read-only bind mount.
    mkdir -p "$ROOT/$path"
    # :z (shared SELinux label) so files survive container re-creation —
    # each container gets new MCS categories and would be denied access to
    # files a previous one created.
    args+=(-v "$vol:/workspace/$path:z")
  done
  for f in "${MASKED_FILES[@]}"; do
    [[ -e "$ROOT/$f" ]] && args+=(-v "/dev/null:/workspace/$f:ro")
  done
  # A file mask is bound to the file's inode: if the host file is replaced
  # (editors, sed -i), the new file shows through. Record what was masked so
  # cmd_up can detect that and recreate the container.
  # A locally fetched 530 MB starter model would be merged into every debug
  # APK and pushed over USB on each install; hide it so the app downloads it
  # once instead (reinstalls keep app data). QUO_SANDBOX_BUNDLED_MODEL=1 keeps
  # both copies; =pack keeps only the asset-pack copy (for `npm run sandbox --
  # bundle`, which tests real fast-follow delivery).
  local bundled="${QUO_SANDBOX_BUNDLED_MODEL:-0}"
  local pack_models="android/starter_model_pack/src/main/assets/bundled-models"
  local debug_models="android/app/src/debug/assets/bundled-models"
  if [[ -d "$ROOT/$pack_models" && "$bundled" != "1" && "$bundled" != "pack" ]]; then
    args+=(--tmpfs "/workspace/$pack_models:ro,size=4k,notmpcopyup")
  fi
  if [[ -d "$ROOT/$debug_models" && "$bundled" != "1" ]]; then
    args+=(--tmpfs "/workspace/$debug_models:ro,size=4k,notmpcopyup")
  fi

  local dev=()
  if [[ "$node" == "none" ]]; then
    usable_usb_node > /dev/null 2>&1 || echo "android-sandbox: starting without phone — $(usable_usb_node 2>&1 >/dev/null)" >&2
  else
    dev=(--device "$node")
  fi

  info "Starting sandbox container (phone: $node)"
  podman run -d --init --name "$CTR" \
    --label "quo.usb=$node" --label "quo.script=$(script_hash)" \
    --userns=keep-id --user "$(id -u):$(id -g)" \
    --cap-drop=ALL --security-opt=no-new-privileges \
    --read-only --tmpfs /tmp:rw,exec,size=4g \
    --memory=18g --pids-limit=8192 \
    --cpus="$SANDBOX_CPUS" \
    "${dev[@]}" \
    -p "127.0.0.1:$METRO_PORT:$METRO_PORT" \
    -e EXPO_NO_TYPESCRIPT_SETUP=1 -e EXPO_UNSTABLE_HEADLESS=1 \
    -e REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 \
    -v "$ROOT:/workspace:ro,z" \
    -v "$HOME_VOLUME:/home/dev:z" \
    "${args[@]}" \
    "$IMAGE" > /dev/null

  # Sandbox-only Gradle tuning (repo's gradle.properties untouched): each
  # native module's ninja runs ~nproc clang jobs, so unbounded parallel
  # CMake tasks blow through the memory cap.
  in_ctr sh -c 'mkdir -p ~/.gradle && printf "org.gradle.workers.max=4\n" > ~/.gradle/gradle.properties'
  in_ctr adb start-server > /dev/null 2>&1 || true
}

# Leave two cores for the desktop: an uncapped native build saturates every
# core and makes the whole machine unresponsive.
SANDBOX_CPUS=$(( $(nproc) > 4 ? $(nproc) - 2 : 2 ))

cmd_down() { podman rm -f "$CTR" > /dev/null 2>&1 || true; info "Sandbox stopped"; }

# npm ci inside the sandbox whenever package-lock.json changes.
cmd_deps() {
  cmd_up
  local want have
  want="$(sha256sum "$ROOT/package-lock.json" | cut -d' ' -f1)"
  have="$(in_ctr cat node_modules/.sandbox-lock-sha 2>/dev/null || true)"
  [[ "$want" == "$have" ]] && return 0
  info "Installing dependencies in sandbox (npm ci)"
  in_ctr sh -c 'find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} + && npm ci --no-audit --no-fund'
  in_ctr sh -c "echo $want > node_modules/.sandbox-lock-sha"
}

wait_for_device() {
  local state
  cmd_up
  [[ "$(ctr_usb_node)" != "none" ]] || die "$(usable_usb_node 2>&1 > /dev/null)"
  for _ in $(seq 1 30); do
    state="$(in_ctr adb get-state 2>&1 || true)"
    case "$state" in
      device*) return 0 ;;
      *unauthorized*) echo "Phone shows 'Allow USB debugging?' — tap Allow (tick 'Always allow')." ;;
    esac
    sleep 2
  done
  die "phone not ready over adb: $state"
}

cmd_build() {
  cmd_deps
  wait_for_device
  info "Building + installing dev client (arm64, debug)"
  in_ctr npx expo run:android --no-bundler "$@"
}

# Build the App Bundle and install it the way Play would (bundletool local
# testing): device-specific splits plus the fast-follow starter pack, which
# the app then "downloads" from local storage. Tests the real first-run flow.
BUNDLETOOL_VERSION=1.18.3
cmd_bundle() {
  export QUO_SANDBOX_BUNDLED_MODEL=pack
  cmd_deps
  wait_for_device
  in_ctr sh -c "test -s ~/bundletool-$BUNDLETOOL_VERSION.jar || curl -fsSL -o ~/bundletool-$BUNDLETOOL_VERSION.jar https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/bundletool-all-$BUNDLETOOL_VERSION.jar"
  info "Building App Bundle (debug, arm64)"
  in_ctr sh -c 'cd android && ./gradlew bundleDebug -PreactNativeArchitectures=arm64-v8a --console=plain -q'
  info "Building device APKs with local-testing asset packs"
  in_ctr java -jar "/home/dev/bundletool-$BUNDLETOOL_VERSION.jar" build-apks --overwrite --local-testing --connected-device \
    --bundle android/app/build/outputs/bundle/debug/app-debug.aab --output /tmp/quo.apks \
    --ks android/app/debug.keystore --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android
  info "Download size for this device (base + splits, excluding fast-follow pack):"
  in_ctr java -jar "/home/dev/bundletool-$BUNDLETOOL_VERSION.jar" get-size total --apks /tmp/quo.apks
  info "Installing"
  in_ctr java -jar "/home/dev/bundletool-$BUNDLETOOL_VERSION.jar" install-apks --apks /tmp/quo.apks
}

cmd_start() {
  cmd_deps
  wait_for_device
  # The phone reaches Metro only through the adb tunnel (app URL pinned to
  # 127.0.0.1 via REACT_NATIVE_PACKAGER_HOSTNAME). Metro listens on all
  # container interfaces because pasta delivers the host's 127.0.0.1 publish
  # there; the container address itself is not reachable from the LAN.
  in_ctr adb reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT" > /dev/null
  info "Metro on the phone via USB (host: http://localhost:$METRO_PORT)"
  in_ctr npx expo start --dev-client --android --port "$METRO_PORT" "$@"
}

cmd_dev() {
  cmd_deps
  wait_for_device
  if ! in_ctr adb shell pm path "$APP_ID" 2>/dev/null | grep -q package:; then
    cmd_build
  elif ! in_ctr adb shell dumpsys package "$APP_ID" 2>/dev/null | grep -q 'pkgFlags=.*DEBUGGABLE'; then
    die "a non-debug $APP_ID (store build?) is installed. Uninstall it from the phone first — signatures differ (this deletes its chats/models)."
  fi
  cmd_start "$@"
}

cmd_logs() {
  cmd_up
  in_ctr sh -c "adb logcat -v color --pid=\$(adb shell pidof -s $APP_ID) $*"
}

cmd_clean() {
  cmd_down
  local spec
  for spec in "${BUILD_VOLUMES[@]}"; do podman volume rm -f "${spec%%:*}" > /dev/null; done
  [[ "${1:-}" == "--all" ]] && podman volume rm -f "$HOME_VOLUME" > /dev/null && podman rmi -f "$IMAGE" > /dev/null
  info "Removed sandbox volumes${1:+ (incl. caches + image)}"
}

usage() {
  cat <<EOF
Usage: npm run sandbox -- <command>

  dev            (default) deps, build+install if app missing, then Metro
  build [args]   rebuild + reinstall the native dev client (after native/dep changes)
  bundle         build the App Bundle and install it like Play (tests fast-follow model delivery)
  start [args]   Metro only (JS changes hot-reload; app already installed)
  logs           logcat for the running app
  shell          bash inside the sandbox (adb, gradle, npx available)
  up | down      start/stop the container
  image          (re)build the toolchain image
  clean [--all]  drop build volumes (--all: also caches, adb key, image)
EOF
}

main() {
  command -v podman > /dev/null || die "podman is required"
  local cmd="${1:-dev}"; shift || true
  case "$cmd" in
    dev) cmd_dev "$@" ;;
    build) cmd_build "$@" ;;
    bundle) cmd_bundle ;;
    start) cmd_start "$@" ;;
    logs) cmd_logs "$@" ;;
    shell) cmd_up; in_ctr bash ;;
    up) cmd_up ;;
    down) cmd_down ;;
    image) cmd_image ;;
    clean) cmd_clean "$@" ;;
    help|-h|--help) usage ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
