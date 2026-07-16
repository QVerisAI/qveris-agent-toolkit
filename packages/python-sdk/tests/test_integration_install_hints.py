import importlib

import pytest


@pytest.mark.parametrize("adapter", ["autogen", "llamaindex", "pydantic_ai"])
def test_python_310_adapter_install_hints_name_version_requirement(adapter: str) -> None:
    module = importlib.import_module(f"qveris.integrations.{adapter}")
    assert "Python >=3.10" in module._INSTALL_HINT
