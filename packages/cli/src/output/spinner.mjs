const FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

export function createSpinner(message) {
  if (!process.stderr.isTTY) return { stop() {} };

  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r  ${FRAMES[i++ % FRAMES.length]} ${message}`);
  }, 80);

  return {
    stop(clearLine = true) {
      clearInterval(timer);
      if (clearLine) process.stderr.write("\r\x1b[K");
    },
  };
}
