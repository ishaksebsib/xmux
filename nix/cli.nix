{
  lib,
  stdenvNoCC,
  fetchPnpmDeps,
  makeWrapper,
  nodejs_22,
  pnpm_11,
  pnpmConfigHook,
  versionCheckHook,
  pnpmDepsHash ? (lib.importJSON ./hashes.json).pnpmDeps,
}:

let
  packageJson = lib.importJSON ../apps/cli/package.json;

  nodejs = nodejs_22;
  pnpm = pnpm_11.override { nodejs-slim = nodejs; };

  workspaceFilter = "@xmux/cli";
  workspaceDependencyFilter = "${workspaceFilter}...";

  sourceFiles = lib.fileset.intersection (lib.fileset.fromSource (lib.sources.cleanSource ../.)) (
    lib.fileset.unions [
      ../apps/cli
      ../apps/server
      ../packages
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../turbo.json
    ]
  );

  supportedPlatforms = [
    "x86_64-linux"
    "aarch64-linux"
    "aarch64-darwin"
  ];
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "xmux";
  version = packageJson.version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = sourceFiles;
  };

  pnpmWorkspaces = [ workspaceDependencyFilter ];

  pnpmInstallFlags = [
    "--child-concurrency=1"
    "--network-concurrency=4"
  ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      src
      pnpmWorkspaces
      pnpmInstallFlags
      ;
    inherit pnpm;
    fetcherVersion = 4;
    hash = pnpmDepsHash;
  };

  __structuredAttrs = true;
  strictDeps = true;

  nativeBuildInputs = [
    makeWrapper
    nodejs
    pnpm
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild

    pnpm --filter ${workspaceDependencyFilter} build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    packageOut="$out/lib/node_modules/@xmux/cli"
    pnpm --config.inject-workspace-packages=true \
      --filter ${workspaceFilter} \
      deploy --offline --prod "$packageOut"

    makeWrapper ${lib.getExe nodejs} "$out/bin/xmux" \
      --add-flags "$packageOut/dist/bin/xmux.mjs" \
      --set NODE_ENV production

    runHook postInstall
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform;
  versionCheckProgramArg = "--version";

  meta = {
    description = packageJson.description;
    homepage = packageJson.homepage;
    license = lib.licenses.mit;
    mainProgram = "xmux";
    platforms = supportedPlatforms;
  };
})
