"""Optional OpenTelemetry tracing for the QVeris SDK.

Instrumenting ``discover`` / ``inspect`` / ``call`` emits one span each, with
attributes (``tool_id``, ``search_id``, ``execution_id``, ``elapsed_time_ms``,
``credits``) so a trace can be correlated with the QVeris usage/ledger records.

Tracing is **opt-in and dependency-free by default**:

- If ``opentelemetry-api`` is not installed (``pip install qveris[otel]`` adds it),
  every helper here is a no-op — zero overhead, zero behaviour change.
- If it is installed but no tracer provider/exporter is configured, spans are
  created against OpenTelemetry's default no-op provider (still effectively free).
- Configure an OTLP exporter in your app and the spans flow to Jaeger, Tempo,
  or any OTLP backend.

Nothing here records the natural-language ``query`` or tool parameters, to avoid
leaking user input into traces.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional

try:  # opentelemetry-api is an optional extra (qveris[otel]).
    from opentelemetry import trace as _otel_trace
    from opentelemetry.trace import Status, StatusCode
except ImportError:  # opentelemetry not installed -> fully no-op
    _otel_trace = None  # type: ignore[assignment]
    Status = None  # type: ignore[assignment]
    StatusCode = None  # type: ignore[assignment]
    _tracer: Any = None
else:
    try:  # keep the instrumenting-library version on the tracer when available.
        from importlib.metadata import version as _pkg_version

        _QVERIS_VERSION: Optional[str] = _pkg_version("qveris")
    except Exception:  # pragma: no cover - metadata missing in odd installs
        _QVERIS_VERSION = None
    try:
        _tracer = _otel_trace.get_tracer("qveris", _QVERIS_VERSION)
    except Exception:  # pragma: no cover - a broken otel install must not break import
        _tracer = None


# Span attribute keys (kept under a `qveris.` namespace).
ATTR_OPERATION = "qveris.operation"
ATTR_TOOL_ID = "qveris.tool_id"
ATTR_TOOL_ID_COUNT = "qveris.tool_id_count"
ATTR_SEARCH_ID = "qveris.search_id"
ATTR_EXECUTION_ID = "qveris.execution_id"
ATTR_SESSION_ID = "qveris.session_id"
ATTR_LIMIT = "qveris.limit"
ATTR_RESULT_COUNT = "qveris.result_count"
ATTR_ELAPSED_MS = "qveris.elapsed_time_ms"
ATTR_SUCCESS = "qveris.success"
ATTR_CREDITS = "qveris.credits"


def is_tracing_enabled() -> bool:
    """True when opentelemetry-api is importable and a tracer is available."""
    return _tracer is not None


def set_span_attributes(span: Any, attributes: Dict[str, Any]) -> None:
    """Set non-``None`` attributes on ``span``, best-effort.

    No-op when tracing is off, and swallows any tracer error — instrumentation
    must never break the traced operation.
    """
    if span is None:
        return
    for key, value in attributes.items():
        if value is not None:
            try:
                span.set_attribute(key, value)
            except Exception:  # pragma: no cover - defensive
                pass


@contextmanager
def start_span(name: str, attributes: Optional[Dict[str, Any]] = None) -> Iterator[Any]:
    """Start a span for a QVeris operation.

    Yields the span (or ``None`` when tracing is disabled/unavailable). On an
    exception from the traced body the span is marked ``ERROR`` and the exception
    recorded before re-raising, so a failed ``call`` shows up as a failed span.

    Tracing is strictly best-effort: any fault in the tracer itself (a broken
    provider, sampler, or exporter) degrades to a no-op rather than propagating
    into — and breaking — the traced operation.
    """
    if _tracer is None:
        yield None
        return

    try:
        # Disable the SDK's own exception recording; we record once, manually.
        span_cm = _tracer.start_as_current_span(
            name, record_exception=False, set_status_on_exception=False
        )
        span = span_cm.__enter__()
    except Exception:  # pragma: no cover - tracer setup fault -> run untraced
        yield None
        return

    set_span_attributes(span, attributes or {})
    exc_info: Any = (None, None, None)
    try:
        yield span
    except BaseException as exc:  # noqa: BLE001 - record then re-raise the ORIGINAL error
        exc_info = (type(exc), exc, exc.__traceback__)
        try:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, str(exc)))
        except Exception:  # pragma: no cover - defensive
            pass
        raise
    finally:
        # End the span; guard so an exporter/exit fault can't mask the result.
        try:
            span_cm.__exit__(*exc_info)
        except Exception:  # pragma: no cover - defensive
            pass
