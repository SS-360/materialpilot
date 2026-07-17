# Release process

1. Update `CHANGELOG.md` and `compatibility.json`.
2. Run `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm build` on Windows, Linux, and macOS.
3. Run Material Maker 1.7/Godot 4.7 native contract and clean-install tests.
4. Run `pnpm compatibility` and the native Godot compatibility-matrix job.
5. Generate a standalone staged release, archive, checksum, and embedded SBOM with `pnpm package`.
6. Generate a standalone development SBOM with `pnpm generate:sbom` when needed.
7. Sign platform archives where available and publish npm packages from the verified commit.

Do not call a release stable while preview/export adapters or native compatibility gates claimed by its manifest are unavailable.
