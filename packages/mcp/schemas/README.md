# Vendored discovery schemas

## `server-card.schema.json`

The MCP Server Card JSON Schema (experimental extension, SEP-2127), vendored so
CI can validate the cards this package generates without depending on upstream
availability.

- Source: <https://github.com/modelcontextprotocol/experimental-ext-server-card>
- Pinned commit: `3b2d974dbbc1bcf899e0ed2ef49a91758853c9a6` (2026-07-13)
- Upstream path: `schema.json`

The card's public `$schema` URL
(`https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json`)
is the canonical versioned location, but upstream has not published it there
yet. Until it resolves, validation runs only against this pinned copy;
`scripts/check-server-card-schema-url.mjs` probes the public URL in CI and
reports availability/drift without failing the build, so a red build always
means "generated card is invalid" and never "upstream URL is down".

To update: fetch `schema.json` from a newer upstream commit, replace the file,
update the pinned commit above, and re-run `npm test` (the schema validation
tests in `src/server-card.schema.test.ts` must pass).
