from qveris import BudgetTracker
from qveris.agent.budget import parse_credits


def test_parse_credits_handles_str_number_and_rejects_bool_and_junk() -> None:
    assert parse_credits("2.37") == 2.37
    assert parse_credits(3) == 3.0
    assert parse_credits(1.5) == 1.5
    assert parse_credits(" 4 ") == 4.0
    assert parse_credits(True) is None
    assert parse_credits(None) is None
    assert parse_credits("n/a") is None
    assert parse_credits({}) is None


def test_parse_credits_rejects_non_finite() -> None:
    assert parse_credits("inf") is None
    assert parse_credits("nan") is None
    assert parse_credits(float("inf")) is None
    assert parse_credits(float("-inf")) is None
    assert parse_credits(float("nan")) is None


def test_non_finite_billing_does_not_poison_spend_or_disable_guard() -> None:
    b = BudgetTracker(10)
    b.observe({"results": [{"tool_id": "t", "expected_cost": "6"}]})

    # A NaN/inf billing amount must be ignored, not accumulated into spent.
    b.record({"billing": {"list_amount_credits": float("nan")}})
    assert b.spent == 0.0
    b.record({"billing": {"list_amount_credits": float("inf")}})
    assert b.spent == 0.0

    # Guard still functions after: real 5 spent, a 6-credit call (11 > 10) blocks.
    b.record({"billing": {"list_amount_credits": 5}})
    assert b.spent == 5.0
    assert b.check("t") is not None


def test_disabled_tracker_is_a_noop() -> None:
    b = BudgetTracker(None)
    assert b.enabled is False
    assert b.remaining is None
    b.observe({"results": [{"tool_id": "t", "expected_cost": "5"}]})
    assert b.check("t") is None  # never blocks
    assert b.record({"billing": {"list_amount_credits": 5}}) is None
    assert b.spent == 0.0
    assert b.snapshot() == {"limit": None, "spent": 0.0, "remaining": None}


def test_observe_caches_expected_cost_from_str_and_number() -> None:
    b = BudgetTracker(100)
    b.observe(
        {
            "results": [
                {"tool_id": "cheap", "expected_cost": "1"},
                {"tool_id": "pricey", "expected_cost": 24.2},
                {"tool_id": "nocost"},
                "not-a-dict",
            ]
        }
    )
    assert b.estimate("cheap") == 1.0
    assert b.estimate("pricey") == 24.2
    assert b.estimate("nocost") is None
    assert b.estimate("unknown") is None


def test_check_blocks_only_when_projected_spend_exceeds_limit() -> None:
    b = BudgetTracker(10)
    b.observe({"results": [{"tool_id": "t", "expected_cost": "6"}]})

    # Within budget: 0 + 6 <= 10 -> allowed.
    assert b.check("t") is None

    # Unknown cost is never blocked (cannot estimate).
    assert b.check("unknown") is None

    # After spending 5, a second 6-credit call (11 > 10) is blocked.
    b.record({"billing": {"list_amount_credits": 5}})
    block = b.check("t")
    assert block is not None
    assert block["estimated"] == 6.0
    assert block["spent"] == 5.0
    assert block["projected"] == 11.0
    assert block["limit"] == 10


def test_record_accumulates_charge_with_billing_precedence_and_cost_fallback() -> None:
    b = BudgetTracker(100)
    b.record({"billing": {"list_amount_credits": 3}})
    assert b.spent == 3.0
    # requested_amount_credits used when list is absent
    b.record({"billing": {"requested_amount_credits": 2}})
    assert b.spent == 5.0
    # cost fallback when no billing
    b.record({"cost": "4"})
    assert b.spent == 9.0
    # unparseable charge does not change spend
    b.record({"cost": "n/a"})
    assert b.spent == 9.0


def test_record_emits_a_single_warning_at_the_threshold() -> None:
    b = BudgetTracker(10, warn_ratio=0.8)
    assert b.record({"cost": 5}) is None  # 5/10 < 0.8
    warn = b.record({"cost": 3})  # 8/10 >= 0.8
    assert warn is not None
    assert warn["spent"] == 8.0
    assert warn["remaining"] == 2.0
    # No repeat warning on further spend.
    assert b.record({"cost": 1}) is None


def test_remaining_never_goes_negative() -> None:
    b = BudgetTracker(5)
    b.record({"cost": 8})
    assert b.spent == 8.0
    assert b.remaining == 0.0
