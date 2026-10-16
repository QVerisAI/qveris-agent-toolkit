export function parseNpmPackResult(raw, packageName) {
  const result = JSON.parse(raw);
  // npm <=11 returns an array; npm 12 keys results by package name.
  const packs = Array.isArray(result) ? result : Object.values(result ?? {});
  if (packs.length !== 1 || packs[0]?.name !== packageName) {
    throw new Error(`npm pack must report exactly one result for ${packageName}`);
  }
  return packs[0];
}
