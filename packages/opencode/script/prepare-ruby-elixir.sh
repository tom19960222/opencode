#!/usr/bin/env bash
set -euo pipefail

# Connected Ubuntu 24 build step. Runtime wrappers use only the copied files.
if [[ "${1:-}" != --inside ]]; then
  script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
  assets=${OPENCODE_AIR_GAP_DIR:-"$script_dir/../assets"}
  mkdir -p "$assets/native/ruby" "$assets/native/elixir" "$assets/bin"
  assets=$(cd "$assets" && pwd)
  docker run --rm --platform linux/amd64 \
    -e PACKAGE_UID="$(id -u)" -e PACKAGE_GID="$(id -g)" \
    -v "$script_dir/prepare-ruby-elixir.sh:/prepare.sh:ro" -v "$script_dir:/recipe:ro" \
    -v "$assets/native/ruby:/out/ruby" -v "$assets/native/elixir:/out/elixir" -v "$assets/bin:/bins" \
    ubuntu:24.04 bash /prepare.sh --inside
  exit
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ruby=1:3.2~ubuntu1 ruby-dev build-essential git curl unzip ca-certificates \
  elixir=1.14.0.dfsg-2 erlang-base=1:25.3.2.8+dfsg-1ubuntu4.6 \
  fonts-lato=2.015-1 libjs-jquery=3.6.1+dfsg+~3.5.14-1 erlang-dev erlang-dialyzer erlang-parsetools erlang-tools erlang-xmerl erlang-edoc erlang-src

rubocop_version=1.90.0
elixir_ls_version=v0.29.3
elixir_ls_commit=a20e263704911c2ccc7047647faf1d6d7e8bf132
mkdir -p /out/ruby/gems /out/ruby/runtime /out/ruby/lib /out/ruby/licenses /out/elixir/lib /out/elixir/licenses
mkdir -p /tmp/gems
while read -r checksum name; do
  curl --fail --silent --show-error --location "https://rubygems.org/downloads/$name" -o "/tmp/gems/$name"
  printf '%s  %s\n' "$checksum" "/tmp/gems/$name" | sha256sum --check --status
done < /recipe/ruby-elixir-gems.sha256
GEM_HOME=/out/ruby/gems GEM_PATH=/out/ruby/gems gem install --local --ignore-dependencies --no-document /tmp/gems/*.gem
mkdir -p /out/ruby/runtime/lib/x86_64-linux-gnu/ruby /out/ruby/runtime/bin
cp -a /usr/lib/ruby /out/ruby/runtime/lib/
cp -a /usr/lib/x86_64-linux-gnu/ruby/. /out/ruby/runtime/lib/x86_64-linux-gnu/ruby/
cp -a /usr/bin/ruby3.2 /out/ruby/runtime/bin/
mkdir -p /out/ruby/runtime/share/fonts/truetype /out/ruby/runtime/share/javascript
cp -a /usr/share/fonts/truetype/lato /out/ruby/runtime/share/fonts/truetype/
cp -a /usr/share/javascript/jquery /out/ruby/runtime/share/javascript/
dpkg-query -W -f='${Package}\t${Version}\n' fonts-lato libjs-jquery > /out/ruby/rdoc-packages.tsv

if [[ ! -d /out/elixir/server/.git ]]; then
  git clone --branch "$elixir_ls_version" --depth 1 https://github.com/elixir-lsp/elixir-ls.git /out/elixir/server
fi
test "$(git -C /out/elixir/server rev-parse HEAD)" = "$elixir_ls_commit"
cd /out/elixir/server
export MIX_ENV=prod ERL_FLAGS='+S 4:4'
mix local.hex 2.5.1 --force
mix local.rebar --force
printf '%s  %s\n' 490f1ed8b2f6a6629f9680e5e9f477d101af03b13bbccfa2e5f314ab7ab0ba44 /root/.mix/elixir/1-14/rebar3 | sha256sum --check --status
mix deps.get --only prod
mix compile
cp -a /usr/lib/erlang /out/elixir/
cp -a /usr/lib/elixir /out/elixir/
cp -a /root/.mix /out/elixir/mix-home
cp -a /root/.hex /out/elixir/hex-home

# ldd includes the complete transitive shared-library closure, including Ruby extensions and Erlang NIFs.
for runtime in ruby elixir; do
  find "/out/$runtime" -type f \( -perm /111 -o -name '*.so' -o -name '*.so.*' \) -print0 |
    { xargs -0 -r ldd 2>/dev/null || true; } |
    awk '/=> \// {print $3}' | sort -u > "/out/$runtime/shared-libraries.txt"
  while IFS= read -r library; do
    case "$(basename "$library")" in libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|librt.so.*|ld-linux*) continue ;; esac
    cp -L "$library" "/out/$runtime/lib/"
  done < "/out/$runtime/shared-libraries.txt"
  dpkg-query -W -f='${Package}\t${Version}\n' > "/out/$runtime/ubuntu-packages.tsv"
  while IFS= read -r -d '' license; do
    package=$(basename "$(dirname "$license")")
    cp -L "$license" "/out/$runtime/licenses/$package.copyright"
  done < <(find /usr/share/doc -name copyright -print0)
done

cat > /bins/ruby <<'RUBY'
#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../native/ruby" && pwd)
export LD_LIBRARY_PATH="$root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export RUBYLIB="$root/runtime/lib/ruby/3.2.0:$root/runtime/lib/x86_64-linux-gnu/ruby/3.2.0:$root/runtime/lib/ruby/vendor_ruby/3.2.0:$root/runtime/lib/ruby/vendor_ruby:$root/runtime/lib/x86_64-linux-gnu/ruby/vendor_ruby/3.2.0"
export GEM_HOME="$root/gems" GEM_PATH="$root/gems"
exec "$root/runtime/bin/ruby3.2" "$@"
RUBY
cat > /bins/rubocop <<'RUBOCOP'
#!/bin/sh
set -eu
bin=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$bin/ruby" "$bin/../native/ruby/gems/bin/rubocop" "$@"
RUBOCOP
cat > /bins/erl <<'ERL'
#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../native/elixir" && pwd)
export ROOTDIR="$root/erlang"
export BINDIR="$(find "$ROOTDIR" -maxdepth 1 -type d -name 'erts-*' -print -quit)/bin" EMU=beam PROGNAME=erl
export LD_LIBRARY_PATH="$root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$BINDIR/erlexec" "$@"
ERL
for command in escript erlc; do
  cat > "/bins/$command" <<'ERLANG'
#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../native/elixir" && pwd)
export ROOTDIR="$root/erlang"
export BINDIR="$(find "$ROOTDIR" -maxdepth 1 -type d -name 'erts-*' -print -quit)/bin" EMU=beam PROGNAME=erl
export LD_LIBRARY_PATH="$root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export ESCRIPT_EMULATOR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/erl"
exec "$BINDIR/$(basename "$0")" "$@"
ERLANG
done
for command in elixir elixirc mix; do
  cat > "/bins/$command" <<'ELIXIR'
#!/bin/sh
set -eu
bin=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="$bin/../native/elixir"
export PATH="$bin:$PATH"
export LD_LIBRARY_PATH="$root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export MIX_HOME="$root/mix-home" HEX_HOME="$root/hex-home" HEX_OFFLINE=1
exec "$root/elixir/bin/$(basename "$0")" "$@"
ELIXIR
done
cat > /out/elixir/start-lsp.exs <<'LSP'
Application.put_env(:elixir, :ansi_enabled, false)
Application.put_all_env(Config.Reader.read!(Path.join(__DIR__, "server/config/config.exs"), env: :prod))
Mix.start()
Mix.shell(Mix.Shell.Quiet)
ElixirLS.LanguageServer.main()
LSP
cat > /bins/elixir-ls <<'ELIXIRLS'
#!/bin/sh
set -eu
bin=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="$bin/../native/elixir"
export ERL_LIBS="$root/server/_build/shared/lib"
exec "$bin/elixir" "$root/start-lsp.exs" "$@"
ELIXIRLS
chmod 755 /bins/ruby /bins/rubocop /bins/erl /bins/escript /bins/erlc /bins/elixir /bins/elixirc /bins/mix /bins/elixir-ls

GEM_HOME=/out/ruby/gems GEM_PATH=/out/ruby/gems gem list --local > /out/ruby/gem-versions.txt
find /out/ruby/gems/cache -name '*.gem' -exec sha256sum {} + > /out/ruby/gem-checksums.txt
git -C /out/elixir/server rev-parse HEAD > /out/elixir/elixir-ls-commit.txt
cp /out/elixir/server/mix.lock /out/elixir/mix.lock
cat > /out/ruby/manifest.json <<MANIFEST
{"runtime":"Ruby 3.2.3","rubocop":"$rubocop_version","rdocAssets":"runtime/share/ (fonts-lato 2.015-1, libjs-jquery 3.6.1+dfsg+~3.5.14-1)","target":"Ubuntu 24.04 x86_64","gemInputs":"gem-checksums.txt","packages":"ubuntu-packages.tsv","licenses":"licenses/ and gems/gems/*/LICENSE*"}
MANIFEST
cat > /out/elixir/manifest.json <<MANIFEST
{"runtime":"Elixir 1.14.0 / Erlang OTP 25","elixirLS":"$elixir_ls_version","commit":"$elixir_ls_commit","hex":"2.5.1","rebar":"3.15.2","rebarSHA256":"490f1ed8b2f6a6629f9680e5e9f477d101af03b13bbccfa2e5f314ab7ab0ba44","dependencies":"mix.lock","packages":"ubuntu-packages.tsv","licenses":"licenses/ and server/LICENSE and server/deps/*/LICENSE*"}
MANIFEST
for runtime in ruby elixir; do
  (cd "/out/$runtime" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
done
chown -R "$PACKAGE_UID:$PACKAGE_GID" /out/ruby /out/elixir
chown "$PACKAGE_UID:$PACKAGE_GID" /bins/ruby /bins/rubocop /bins/erl /bins/escript /bins/erlc /bins/elixir /bins/elixirc /bins/mix /bins/elixir-ls
