import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: [
    "index.ts",
    "src/config.ts",
    "src/qveris-cache.ts",
    "src/qveris-client.ts",
    "src/qveris-errors.ts",
    "src/qveris-materialization.ts",
    "src/qveris-tools.ts",
  ],
  outdir: "dist",
  outbase: ".",
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
});
