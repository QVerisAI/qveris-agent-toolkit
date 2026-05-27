import { fileURLToPath, URL } from "node:url";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./test/fixtures/${name}`, import.meta.url));
}

export default {
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@sinclair/typebox": fixture("typebox.ts"),
      "openclaw/plugin-sdk/agent-runtime": fixture("openclaw-agent-runtime.ts"),
      "openclaw/plugin-sdk/plugin-entry": fixture("openclaw-plugin-entry.ts"),
      "openclaw/plugin-sdk/provider-auth": fixture("openclaw-provider-auth.ts"),
      "openclaw/plugin-sdk/secret-input": fixture("openclaw-secret-input.ts"),
    },
  },
};
