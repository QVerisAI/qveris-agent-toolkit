import json
from typing import Any, Dict, List, Optional, Tuple

import pytest

from qveris.integrations._workflow import build_qveris_workflow


class RecordingClient:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    async def handle_tool_call(
        self,
        func_name: str,
        func_args: Dict[str, Any],
        session_id: Optional[str] = None,
    ) -> Tuple[Any, bool, bool]:
        self.calls.append({"name": func_name, "args": func_args, "session_id": session_id})
        return {"success": True}, False, True


@pytest.mark.asyncio
async def test_workflow_forwards_model_only_to_paid_calls() -> None:
    client = RecordingClient()
    workflow = build_qveris_workflow(client, session_id="session-1", model="router-model-v1")  # type: ignore[arg-type]

    assert json.loads(await workflow.discover("weather")) == {"success": True}
    assert json.loads(await workflow.call("weather.tool.v1", {})) == {"success": True}

    assert client.calls == [
        {
            "name": "discover",
            "args": {"query": "weather", "limit": 20},
            "session_id": "session-1",
        },
        {
            "name": "call",
            "args": {
                "tool_id": "weather.tool.v1",
                "params_to_tool": {},
                "model": "router-model-v1",
            },
            "session_id": "session-1",
        },
    ]
