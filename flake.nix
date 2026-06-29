{
  description = "xmux - control your coding agents from anywhere, discord, slack, telegram.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      forEachSupportedSystem = buildAttrs:
        lib.genAttrs supportedSystems (system:
          buildAttrs {
            inherit system;
            pkgs = nixpkgs.legacyPackages.${system};
          }
        );

      mkCliPackage = pkgs: pkgs.callPackage ./nix/cli.nix { };

      mkCliDepsUpdaterPackage = pkgs:
        pkgs.callPackage ./nix/cli.nix {
          pnpmDepsHash = pkgs.lib.fakeHash;
        };

      mkCliApp = cliPackage: {
        type = "app";
        program = lib.getExe cliPackage;
      };
    in
    {
      overlays.default = final: _prev: {
        xmux = final.callPackage ./nix/cli.nix { };
        xmux-cli = final.xmux;
      };

      packages = forEachSupportedSystem ({ pkgs, ... }:
        let
          cliPackage = mkCliPackage pkgs;
        in
        {
          cli = cliPackage;
          xmux = cliPackage;
          default = cliPackage;

          # Build this after pnpm-lock.yaml changes to get the new pnpmDepsHash.
          cli-deps-updater = mkCliDepsUpdaterPackage pkgs;
        }
      );

      apps = forEachSupportedSystem ({ system, ... }:
        let
          cliApp = mkCliApp self.packages.${system}.cli;
        in
        {
          cli = cliApp;
          xmux = cliApp;
          default = cliApp;
        }
      );

      devShells = forEachSupportedSystem ({ pkgs, ... }: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm_11

            just
          ];
        };
      });

      formatter = forEachSupportedSystem ({ pkgs, ... }:
        pkgs.treefmt.withConfig {
          runtimeInputs = [ pkgs.nixfmt ];
          settings = {
            on-unmatched = "info";
            formatter.nixfmt = {
              command = "nixfmt";
              includes = [ "*.nix" ];
            };
          };
        }
      );
    };
}
