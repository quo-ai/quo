#!/usr/bin/env bash
# Deploys Quo Web (app + API) to Vercel (project "quoai-app",
# https://quoai-app.vercel.app). Like the website, it deploys from a copy
# outside the git repo: Vercel's Hobby plan blocks deployments whose git
# commit author isn't on the team. Vercel builds it (npm run build) and
# turns api/ into a function; environment variables live in the project.
# `--preview` deploys to a preview address instead, to check a change first.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .vercel ] || { echo "apps/web isn't linked: run 'npx vercel link --project quoai-app' here first" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
tar --exclude=node_modules --exclude=dist --exclude='.env*' --exclude='*.tsbuildinfo' -cf - . | tar -xf - -C "$tmp"
cd "$tmp"
target=--prod
if [ "${1:-}" = "--preview" ]; then target=; shift; fi
npx -y vercel@latest deploy $target --yes "$@"
