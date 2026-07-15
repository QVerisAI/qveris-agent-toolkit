Python SDK API 参考
========================

本页根据 Python SDK 的公开对象与 docstring 自动生成。安装、认证与完整工作流请参阅 Python SDK 指南。

客户端
------

.. autoclass:: qveris.QverisClient
   :members:

Agent
-----

.. autoclass:: qveris.Agent
   :members:

.. autoclass:: qveris.BudgetTracker
   :members:

配置
----

.. autoclass:: qveris.QverisConfig()
   :members:
   :exclude-members: model_config, settings_customise_sources

.. autoclass:: qveris.AgentConfig()
   :members:
   :exclude-members: model_config, settings_customise_sources

响应模型
--------

.. autoclass:: qveris.CompactBillingStatement
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.CreditsLedgerItem
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.CreditsLedgerResponse
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.Message
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.SearchResponse
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.StreamEvent
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.ToolCapability
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.ToolCapabilityTag
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.ToolCategory
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.ToolExecutionResponse
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.ToolInfo
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.ToolParameter
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.UsageEventItem
   :members:
   :exclude-members: model_config

.. autoclass:: qveris.UsageHistoryResponse
   :members:
   :exclude-members: model_config
