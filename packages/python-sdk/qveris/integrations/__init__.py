"""Framework adapters for the QVeris SDK.

Each adapter exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as
native tools for a third-party agent framework, backed by a ``QverisClient``.
Adapters are optional and import their framework lazily, so the base ``qveris``
package never depends on them.

Available:
    - :mod:`qveris.integrations.langchain` — LangChain tools (``pip install "qveris[langchain]"``)
    - :mod:`qveris.integrations.openai_agents` — OpenAI Agents SDK tools (``pip install "qveris[openai-agents]"``)
    - :mod:`qveris.integrations.crewai` — CrewAI tools (``pip install "qveris[crewai]"``)
    - :mod:`qveris.integrations.autogen` — AutoGen tools (``pip install "qveris[autogen]"``)
    - :mod:`qveris.integrations.llamaindex` — LlamaIndex tools (``pip install "qveris[llamaindex]"``)
    - :mod:`qveris.integrations.pydantic_ai` — Pydantic AI tools (``pip install "qveris[pydantic-ai]"``)
"""
