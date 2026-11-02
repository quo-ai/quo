#!/usr/bin/env bash
# Deploys Quo Web (app + API), the website and Quo's Apache config to Quo's own server (Windows; see "Quo's own server"
# in apps/web/README.md). It copies the working tree, as deploy.sh does for Vercel, and the server builds it.
# Needs SSH to the server as an administrator: QUO_SERVER is its name in ~/.ssh/config (default: quo-server).
# Run the checks first (npm run typecheck && npm test): the server only builds.
set -euo pipefail
cd "$(dirname "$0")/.."
# `--site` deploys only the website (and the Apache config).
host=${QUO_SERVER:-quo-server}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
files=(site.tar apache.conf deploy.ps1)
if [ "${1:-}" != "--site" ]; then
  tar --exclude=node_modules --exclude=dist --exclude='dist-*' --exclude='.env*' --exclude=.vercel --exclude='*.tsbuildinfo' -cf "$tmp/app.tar" .
  files+=(app.tar)
fi
mkdir "$tmp/site"
tar -C ../../website --exclude=scripts --exclude=vercel.json --exclude=.vercel -cf - . | tar -xf - -C "$tmp/site"
python3 ../../website/scripts/brand-kit.py "$tmp/site"
tar -C "$tmp/site" -cf "$tmp/site.tar" .
cp scripts/server/apache.conf scripts/server/deploy.ps1 "$tmp/"
(cd "$tmp" && scp -q "${files[@]}" "$host:C:/quo/incoming/")
ssh "$host" 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\quo\incoming\deploy.ps1'
# Tell IndexNow search engines (Bing, whose index ChatGPT search also uses; Yandex; Naver) that the site's pages changed.
# Google doesn't use IndexNow. The key is public on purpose: https://quo.computer/indexnow.txt. Never fails the deploy.
key=$(tr -d '[:space:]' < ../../website/indexnow.txt)
urls=$(grep -o '<loc>[^<]*</loc>' ../../website/sitemap.xml | sed 's/<[^>]*>//g' | python3 -I -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
curl -sS -o /dev/null -w 'IndexNow: %{http_code}\n' --max-time 20 -H 'content-type: application/json; charset=utf-8' \
  --data "{\"host\":\"quo.computer\",\"key\":\"$key\",\"keyLocation\":\"https://quo.computer/indexnow.txt\",\"urlList\":$urls}" \
  https://api.indexnow.org/indexnow || echo 'IndexNow: not reached'
