#!/usr/bin/env bash
# Runs `pnpm test:e2e` inside a container on a sandbox's private Docker network, for machines that
# cannot use the sandbox's loopback relay (it binds 127.0.0.1:443, which needs root or a lowered
# net.ipv4.ip_unprivileged_port_start, and /etc/hosts entries). See docs/e2e-testing.md.
#
#   scripts/e2e-docker.sh <Atmosphere in a Box checkout> [vitest arguments...]
#
# The container runs as root (0:0) so that, with rootless Docker, it maps to your own user and can
# read the sandbox's private state. It uses the host's Node and this repository, both mounted.
set -euo pipefail

aiab=$(cd "${1:?usage: e2e-docker.sh <Atmosphere in a Box checkout> [vitest arguments...]}" && pwd)
shift
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node_root=$(cd "$(dirname "$(command -v node)")/.." && pwd)

project=$(node -p "JSON.parse(require('fs').readFileSync('$aiab/state/manifest.json','utf8')).project")
dns=$(cd "$aiab" && deno task sandbox access --json 2>/dev/null | grep '^{' | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).network.dnsAddress")

# The variables are passed by name, so the passwords never appear in a command line.
eval "$(node "$repo/scripts/e2e-env.mjs" "$aiab")"
names=$(compgen -v SDK_E2E_ | sed 's/^/-e /' | tr '\n' ' ')

# shellcheck disable=SC2086
docker run --rm --user 0:0 \
  --network "${project}_atmosinabox" --dns "$dns" \
  -v "$repo:/w" -v "$node_root:/node:ro" -v "$aiab/state/ca/root.crt:/ca.crt:ro" \
  $names -e NODE_EXTRA_CA_CERTS=/ca.crt -e PATH=/node/bin:/usr/bin:/bin -e HOME=/tmp \
  -w /w/packages/sdk atmosbox-tools:local \
  node /w/node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts "$@"
