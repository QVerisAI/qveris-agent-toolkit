import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));

export const DEFAULTS = {
  base_url: "https://qveris.ai/api/v1",
  default_limit: 5,
  default_max_size: 4096,
  color: "auto",
  output_format: "human",
};

export const VERSION = pkg.version;
