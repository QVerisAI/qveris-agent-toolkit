const enabled =
  !process.env.NO_COLOR &&
  (process.env.FORCE_COLOR === "1" || (process.stdout.isTTY && process.stderr.isTTY));

const code = (open, close) =>
  enabled ? (s) => `\x1b[${open}m${s}\x1b[${close}m` : (s) => s;

export const bold = code("1", "22");
export const dim = code("2", "22");
export const red = code("31", "39");
export const green = code("32", "39");
export const yellow = code("33", "39");
export const cyan = code("36", "39");
export const gray = code("90", "39");

export const isColorEnabled = () => enabled;
