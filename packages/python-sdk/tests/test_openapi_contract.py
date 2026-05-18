"""Issue #37 phase 3 (#47): first low-risk adoption of the generated models.

The hand-written models in ``qveris.types`` remain the public SDK surface.
This test starts *consuming* the generated contract reference
(``qveris.generated.openapi_models``) as a drift guard: it fails if the
generated module stops importing or if a core contract model the SDK depends
on disappears from the spec. It does not assert field-by-field equivalence —
aligning stable fields with the generated models is intentionally gradual.
"""

import importlib

import pytest
from pydantic import BaseModel

gen = importlib.import_module("qveris.generated.openapi_models")

# Core contract models the Python SDK / CLI deserialize. Kept focused so the
# guard tracks toolkit-relevant drift without being brittle to unrelated
# backend schema churn.
CORE_MODELS = [
    "PublicSearchRequest",
    "PublicSearchResponse",
    "PublicCapabilityResult",
    "PublicToolsByIdsRequest",
    "PublicExecuteToolRequest",
    "PublicExecuteToolResponse",
    "PublicCompactBillingStatement",
    "CreditsLedgerResponse",
    "UsageEventsResponse",
]


def test_generated_module_imports():
    assert gen is not None


@pytest.mark.parametrize("name", CORE_MODELS)
def test_core_contract_model_present_and_pydantic(name):
    model = getattr(gen, name, None)
    assert model is not None, (
        f"{name} missing from generated contract — the public OpenAPI spec or "
        f"the pinned generator drifted; regenerate qveris/generated/openapi_models.py"
    )
    assert isinstance(model, type) and issubclass(model, BaseModel), (
        f"{name} is not a pydantic BaseModel"
    )


def test_search_request_roundtrips():
    # Smoke: the generated request model is usable, not just importable.
    req = gen.PublicSearchRequest(query="weather in SF")
    assert req.query == "weather in SF"
