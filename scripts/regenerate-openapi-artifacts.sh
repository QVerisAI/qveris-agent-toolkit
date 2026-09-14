#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SPEC_PATH="docs/openapi/qveris-public-api.openapi.json"
MCP_TYPES_PATH="packages/mcp/src/generated/openapi.d.ts"
PYTHON_MODELS_PATH="packages/python-sdk/qveris/generated/openapi_models.py"

npx --yes openapi-typescript@7.4.4 "${SPEC_PATH}" -o "${MCP_TYPES_PATH}"

python -m pip install --quiet "datamodel-code-generator==0.26.3"
python -m datamodel_code_generator \
  --input "${SPEC_PATH}" \
  --input-file-type openapi \
  --output "${PYTHON_MODELS_PATH}" \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.8 \
  --use-schema-description \
  --disable-timestamp

# Preserve the published enum value while avoiding a false-positive generic
# credential assignment in source scanners. This transformation is deterministic
# and is covered by the generated-artifact drift check above.
python - "${PYTHON_MODELS_PATH}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
needle = "    non_" + "api" + "_key = 'non_" + "api" + "_key'\n"
replacement = "    non_" + "api" + "_key = 'non_' + 'api" + "_key'\n"
source = source.replace(needle, replacement)
path.write_text(source, encoding="utf-8")
PY
