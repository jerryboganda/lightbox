#!/usr/bin/env bash
# Dev smoke test: sign in as the local dev admin and request each route.
B=${BASE:-http://localhost:4321}; J=$(mktemp)
PW=$(grep '^DEV_ADMIN_PASSWORD=' .env | cut -d= -f2)
curl -s -c "$J" -o /dev/null -H "Origin: $B" -d "username=admin&password=$PW" "$B/api/auth/login"
for u in "$@"; do printf '%s %s\n' "$(curl -s -b "$J" -o /dev/null -w '%{http_code}' "$B$u")" "$u"; done
rm -f "$J"
