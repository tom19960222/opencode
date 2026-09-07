#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash air-gap-trial.sh /path/to/offline/bin/opencode [arguments...]" >&2
  exit 2
fi
binary=$(realpath -- "$1")
shift
assets=$(realpath -- "$(dirname -- "$binary")/../assets")
if [[ ! -x "$binary" || ! -d "$assets/parsers" ]]; then
  echo "Use the extracted offline package's bin/opencode executable." >&2
  exit 2
fi
trial=$(realpath -m -- "${OPENCODE_TRIAL_DIR:-$HOME/opencode-airgap-trial}")
origins=${OPENCODE_AIR_GAP_ALLOW_ORIGINS:-}

# Inherited database/config overrides can bypass XDG isolation.
for name in ${!OPENCODE_@}; do
  unset "$name"
done
umask 077
mkdir -p "$trial"/{home,config,cache,data/opencode,state,tmp,runtime,project}
export HOME="$trial/home" OPENCODE_TEST_HOME="$trial/home"
export XDG_CONFIG_HOME="$trial/config" XDG_CACHE_HOME="$trial/cache"
export XDG_DATA_HOME="$trial/data" XDG_STATE_HOME="$trial/state"
export TMPDIR="$trial/tmp" XDG_RUNTIME_DIR="$trial/runtime"
export OPENCODE_DB="$trial/data/opencode/trial.db"
export OPENCODE_AIR_GAPPED=on OPENCODE_AIR_GAP_DIR="$assets"
export OPENCODE_AIR_GAP_ALLOW_ORIGINS="$origins"
export OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_PURE=1
cd -- "$trial/project"
export PWD="$trial/project"
exec "$binary" "$@"
