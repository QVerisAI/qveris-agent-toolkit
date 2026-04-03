#!/usr/bin/env node
import { main } from "../src/main.mjs";

main(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exitCode = process.exitCode || 1;
});
