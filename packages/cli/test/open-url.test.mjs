import assert from "node:assert/strict";
import test from "node:test";
import { getOpenUrlCommand } from "../src/utils/open-url.mjs";

test("Windows URL opening does not pass URL metacharacters through cmd.exe", () => {
  const url = "https://unit.test/verify?user_code=ABCD&source=cli";
  assert.deepEqual(getOpenUrlCommand(url, "win32"), {
    command: "rundll32.exe",
    args: ["url.dll,FileProtocolHandler", url],
  });
});
