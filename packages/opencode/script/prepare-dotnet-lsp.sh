#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
runtime_dir="$script_dir/../../../.cache/air-gap/ubuntu24-runtime"
mkdir -p "$runtime_dir/libs" "$runtime_dir/licenses"
runtime_dir="$(CDPATH= cd -- "$runtime_dir" && pwd -P)"
docker run --rm -i --platform linux/amd64 \
  -e PACKAGE_UID="$(id -u)" -e PACKAGE_GID="$(id -g)" \
  -v "$runtime_dir:/out" ubuntu:24.04 bash -s <<'UBUNTU'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  libicu74=74.2-1ubuntu3.1 libssl3t64=3.0.13-0ubuntu3.15 zlib1g=1:1.3.dfsg-3.1ubuntu2.2
cp -a /usr/lib/x86_64-linux-gnu/libicu*.so.* /usr/lib/x86_64-linux-gnu/libssl.so.* \
  /usr/lib/x86_64-linux-gnu/libcrypto.so.* /usr/lib/x86_64-linux-gnu/libz.so.* /out/libs/
for package in libicu74 libssl3t64 zlib1g; do
  mkdir -p "/out/licenses/$package"
  cp "/usr/share/doc/$package/copyright" "/out/licenses/$package/"
done
dpkg-query -W -f='${Package}\t${Version}\n' libicu74 libssl3t64 zlib1g > /out/packages.tsv
chown -R "$PACKAGE_UID:$PACKAGE_GID" /out
UBUNTU
export OPENCODE_AIR_GAP_DOTNET_RUNTIME_LIB_DIR="$runtime_dir/libs"
export OPENCODE_AIR_GAP_DOTNET_RUNTIME_LICENSE_DIR="$runtime_dir/licenses"
export OPENCODE_AIR_GAP_DOTNET_RUNTIME_PACKAGE_MANIFEST="$runtime_dir/packages.tsv"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export DOTNET_MULTILEVEL_LOOKUP=0
exec bun "$script_dir/prepare-dotnet-lsp.ts" "$@"
