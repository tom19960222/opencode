# Air-gap language tools and prerequisites

This is the explicit resource status, not a claim that arbitrary project dependencies or every language SDK are included. The base application and bundled syntax parsers are separate from optional project language tooling.

Native/toolchain scope after resource provisioning:

- Bundled npm: TypeScript server+TypeScript, Vue, Pyright, Svelte, Astro, YAML, Intelephense, Bash, Dockerfile; Prettier, Biome, experimental oxfmt.
- Bundled native (executed --version successfully): ripgrep, rust-analyzer, clangd, LuaLS, texlab, tinymist, shfmt.
- Needs a local language SDK/project dependencies even with bundled language server: Rust cargo/rustc/sysroot; C/C++ compiler/sysroot and compile_commands.json; texlab TeX toolchain; TypeScript/Vue/Astro/Svelte project packages; Pyright Python interpreter and packages.
- Optional LSPs not yet bundled: oxlint/oxc_language_server; experimental ty+Python environment; sourcekit-lsp+Swift; prisma+project packages; dart SDK; ocamllsp+OCaml/opam; gleam runtime; clojure-lsp+JVM/project deps; nixd+Nix; Haskell language server+GHC; Julia LanguageServer package+Julia.
- Remaining optional native formatters depend on local language toolchains: standardrb, htmlbeautifier, dart format, ocamlformat, latexindent, gleam format, nixfmt, rustfmt, composer vendor/bin/pint, ormolu, cljfmt, dfmt.
- LSP branches that used download/build installers now reject missing resources in airgap, after checking local prepared bins/cache. Archive layouts (vscode-eslint, jdtls) resolve assets/bin when the flag is enabled. Offline Kotlin uses the packaged kotlin-language-server executable.
- Generic remote resource map: assets/resources/<SHA256(exact URL)>; config/skill indexes and every skill resource must be prepared with OPENCODE_AIR_GAP_RESOURCE_LIST. Missing entries fail without internet fallback.
- npm runtime install/reify is denied in airgap (avoids npm invoking git/network or lifecycle scripts), exact prepared npm cache/package specs load directly.

## Additional bundled toolchains

`script/prepare-toolchains.ts` prepares a complete Go SDK, gopls/gofmt, Zig SDK, Terraform and terraform-ls. `script/prepare-native-resources.ts` also prepares Deno and zls. Prepared versions: Go 1.27.1, gopls 0.23.0, Zig 0.16.0, zls 0.16.0, Deno 2.9.6, Terraform 1.16.1 and terraform-ls 0.39.0. Version commands for these binaries pass on the build host; Ubuntu 24 runtime coverage is recorded separately in the main delivery checks.

## Prepare project-specific resources before disconnecting

- Copy language dependencies into the project using that language's supported offline/vendor mechanism: Go `vendor`, Cargo vendor/cache and toolchain/sysroot, npm `node_modules`, Python wheels/venv, NuGet package cache, Maven/Gradle caches, Ruby gems, Elixir deps, Terraform provider mirror, and similar ecosystem artifacts.
- Add executable SDKs/tools to `assets/bin`, preserving any supporting directory tree. An explicit local LSP command may be configured for tools whose default discovery needs a project or runtime layout.
- For built-in JVM/archive launchers, the prepared directories are `assets/bin/jdtls` and `assets/bin/vscode-eslint`; `assets/bin/java` selects the included Temurin 21 JVM. Kotlin uses `assets/bin/kotlin-language-server` with that same JVM. Node-based language servers use the installed Node 22 runtime.
- Configured additional npm plugin/provider specifications must have an exact matching `assets/cache/packages/<spec>/node_modules` directory. The connected preparation script supports `OPENCODE_AIR_GAP_NPM_PACKAGES` as comma-separated specifications. No runtime npm install is attempted in airgap mode.
- Configured remote skill/config resources use `OPENCODE_AIR_GAP_RESOURCE_LIST` (one exact URL per line) during preparation. Include each index and every referenced resource; the runtime maps each exact URL to `assets/resources/<sha256>`.

The switch does not transform arbitrary project build commands, third-party MCP subprocesses, compiler package resolution or user shell scripts into offline implementations. Prepare their dependencies separately and use OS-level network isolation when enforcing network containment for arbitrary child processes.

## Verified Ubuntu 24.04 / Node 22 evidence

On 2026-09-07, a fresh `ubuntu:24.04` Docker container ran with `--network none`, assets mounted read-only at `/opt/assets`, Node 22.16.0 mounted read-only at `/opt/node`, and `PATH=/opt/node/bin:/opt/assets/bin:/usr/bin:/bin`. No host `node_modules` was mounted.

The following commands completed successfully in that container: `rg --version`, `rust-analyzer --version`, `clangd --version`, `shfmt -version`, `lua-language-server --version`, `texlab --version`, `tinymist --version`, `deno --version`, `zls --version`, `go version`, `gofmt -d` with empty input, `zig version`, `terraform version`, `terraform-ls --version`, and `gopls version`. Bundled Node-based `prettier --version`, `biome --version`, `oxfmt --version`, and `typescript-language-server --version` also passed under Node 22.16.0.

This validates the executables, platform dynamic-library compatibility and Node runtime compatibility. It does not prove semantic analysis or compilation of every possible project without that project's dependency cache/toolchain inputs.

## Bundled Ruby and Elixir

`script/prepare-ruby-elixir.sh` prepares Ruby 3.2.3, RuboCop 1.90.0 and its gems, Erlang/OTP 25, Elixir/Mix 1.14.0, and ElixirLS v0.29.3 (commit `a20e263704911c2ccc7047647faf1d6d7e8bf132`). The older ElixirLS release matches Ubuntu 24.04's Elixir 1.14 runtime; see the [upstream compatibility table](https://github.com/elixir-lsp/elixir-ls#supported-elixir--otp-versions). The bundle includes compiled server dependencies, runtime shared libraries, `mix format`, `rubocop`, and Erlang launchers. Project-specific gems and Mix dependencies still need separate preparation.

The recipe verifies all downloaded gem archives against `script/ruby-elixir-gems.sha256`; the server checkout is pinned and its dependency lock is retained. Each native directory includes `manifest.json`, `SHA256SUMS`, exact Ubuntu package versions, and upstream/package license notices.

On 2026-09-07, `script/check-ruby-elixir.mjs` passed actual LSP initialize → shutdown → exit exchanges for RuboCop and ElixirLS in a fresh Ubuntu 24.04 container with `--network none`, fresh HOME/project directories, Node 22.16.0, and read-only assets relocated to `/opt/relocated assets`. Ruby, RuboCop, Elixir, and Mix version commands also passed. This verifies runtime relocation and LSP startup, not every project's dependencies or semantic diagnostics.

## Packaged ESLint, Java and Kotlin language servers

`script/prepare-extra-lsp.ts` verifies the pinned archives in `script/air-gap-extra-lsp-versions.json` before extraction. ESLint 3.0.34 is prebuilt; JDTLS comes from the Red Hat Java 1.56.0 distribution with its Temurin 21.0.12.1 JVM. No separate Java installation is needed to start these bundled language servers. Equinox's writable configuration is copied into the per-run temporary directory so a read-only installation works.

Air-gapped Kotlin uses the non-expiring, MIT-licensed `fwcd/kotlin-language-server` 1.3.13 (bundled Kotlin compiler 2.1.0), sharing the packaged JVM. Online mode retains the original JetBrains language-server behavior. This is an explicit offline LSP implementation replacement: the current JetBrains distribution refused to start because its build had expired. Kotlin syntax highlighting remains the existing locally packaged Tree-sitter parser; it is independent of either LSP implementation. The server archive includes its dependency license report, and the pinned upstream license is packaged as well.

In a fresh Ubuntu 24.04 container with `--network none`, Node 22.16.0 and read-only assets, `script/check-extra-lsp.mjs` verified ESLint initialization (4 capabilities), JDTLS initialization (26 capabilities), and Kotlin initialization (17 capabilities) plus diagnostics for an opened Kotlin file. Project-specific build/dependency caches remain inputs supplied by the project.

## Packaged .NET language servers

The bundle includes .NET SDK 10.0.400, Roslyn language server 5.12.0-1.26426.8 and FsAutoComplete 0.84.0. Relocatable wrappers set DOTNET_ROOT, writable user caches, and disable .NET CLI telemetry and workload update notifications. Ubuntu 24 ICU 74.2-1ubuntu3.1, OpenSSL 3.0.13-0ubuntu3.15 and zlib 1:1.3.dfsg-3.1ubuntu2.2 are included with their package notices, version manifest and checksums; runtime apt installation is unnecessary. `script/prepare-dotnet-lsp.sh` retrieves these pinned Ubuntu packages in Docker, then invokes the pinned .NET resource preparation script.

On 2026-09-07, Roslyn and FsAutoComplete both passed initialize → shutdown → exit in bare `ubuntu:24.04` with `--network none`, Node 22.16.0, fresh HOME, and read-only assets relocated to `/opt/relocated assets`. Roslyn reports a nonfatal inability to write its MEF cache beside a read-only installation and rebuilds that cache in memory; initialization still succeeds. The JSON-RPC check uses an empty object for shutdown parameters because this Roslyn formatter rejects explicit JSON null.

NuGet dependencies and SDK versions selected by each project's global.json remain project inputs. Razor additionally depends on a locally installed compatible C# extension, as in the original discovery-only implementation. The Microsoft VS Code C# runtime extension is not redistributed: its [runtime license](https://github.com/dotnet/vscode-csharp/blob/main/RuntimeLicenses/license.txt) restricts use and standalone redistribution. This does not affect C#/F# server startup or locally bundled Razor syntax highlighting.
