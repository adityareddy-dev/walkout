#!/usr/bin/env bash
# OpenTelemetry Demo for Walkout: the 3.1.0 backends with two frontends,
# 2.1.3 (defect) behind :8080 and 3.1.0 (clean) behind :8082.
#   stack.sh up      start the stack if it is not answering
#   stack.sh down    stop it
#   stack.sh fix     build the patched 2.1.3 frontend and serve it on :8080
#   stack.sh unfix   put the released 2.1.3 frontend back on :8080
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
demo=${WALKOUT_DEMO_REPO:-/home/ef/work/opentelemetry-demo}
stack=$here/stack
project=walkout2934
files=(-f "$stack/compose.yaml" -f "$here/compose.walkout-pair.yaml")

prepare() {
  [ -f "$stack/compose.yaml" ] && return
  mkdir -p "$stack"
  git -C "$demo" archive 3.1.0 | tar -x -C "$stack"
  cat >> "$stack/.env" <<ENV
DEMO_VERSION=3.1.0
COLLECTOR_CONTRIB_IMAGE=ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.160.0
POSTGRES_IMAGE=postgres:18.6
VALKEY_IMAGE=ghcr.io/valkey-io/valkey:9.1.2-alpine3.24
DOCKER_SOCK=${DOCKER_SOCK:-/run/user/1000/docker.sock}
ENV
}

up_ok() { curl -sf -o /dev/null http://localhost:8080/ && curl -sf -o /dev/null http://localhost:8082/; }

case "${1:-up}" in
  up)
    up_ok && { echo "shops already up on :8080 and :8082"; exit 0; }
    prepare
    docker compose -p $project "${files[@]}" up -d --no-build --pull never
    docker stop load-generator >/dev/null 2>&1 || true ;;
  down)
    prepare
    docker compose -p $project "${files[@]}" down ;;
  fix)
    prepare
    t0=$(date +%s)
    (cd "$here/src" && docker build -q -f src/frontend/Dockerfile -t walkout/otel-demo-frontend:2.1.3-fix .)
    echo "fix image built in $(( $(date +%s) - t0 )) s"
    docker compose -p $project "${files[@]}" -f "$here/compose.walkout-fix.yaml" up -d --no-deps --no-build --pull never frontend ;;
  unfix)
    prepare
    docker compose -p $project "${files[@]}" up -d --no-deps --no-build --pull never frontend ;;
  *) echo "usage: stack.sh up|down|fix|unfix" >&2; exit 2 ;;
esac
