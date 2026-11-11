#!/usr/bin/env bash
# Run as the rootless Podman user that owns the existing service and volumes.
set -Eeuo pipefail
cd "$(dirname "$(readlink -f "$0")")"
fail() { echo "Deploy: $*" >&2; exit 1; }
for command in podman podman-compose flock git; do command -v "$command" >/dev/null || fail "Missing $command"; done
[[ $(id -u) != 0 ]] || fail 'Run as the deployment user, not root'
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
[[ -S "$XDG_RUNTIME_DIR/podman/podman.sock" ]] || fail 'Podman socket missing; enable the user podman.socket first'
export APP_ENV_FILE="$(readlink -f "${APP_ENV_FILE:-.env}")"
[[ -r "$APP_ENV_FILE" ]] || fail 'Environment file is not readable'
state="${DEPLOY_STATE_DIR:-$HOME/.local/state/aic-deploy}"
mkdir -p "$state"
if [[ "${AIC_DEPLOY_LOCK_FD:-}" == 9 ]]; then
  [[ $(readlink "/proc/$$/fd/9") == "$(readlink -f "$state/deploy.lock")" ]] || fail 'Invalid inherited deployment lock'
else
  exec 9>"$state/deploy.lock"
fi
flock -n 9 || fail 'Another deployment is running'
# Keep locks in the coordinating shells, never in engine processes or their
# persistent descendants (conmon, networking helpers and application processes).
# Functions cover every call below, including command substitutions and rollback.
podman() { command podman "$@" 8>&- 9>&-; }
podman-compose() { command podman-compose "$@" 8>&- 9>&-; }
project="${COMPOSE_PROJECT_NAME:-aic-agent-library}"
compose=(podman-compose --env-file "$APP_ENV_FILE" -p "$project" -f podman-compose.yml)
revision=$(git rev-parse HEAD)
# Unique names also distinguish manual deployments with uncommitted changes.
release="$revision-$(date +%s)-$$"
export APP_IMAGE="localhost/aic-agent-library:$release"
export PI_RUNNER_IMAGE="localhost/pi-runner:$release"
"${compose[@]}" config >/dev/null
podman build -t "$PI_RUNNER_IMAGE" -f Containerfile.pi-runner .
runner_id=$(podman image inspect --format '{{.Id}}' "$PI_RUNNER_IMAGE")
[[ -n "$runner_id" ]] || fail 'Runner image inspection returned no image ID'
podman build -t "$APP_IMAGE" -f Containerfile .
# Parse the file using Podman itself; never source production secrets as shell code.
validator=$(cat deploy/validate-env.cjs)
podman run --rm --network none --env-file "$APP_ENV_FILE" --entrypoint node "$APP_IMAGE" -e "$validator"
# Verify through the mounted API socket as the app's uid, not just the CLI's
# image store (which could point to a different user/remote engine).
runner_validator=$(cat deploy/validate-runner.cjs)
podman run --rm --network none --security-opt label=disable \
  --userns keep-id:uid=1000,gid=1000 \
  --volume "$XDG_RUNTIME_DIR/podman/podman.sock:/run/podman/podman.sock" \
  --env "PI_RUNNER_IMAGE=$PI_RUNNER_IMAGE" \
  --env PI_RUNNER_SOCKET=/run/podman/podman.sock \
  --entrypoint node "$APP_IMAGE" -e "$runner_validator" "$PI_RUNNER_IMAGE" "$runner_id"
name=aic-agent-library
backup="${name}-previous"
[[ $(podman container exists "$backup"; echo $?) == 1 ]] || fail "Backup container $backup already exists; inspect the previous deployment first"
had_old=false
managed_old=false
switched=false
rollback() {
  status=$?
  trap - EXIT INT TERM
  if [[ "$switched" == true ]]; then
    echo 'Deploy failed; restoring previous container' >&2
    podman rm -f "$name" >/dev/null 2>&1 || true
  fi
  if [[ "$had_old" == true ]]; then
    if podman container exists "$backup"; then
      podman rename "$backup" "$name" || echo "ROLLBACK FAILED: cannot rename $backup" >&2
    fi
    podman start "$name" >/dev/null || echo "ROLLBACK FAILED: cannot start $name" >&2
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if podman container exists "$name"; then
  # A manually created container may have data in its writable layer. Keep the
  # stopped backup after success so an operator can migrate that data explicitly.
  old_project=$(podman inspect --format '{{index .Config.Labels "io.podman.compose.project"}}' "$name")
  [[ "$old_project" != "$project" ]] || managed_old=true
  had_old=true
  if ! podman stop --time 30 "$name" >/dev/null; then
    podman start "$name" >/dev/null || true
    fail 'Could not stop the old container'
  fi
  if ! podman rename "$name" "$backup"; then
    podman start "$name" >/dev/null
    fail 'Could not preserve the previous container'
  fi
fi
switched=true
"${compose[@]}" up -d --no-build --no-recreate
expected=$(podman image inspect --format '{{.Id}}' "$APP_IMAGE")
actual=$(podman inspect --format '{{.Image}}' "$name")
[[ "$actual" == "$expected" ]] || fail 'Running container does not use the new image'
podman exec "$name" node -e "$validator"
# Check the actual Compose environment too: a stale/default tag must roll back,
# even when /health succeeds. Do not override env on this exec.
podman exec "$name" node -e "$runner_validator" "$PI_RUNNER_IMAGE" "$runner_id"
healthy=false
for ((attempt=0; attempt<30; attempt++)); do
  if podman exec "$name" node -e 'fetch("http://127.0.0.1:3000/health", {signal: AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then
    healthy=true
    break
  fi
  sleep 2
done
[[ "$healthy" == true ]] || fail 'Health check failed'
printf '%s %s\n' "$revision" "$APP_IMAGE" > "$state/current.tmp"
mv "$state/current.tmp" "$state/current"
switched=false
trap - EXIT INT TERM
if [[ "$had_old" == true && "$managed_old" == true ]]; then
  podman rm "$backup" >/dev/null
elif [[ "$had_old" == true ]]; then
  echo "Deployment healthy. Previous container retained as $backup."
  echo "After checking persistent data, remove it with: podman rm $backup"
fi
echo "Deployed $APP_IMAGE"
