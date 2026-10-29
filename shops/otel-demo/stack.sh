#!/usr/bin/env bash
# OpenTelemetry Demo for Walkout: the 3.1.0 backends with two frontends,
# 2.1.3 (defect) behind :8080 and 3.1.0 (clean) behind :8082.
#   stack.sh setup   get the shop's source: 2.1.3 into src/ (the fix step
#                    patches it), 3.1.0 into stack/ (compose files and backends)
#   stack.sh up      setup, then start the stack if it is not answering
#   stack.sh down    stop it
#   stack.sh fix     build the patched 2.1.3 frontend and serve it on :8080
#   stack.sh unfix   put the released 2.1.3 frontend back on :8080
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
upstream=${WALKOUT_DEMO_REPO:-https://github.com/open-telemetry/opentelemetry-demo.git}
src=$here/src
stack=$here/stack
project=walkout2934
files=(-f "$stack/compose.yaml" -f "$here/compose.walkout-pair.yaml")

setup() {
  if [ ! -d "$src/.git" ]; then
    git -c advice.detachedHead=false clone -q --depth 1 --branch 2.1.3 "$upstream" "$src"
  fi
  git -C "$src" rev-parse -q --verify "refs/tags/3.1.0" >/dev/null || git -C "$src" fetch -q --depth 1 origin tag 3.1.0
}

prepare() {
  [ -f "$stack/compose.yaml" ] && return
  setup
  mkdir -p "$stack"
  git -C "$src" archive 3.1.0 | tar -x -C "$stack"
  # Docker's socket for the demo's collector: the rootless one when the
  # current context uses it, else the usual one.
  sock=$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null | sed 's#^unix://##')
  cat >> "$stack/.env" <<ENV
DEMO_VERSION=3.1.0
COLLECTOR_CONTRIB_IMAGE=ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.160.0
POSTGRES_IMAGE=postgres:18.6
VALKEY_IMAGE=ghcr.io/valkey-io/valkey:9.1.2-alpine3.24
DOCKER_SOCK=${DOCKER_SOCK:-${sock:-/var/run/docker.sock}}
ENV
}

up_ok() { curl -sf -o /dev/null http://localhost:8080/ && curl -sf -o /dev/null http://localhost:8082/; }

wait_ready() {
  local port=$1
  for ((i=0; i<120; i++)); do
    if curl --max-time 5 -sf -o /dev/null "http://localhost:$port/"; then return; fi
    sleep 2
  done
  echo "shop on :$port did not become ready" >&2
  return 1
}

case "${1:-up}" in
  setup)
    setup
    prepare ;;
  up)
    setup
    up_ok && { echo "shops already up on :8080 and :8082"; exit 0; }
    prepare
    docker compose -p $project "${files[@]}" up -d --no-build --pull missing
    docker stop load-generator >/dev/null 2>&1 || true
    wait_ready 8080
    wait_ready 8082 ;;
  down)
    prepare
    docker compose -p $project "${files[@]}" down ;;
  fix)
    prepare
    t0=$(date +%s)
    (cd "$here/src" && docker build -q -f src/frontend/Dockerfile -t walkout/otel-demo-frontend:2.1.3-fix .)
    echo "fix image built in $(( $(date +%s) - t0 )) s"
    docker compose -p $project "${files[@]}" -f "$here/compose.walkout-fix.yaml" up -d --no-deps --no-build --pull never frontend
    wait_ready 8080 ;;
  unfix)
    prepare
    docker compose -p $project "${files[@]}" up -d --no-deps --no-build --pull missing frontend
    wait_ready 8080 ;;
  *) echo "usage: stack.sh setup|up|down|fix|unfix" >&2; exit 2 ;;
esac
