#!/usr/bin/env bash
# Writes the npm packages the Flatpak build installs offline, for Quo Web and the desktop app, from their
# package-lock.json files: `sources.sh [git ref] [output]`, by default this checkout's lockfiles into
# generated-sources.json beside the manifest (not committed here; the Flathub repository keeps its own copy).
# Needs flatpak-node-generator (flatpak/flatpak-builder-tools, node/), or the one $FLATPAK_NODE_GENERATOR names (CI
# installs the version it pins and names it: Flathub's container has an older one that fails on Electron 44).
#
# One file for both apps, each source once: the generator's setup steps are the same for both and fail if run twice.
# The Agent SDK's copies of Claude Code are left out: optional packages the desktop build omits (npm ci
# --omit=optional), which Quo never downloads, ships or runs.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
ref=${1:-}
out=${2:-$here/generated-sources.json}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for app in web desktop; do
  # The generator wants a lockfile without node_modules beside it.
  mkdir -p "$work/$app"
  for file in package.json package-lock.json; do
    if [[ -n $ref ]]; then git -C "$root" show "$ref:apps/$app/$file" >"$work/$app/$file"; else cp "$root/apps/$app/$file" "$work/$app/"; fi
  done
  "${FLATPAK_NODE_GENERATOR:-flatpak-node-generator}" npm "$work/$app/package-lock.json" -o "$work/$app.json"
done

python3 -I - "$work/web.json" "$work/desktop.json" "$out" <<'PY'
import json, re, sys
*parts, out = sys.argv[1:]
omitted = re.compile(r'@anthropic-ai/claude-agent-sdk-(darwin|linux|win32)')
seen, kept, left_out = set(), [], 0
for part in parts:
    with open(part) as f:
        for source in json.load(f):
            key = json.dumps(source, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            if omitted.search(key):
                left_out += 1
                continue
            kept.append(source)
with open(out, 'w') as f:
    json.dump(kept, f, indent=2)
    f.write('\n')
print(f'{out}: {len(kept)} sources ({left_out} copies of Claude Code left out)')
PY
