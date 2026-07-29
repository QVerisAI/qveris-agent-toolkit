const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function compareNumericIdentifiers(left, right) {
  const normalizedLeft = left.replace(/^0+/, "") || "0"
  const normalizedRight = right.replace(/^0+/, "") || "0"
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1
  }
  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft > normalizedRight ? 1 : -1
}

export function compareReleaseVersions(left, right) {
  const [leftCore, ...leftPrereleaseParts] = left.split("-")
  const [rightCore, ...rightPrereleaseParts] = right.split("-")
  const leftCoreParts = leftCore.split(".")
  const rightCoreParts = rightCore.split(".")

  for (let index = 0; index < 3; index += 1) {
    const comparison = compareNumericIdentifiers(leftCoreParts[index], rightCoreParts[index])
    if (comparison !== 0) return comparison
  }

  const leftPrerelease = leftPrereleaseParts.join("-")
  const rightPrerelease = rightPrereleaseParts.join("-")
  if (!leftPrerelease && !rightPrerelease) return 0
  if (!leftPrerelease) return 1
  if (!rightPrerelease) return -1

  const leftIdentifiers = leftPrerelease.split(".")
  const rightIdentifiers = rightPrerelease.split(".")
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftIdentifiers[index]
    const rightIdentifier = rightIdentifiers[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier)
    }
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier > rightIdentifier ? 1 : -1
  }
  return 0
}

export function latestReleaseTag(tags, prefix) {
  const candidates = tags.filter(Boolean).map((tag) => {
    const version = tag.startsWith(prefix) ? tag.slice(prefix.length) : ""
    if (!VERSION_RE.test(version)) {
      throw new Error(`${tag} does not match expected ${prefix}<version> format`)
    }
    return { tag, version }
  })
  if (candidates.length === 0) return null
  candidates.sort((left, right) => compareReleaseVersions(right.version, left.version))
  return candidates[0].tag
}
