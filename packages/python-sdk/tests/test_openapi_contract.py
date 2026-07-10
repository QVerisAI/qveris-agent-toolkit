"""Issue #37 phase 3 (#47): first low-risk adoption of the generated models.

The hand-written models in ``qveris.types`` remain the public SDK surface.
This test starts *consuming* the generated contract reference
(``qveris.generated.openapi_models``) as a drift guard: it fails if the
generated module stops importing or if a core contract model the SDK depends
on disappears from the spec. It does not assert field-by-field equivalence —
aligning stable fields with the generated models is intentionally gradual.
"""

import importlib.util
from pathlib import Path

import pytest
from pydantic import BaseModel

# Load the generated module by file path so the test does NOT execute
# qveris/__init__.py (which imports the full client: httpx, openai, ...).
# The generated artifact only depends on pydantic + stdlib, keeping this
# guard a true contract check with a minimal dependency surface.
_gen_path = Path(__file__).resolve().parents[1] / "qveris" / "generated" / "openapi_models.py"
_spec = importlib.util.spec_from_file_location("qveris_generated_openapi_models", _gen_path)
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

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
    assert isinstance(model, type) and issubclass(model, BaseModel), f"{name} is not a pydantic BaseModel"


def test_search_request_contract_shape():
    # Structural drift signal on the request the SDK/CLI sends. (We assert on
    # model_fields rather than instantiating: the generated file uses
    # `from __future__ import annotations` + constrained types, so validation
    # requires model_rebuild(); the field map is the stable contract anyway.)
    fields = gen.PublicSearchRequest.model_fields
    assert "query" in fields and fields["query"].is_required()
    assert "limit" in fields and not fields["limit"].is_required()
    assert "session_id" in fields and not fields["session_id"].is_required()
