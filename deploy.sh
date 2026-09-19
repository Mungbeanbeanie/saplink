#!/bin/sh
# usage: ./deploy.sh [api|web]      (no arg = both)
#
# Needs: ~/.ssh/config hosts `saplink-api` and `saplink-web`, and SAPLINK_DOMAIN
# exported locally (the bare domain, e.g. saplink.example).
set -e

: "${SAPLINK_DOMAIN:?export SAPLINK_DOMAIN=<your domain> first}"

for role in ${1:-api web}; do
	echo "==> $role"
	ssh "saplink-$role" \
		"cd /opt/saplink && git pull --ff-only && docker compose -f compose.$role.yaml up -d --build"
done

# Health-check whatever we just touched.
for role in ${1:-api web}; do
	case "$role" in
	api) curl -fsS "https://api.$SAPLINK_DOMAIN/health" && echo " <- api ok" ;;
	web) curl -fsSI "https://$SAPLINK_DOMAIN/" >/dev/null && echo "web ok" ;;
	esac
done
