#!/bin/sh
# usage: ./deploy.sh [api|web]      (no arg = both)
#
# Needs: ~/.ssh/config hosts `saplink-api` and `saplink-web`, and SAPLINK_DOMAIN
# exported locally (the bare domain, e.g. saplink.example).
set -e

: "${SAPLINK_DOMAIN:?export SAPLINK_DOMAIN=<your domain> first}"

for role in ${1:-api web}; do
	echo "==> $role"
	case "$role" in
	# web: compile the Vite bundle first, THEN restart caddy over the fresh dist/.
	# Explicit, because `up -d` can treat an already-exited build container as
	# done and silently keep serving the previous bundle.
	web) up="docker compose -f compose.web.yaml run --rm build &&
	         docker compose -f compose.web.yaml up -d" ;;
	*) up="docker compose -f compose.$role.yaml up -d --build" ;;
	esac
	ssh "saplink-$role" "cd /opt/saplink && git pull --ff-only && $up"
done

# Health-check whatever we just touched.
for role in ${1:-api web}; do
	case "$role" in
	api) curl -fsS "https://api.$SAPLINK_DOMAIN/api/health" && echo " <- api ok" ;;
	web) curl -fsSI "https://$SAPLINK_DOMAIN/" >/dev/null && echo "web ok" ;;
	esac
done
