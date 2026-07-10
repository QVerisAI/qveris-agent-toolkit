"""Session-scoped credit budget for the agent loop.

``BudgetTracker`` bounds how many credits an autonomous agent may spend. It is
disabled (a no-op) unless a limit is set, so default agent behavior is
unchanged. When enabled it:

- learns per-capability cost estimates from ``discover`` / ``inspect`` results
  (the ``expected_cost`` field), then
- blocks a ``call`` whose estimate would push cumulative spend over the limit
  *before the request is sent*, and
- accumulates actual spend from each ``call`` response's billing.

Cost estimates and charges are read from the JSON-shaped tool results the agent
already handles, so the tracker needs no extra network calls.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Optional


def parse_credits(value: Any) -> Optional[float]:
    """Coerce an ``expected_cost`` / credit value (str, int, or float) to float.

    Returns ``None`` for missing, unparseable, or non-finite values. ``bool`` is
    rejected so a stray ``True``/``False`` is not read as ``1.0``/``0.0``.
    Non-finite values (``NaN`` / ``inf``, which ``json.loads`` and pydantic both
    admit) are rejected so a malformed billing amount cannot poison cumulative
    spend and silently disable the guard.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        result = float(value)
    elif isinstance(value, str):
        try:
            result = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return result if math.isfinite(result) else None


def _as_dict(value: Any) -> Optional[Dict[str, Any]]:
    """Return a plain-dict view of a dict or a pydantic model, else ``None``.

    The agent loop feeds JSON-shaped dicts (from ``model_dump()``), but the
    public ``BudgetTracker`` may be handed pydantic models (``SearchResponse``,
    ``ToolExecutionResponse``) directly — accept both so a model does not
    silently disable estimate caching or spend accumulation.
    """
    if isinstance(value, dict):
        return value
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            dumped = dump()
        except Exception:
            return None
        return dumped if isinstance(dumped, dict) else None
    return None


class BudgetTracker:
    """Track and enforce a per-session credit budget.

    Args:
        limit: Maximum credits the session may spend. ``None`` disables the
            tracker entirely.
        warn_ratio: Emit a single warning once cumulative spend first reaches
            this fraction of ``limit`` (default 0.8).

    Notes:
        - Best-effort, not a hard cap: blocking uses the pre-call
          ``expected_cost`` estimate while ``spent`` accumulates the actual
          (possibly larger) charge, so a call estimated under-budget that
          charges more can push ``spent`` past ``limit``. The guard is only as
          tight as ``discover`` / ``inspect`` coverage — a call whose cost was
          never observed cannot be estimated and is not blocked.
        - The tracker is per-``Agent`` session state, not per-``run()``. Don't
          share one ``Agent`` across concurrent ``run()`` calls if you rely on
          the budget: they share and race ``spent``.
    """

    def __init__(self, limit: Optional[float] = None, warn_ratio: float = 0.8) -> None:
        self.limit = limit
        self.warn_ratio = warn_ratio
        self.spent = 0.0
        self._estimates: Dict[str, float] = {}
        self._warned = False

    @property
    def enabled(self) -> bool:
        return self.limit is not None

    @property
    def remaining(self) -> Optional[float]:
        if self.limit is None:
            return None
        return max(0.0, self.limit - self.spent)

    def observe(self, result: Any) -> None:
        """Cache ``expected_cost`` per ``tool_id`` from a discover/inspect payload.

        Accepts a dict or a pydantic ``SearchResponse``.
        """
        if not self.enabled:
            return
        data = _as_dict(result)
        if data is None:
            return
        for item in data.get("results") or []:
            entry = _as_dict(item)
            if entry is None:
                continue
            tool_id = entry.get("tool_id")
            cost = parse_credits(entry.get("expected_cost"))
            if isinstance(tool_id, str) and cost is not None:
                self._estimates[tool_id] = cost

    def estimate(self, tool_id: Optional[str]) -> Optional[float]:
        """Return the cached cost estimate for ``tool_id``, if known."""
        if not isinstance(tool_id, str):
            return None
        return self._estimates.get(tool_id)

    def check(self, tool_id: Optional[str]) -> Optional[Dict[str, Any]]:
        """Return a block payload if calling ``tool_id`` would exceed the budget.

        Returns ``None`` (allowed) when the tracker is disabled, the cost is
        unknown (cannot estimate, so not blocked), or the projected spend is
        within the limit.
        """
        if not self.enabled:
            return None
        est = self.estimate(tool_id)
        if est is None:
            return None
        projected = self.spent + est
        if projected > self.limit:  # type: ignore[operator]
            return {
                "tool_id": tool_id,
                "estimated": est,
                "spent": self.spent,
                "limit": self.limit,
                "remaining": self.remaining,
                "projected": projected,
            }
        return None

    def record(self, execution: Any) -> Optional[Dict[str, Any]]:
        """Add the actual charge from a ``call`` result to cumulative spend.

        Returns a warning payload the first time spend reaches
        ``warn_ratio * limit``; otherwise ``None``.
        """
        if not self.enabled:
            return None
        charge = self._charge_of(execution)
        if charge:
            self.spent += charge
        if not self._warned and self.limit is not None and self.spent >= self.limit * self.warn_ratio:
            self._warned = True
            return self.snapshot()
        return None

    def snapshot(self) -> Dict[str, Any]:
        """Return the current budget state (queryable, reconcilable with usage/ledger)."""
        return {"limit": self.limit, "spent": self.spent, "remaining": self.remaining}

    @staticmethod
    def _charge_of(execution: Any) -> float:
        """Extract the pre-settlement charge from a call result.

        Accepts a dict or a pydantic ``ToolExecutionResponse``.
        """
        data = _as_dict(execution)
        if data is None:
            return 0.0
        billing = _as_dict(data.get("billing"))
        if billing is not None:
            for key in ("list_amount_credits", "requested_amount_credits"):
                value = parse_credits(billing.get(key))
                if value is not None:
                    return value
        return parse_credits(data.get("cost")) or 0.0
