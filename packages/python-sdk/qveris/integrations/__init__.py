"""Framework adapters for the QVeris SDK.

Each adapter exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as
native tools for a third-party agent framework, backed by a ``QverisClient``.
Adapters are optional and import their framework lazily, so the base ``qveris``
package never depends on them.

Available:
    - :mod:`qveris.integrations.langchain` — LangChain tools (``pip install qveris[langchain]``)
"""
