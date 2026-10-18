#!/usr/bin/env bash
# Deploys website/ to Vercel (project "quo", https://quoai.vercel.app).
# Runs from a copy outside the git repo: Vercel's Hobby plan blocks
# deployments whose git commit author isn't on the team. The copy carries the
# project link (.vercel/) but never .env* files.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .vercel ] || { echo "website/ isn't linked: run 'npx vercel link --project quo' in website/ first" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r ./* .vercel "$tmp"/  # every page and asset; hidden files (.env*) stay behind
rm -rf "$tmp/scripts"         # tooling, not part of the site
cd "$tmp"
# The brand page's "Download everything" zip is built here rather than committed.
python3 - <<'PY'
import os, zipfile
with zipfile.ZipFile('assets/brand/quo-brand-kit.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir('assets/brand')):
        if not name.endswith('.zip'):
            z.write(f'assets/brand/{name}', f'quo-brand-kit/logo/{name}')
    for name in sorted(os.listdir('assets/shots')):
        z.write(f'assets/shots/{name}', f'quo-brand-kit/screenshots/{name}')
PY
npx -y vercel@latest deploy --prod --yes
