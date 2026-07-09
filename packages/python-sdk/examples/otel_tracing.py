"""Trace QVeris discover/call with OpenTelemetry.

    pip install qveris[otel] opentelemetry-sdk
    export QVERIS_API_KEY="sk-..."
    python otel_tracing.py

This wires a console span exporter so you can see the spans locally. To send
them to Jaeger/Tempo/any OTLP backend instead, swap ConsoleSpanExporter for the
OTLP exporter:

    # pip install opentelemetry-exporter-otlp
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    # OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

Spans carry qveris.* attributes (operation, tool_id, search_id, execution_id,
elapsed_time_ms, success, credits) — enough to correlate a trace with the
QVeris usage/ledger records. The query text and tool params are not recorded.
"""

import asyncio
import os

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

from qveris import QverisClient


def setup_tracing() -> None:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)


async def main() -> None:
    setup_tracing()

    if not os.getenv("QVERIS_API_KEY"):
        print("Set QVERIS_API_KEY to run a real traced discover/call.")
        return

    client = QverisClient()
    try:
        found = await client.discover("stock quote API", limit=5)
        if not found.results:
            print("No capabilities found.")
            return

        tool = found.results[0]
        result = await client.call(
            tool.tool_id,
            {"symbol": "AAPL"},
            search_id=found.search_id,
        )
        print(f"execution_id={result.execution_id} success={result.success}")
        # Two spans (qveris.discover, qveris.call) are printed to the console above.
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
