{
  description = "Orca development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          node = pkgs.nodejs_24;
          pnpm = pkgs.writeShellScriptBin "pnpm" ''
            exec ${node}/bin/corepack pnpm "$@"
          '';
          linuxRuntimeLibraries = with pkgs; [
            alsa-lib atk at-spi2-atk at-spi2-core cairo cups dbus expat
            fontconfig freetype gdk-pixbuf glib gtk3 libdrm libgbm libnotify
            libsecret libxkbcommon nspr nss pango wayland libx11 libxcomposite
            libxcursor libxdamage libxext libxfixes libxi libxinerama libxrandr
            libxscrnsaver libxtst libxcb libxshmfence
          ];
        in
        {
          default = pkgs.mkShell {
            packages = [
              node
              pnpm
              pkgs.direnv
              pkgs.git
              pkgs.gnumake
              pkgs.node-gyp
              pkgs.pkg-config
              pkgs.python3
              pkgs.ripgrep
              pkgs.stdenv.cc
            ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux linuxRuntimeLibraries;

            shellHook =
              pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
                export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath linuxRuntimeLibraries}:''${LD_LIBRARY_PATH:-}"
              ''
              + ''
                export npm_config_node_gyp="${pkgs.node-gyp}/bin/node-gyp"
              '';
          };
        }
      );
    };
}
