import { execFile } from "node:child_process";
import { platform } from "node:os";

export function getOpenUrlCommand(url, currentPlatform = platform()) {
  if (currentPlatform === "darwin") return { command: "open", args: [url] };
  if (currentPlatform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export function openUrl(url) {
  const { command, args } = getOpenUrlCommand(url);
  execFile(command, args, () => {});
}
