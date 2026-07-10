import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

execFileSync(
  "npx",
  [
    "--yes",
    "esbuild@0.28.0",
    "index.ts",
    "src/config.ts",
    "src/qveris-cache.ts",
    "src/qveris-client.ts",
    "src/qveris-errors.ts",
    "src/qveris-materialization.ts",
    "src/qveris-tools.ts",
    "--outdir=dist",
    "--outbase=.",
    "--format=esm",
    "--platform=node",
    "--target=node20",
    "--packages=external",
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);
