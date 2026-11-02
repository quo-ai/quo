#!/usr/bin/env bash
# Deploys website/ to Quo's own server (https://quo.computer), through apps/web/scripts/deploy-server.sh --site.
# `--vercel` instead redeploys the old address (Vercel project "quo", https://quoai.vercel.app), which only redirects
# every page to quo.computer (vercel.json). That runs from a copy outside git: Vercel's Hobby plan blocks deployments
# whose git commit author isn't on the team.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${1:-}" = "--vercel" ] || exec bash ../apps/web/scripts/deploy-server.sh --site
[ -d .vercel ] || { echo "website/ isn't linked: run 'npx vercel link --project quo' in website/ first" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r vercel.json .vercel "$tmp"/
# Vercel builds no routes for a deployment without files: one page, never shown while the redirect works.
printf '<!doctype html><meta charset="utf-8"><title>Quo</title><meta http-equiv="refresh" content="0; url=https://quo.computer/"><a href="https://quo.computer/">Quo is at quo.computer</a>\n' > "$tmp/index.html"
cd "$tmp"
npx -y vercel@latest deploy --prod --yes
