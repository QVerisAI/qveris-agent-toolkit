import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { createQverisTools } from "./src/qveris-tools.js";

export default definePluginEntry({
  id: "qveris",
  name: "QVeris Plugin",
  description: "QVeris capability discovery, tool inspection, and tool calling",
  register(api: OpenClawPluginApi) {
    api.registerTool((ctx) => createQverisTools({ api, ctx }), {
      names: ["qveris_discover", "qveris_call", "qveris_inspect"],
    });
  },
});
