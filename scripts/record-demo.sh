#!/usr/bin/env bash
# Scripted narration for the terminal demo recording. Real commands against
# real production (a throwaway "demo" app, deleted at the end) — nothing here
# is staged output, it's exactly what a first-time user sees.
set -e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
SC="node /home/ubuntu/development/smallcloud/packages/smallcloud/bin/smallcloud.js"
APP=demo
WORKDIR=$(mktemp -d)
say() { printf '\033[36m# %s\033[0m\n' "$1"; sleep 2.2; }
pause() { sleep "$1"; }
redact() { sed -E 's/(token=)[a-f0-9]{16,}/\1…/'; }

cd "$WORKDIR"
say "Deploy a static site to a private HTTPS URL"
$SC new "$APP" --template static
pause 1
cd "$APP"
DEPLOY_OUT=$($SC deploy)
SIGNIN_URL=$(echo "$DEPLOY_OUT" | grep -o 'https://[^ ]*/_sc/auth[^ ]*')
echo "$DEPLOY_OUT" | redact
pause 1.8

say "Share it with a teammate — viewer or editor roles"
$SC share "$APP" --role viewer | redact
pause 1.8

say "Idle apps stop automatically. Simulating that now, then waking on request…"
COOKIEJAR=$(mktemp)
curl -s -o /dev/null -c "$COOKIEJAR" "$SIGNIN_URL"
docker stop "sc-app-$APP" >/dev/null
URL=$($SC status "$APP" | grep -o 'https://[^ ]*' | head -1)
pause 1
curl -s -o /dev/null -b "$COOKIEJAR" -w "  → %{http_code} in %{time_total}s\n" "$URL"
rm -f "$COOKIEJAR"
pause 1.8

say "Done. Cleaning up the demo app."
$SC delete "$APP"
pause 1

cd /
rm -rf "$WORKDIR"
