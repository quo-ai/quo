#!/usr/bin/env bash
# Writes what Flathub's repository for Quo (github.com/flathub/computer.quo.Quo) holds for one release:
# `flathub.sh desktop-vX.Y.Z <folder>`. The manifest builds that release's tag and commit instead of this checkout,
# generated-sources.json comes from that release's lockfiles, and flathub.json limits builds to x86_64 until the ARM
# build has been tried on an ARM computer. Needs the tag here (git fetch --tags) and flatpak-node-generator (see sources.sh).
set -euo pipefail
[[ $# -eq 2 && $1 =~ ^desktop-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Usage: flathub.sh desktop-vX.Y.Z <folder>" >&2; exit 1; }
tag=$1
out=$2
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
commit=$(git -C "$root" rev-list -n 1 "refs/tags/$tag")
version=${tag#desktop-v}
grep -q "<release version=\"$version\"" <(git -C "$root" show "$tag:apps/desktop/flatpak/computer.quo.Quo.metainfo.xml") ||
  { echo "$tag's metainfo has no <release version=\"$version\">." >&2; exit 1; }
mkdir -p "$out"

python3 -I - "$here/computer.quo.Quo.yml" "$out/computer.quo.Quo.yml" "$tag" "$commit" <<'PY'
import re, sys
source, target, tag, commit = sys.argv[1:]
text = open(source).read()
release = (f'      # Quo at {tag}.\n'
           f'      - type: git\n'
           f'        url: https://github.com/quo-ai/quo.git\n'
           f'        tag: {tag}\n'
           f'        commit: {commit}\n')
text, count = re.subn(r'^      # quo-source-begin.*?^      # quo-source-end\n', release, text, flags=re.S | re.M)
assert count == 1, 'quo-source markers not found'
open(target, 'w').write(text)
PY
bash "$here/sources.sh" "$tag" "$out/generated-sources.json"
printf '{\n  "only-arches": ["x86_64"]\n}\n' >"$out/flathub.json"
echo "Written for $tag ($commit) in $out"
