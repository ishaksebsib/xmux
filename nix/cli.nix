{
  lib,
  stdenvNoCC,
  fetchPnpmDeps,
  makeWrapper,
  nodejs_24,
  pnpm_11,
  pnpmConfigHook,
  versionCheckHook,
  pnpmDepsHash ? (lib.importJSON ./hashes.json).pnpmDeps.${stdenvNoCC.hostPlatform.system},
}:

let
  packageJson = lib.importJSON ../apps/cli/package.json;

  nodejs = nodejs_24;
  pnpm = pnpm_11.override { nodejs-slim = nodejs; };

  workspaceFilter = "@xmux/cli";
  workspaceDependencyFilter = "${workspaceFilter}...";

  sourceFiles = lib.fileset.unions [
    ../apps/cli
    ../apps/server
    ../packages
    ../package.json
    ../pnpm-lock.yaml
    ../pnpm-workspace.yaml
    ../turbo.json
  ];

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

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src pnpmWorkspaces;
    inherit pnpm;
    fetcherVersion = 3;
    hash = pnpmDepsHash;
  };

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
    pnpm --filter ${workspaceFilter} deploy --prod --legacy "$packageOut"

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
