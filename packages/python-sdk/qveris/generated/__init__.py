"""Generated OpenAPI contract models (issue #37, phase 2).

`openapi_models.py` is generated from the website-mirrored
`docs/openapi/qveris-public-api.openapi.json` by `datamodel-code-generator`
(pinned in the ``dev`` extra). It is a **contract reference**, not the public
SDK surface — the hand-written models in ``qveris.types`` remain the public
API. Do not edit the generated file by hand; regenerate instead:

    python -m datamodel_code_generator \\
      --input ../../docs/openapi/qveris-public-api.openapi.json \\
      --input-file-type openapi \\
      --output qveris/generated/openapi_models.py \\
      --output-model-type pydantic_v2.BaseModel \\
      --target-python-version 3.8 --use-schema-description --disable-timestamp

CI re-runs this and fails on `git diff --exit-code` to catch contract drift.
"""
