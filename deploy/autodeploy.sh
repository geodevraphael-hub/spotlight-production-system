#!/bin/bash
# Deploy new commits on the `production` branch to spotlight.co.tz. Run every minute by
# spotlight-autodeploy.timer; does nothing until the branch exists or when it has not moved.
set -euo pipefail
ROOT=/srv/apps/spotlight-planner
REPO=https://github.com/geodevraphael-hub/spotlight-production-system.git
STATE=$ROOT/autodeploy.last

exec 9>/run/spotlight-autodeploy.lock
flock -n 9 || exit 0

sha=$(git ls-remote "$REPO" refs/heads/production | cut -f1)
[ -n "$sha" ] || exit 0
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Unexpected ref: $sha" >&2; exit 1; }
[ "$sha" = "$(cat "$STATE" 2>/dev/null || true)" ] && exit 0

# Record the attempt first so a failing commit is not retried every minute; push a fix instead.
echo "$sha" > "$STATE"
echo "Deploying production $sha"
python3 "$ROOT/deploy-release.py" "$sha" --promote
