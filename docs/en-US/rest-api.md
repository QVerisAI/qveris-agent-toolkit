# QVeris REST API Documentation

Version: 0.1.9

QVeris exposes three core actions via REST API:

| Protocol action | API endpoint | Description |
|----------------|-------------|-------------|
| **Discover** | `POST /search` | Find capabilities with natural language (free) |
| **Inspect** | `POST /tools/by-ids` | Get capability details by ID |
| **Call** | `POST /tools/execute` | Invoke a capability (1–100 credits) |

## Authentication

All API requests require authentication via Bearer in the Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

Get your API KEY from https://qveris.ai

## Base URL

```
https://qveris.ai/api/v1
```

All endpoints described in this document are relative to this base URL.

## API Endpoints

### 1. Discover — Search Tools

Search for capabilities based on natural language queries. This is the Discover action and is **free**.

#### Endpoint

```
POST /search
```

#### Request Headers

| Header | Required | Description |
| --- | --- | --- |
| Authorization | Yes | Bearer token for authentication |
| Content-Type | Yes | Must be application/json |

#### Request Body

```json
{
  "query": "string",
  "limit": 10,
  "session_id": "string"
}
```

#### Parameters

| Field | Type | Required | Description | Default | Range |
| --- | --- | --- | --- | --- | --- |
| query | string | Yes | Natural language search query | - | - |
| session_id | string | No | Same id corresponds to the same user session | - | - |
| limit | integer | No | Maximum number of results to return | 20 | 1-100 |

#### Response

Status Code: 200 OK

```json
{
  "search_id": "string",
  "total": 3,
  "results": [
    {
      "tool_id": "openweathermap.weather.execute.v1",
      "name": "Current Weather",
      "description": "Get current weather data for any location",
      "provider_name": "OpenWeatherMap",
      "provider_description": "Global weather data provider",
      "region": "global",
      "params": [
        {
          "name": "city",
          "type": "string",
          "required": true,
          "description": "City name"
        },
        {
          "name": "units",
          "type": "string",
          "required": false,
          "description": "Temperature units (metric/imperial)",
          "enum": ["metric", "imperial", "standard"]
        }
      ],
      "examples": {
        "sample_parameters": {
          "city": "London",
          "units": "metric"
        }
      },
      "stats": {
          "avg_execution_time_ms": 21.74,
          "success_rate": 0.909
      }
    }
  ],
  "elapsed_time_ms": 245.6
}
```

#### Response Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| query | string | No | Original search query |
| search_id | string | Yes | Id for this search. Used in following tool executions. |
| user_id | string | No | Original search user id |
| total | integer | Yes | Total number of results |

#### Tool Information Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| tool_id | string | Yes | Unique identifier for the tool |
| name | string | Yes | Display name of the tool |
| description | string | Yes | Detailed description of tool functionality |
| provider_name | string | No | Name of the tool provider |
| provider_description | string | No | Description of the provider |
| region | string | No | Region of the tool. "global" for global tools, "\|" separated whitelist (e.g. "US\|CA") or blacklist (e.g. "-CN\|RU") of country codes for regional tools |
| params | array | No | Array of parameter definitions |
| examples | object | No | Usage examples |
| stats | object | No | Historical execution performance statistics |

---

### 2. Inspect — Get Tools by ID

Get detailed descriptions of capabilities based on tool_id. This is the Inspect action.

#### Endpoint

```
POST /tools/by-ids
```

#### Request Headers

| Header | Required | Description |
| --- | --- | --- |
| Authorization | Yes | Bearer token for authentication |
| Content-Type | Yes | Must be application/json |

#### Request Body

```json
{
  "tool_ids": ["string1", "string2", "..."],
  "search_id": "string",
  "session_id": "string"
}
```

#### Parameters

| Field | Type | Required | Description | Default | Range |
| --- | --- | --- | --- | --- | --- |
| tool_ids | list of strings | Yes | Ids of tools to query | - | - |
| session_id | string | No | Same id corresponds to the same user session | - | - |
| search_id | string | No | Id for the search that returned the tool(s). | - | - |

#### Response

Status Code: 200 OK

Same schema as the response of `/search`

---

### 3. Call — Execute Tool

Invoke a capability with specified parameters. This is the Call action and costs **1–100 credits** per call, priced by data and task value.

#### Endpoint

```
POST /tools/execute?tool_id={tool_id}
```

#### Request Headers

| Header | Required | Description |
| --- | --- | --- |
| Authorization | Yes | Bearer token for authentication |
| Content-Type | Yes | Must be application/json |

#### URL Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| tool_id | string | Yes | Unique identifier of the tool to execute |

#### Request Body

```json
{
  "search_id": "string",
  "session_id": "string",
  "parameters": {
    "city": "London",
    "units": "metric"
  },
  "max_response_size": 20480
}
```

#### Parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| search_id | string | Yes | Id for the search that returned this tool. |
| session_id | string | No | Same id corresponds to the same user session. |
| parameters | object | Yes | Key-value pairs of tool parameters. Value can be object. |
| max_response_size | integer | No | If the tool generates data longer than max_response_size bytes, truncate to avoid big LLM token cost. -1 means no limit. Default is 20480 (20K). See details below. |

#### Response

Status Code: 200 OK

```json
{
  "execution_id": "string",
  "result": {
    "data": {
      "temperature": 15.5,
      "humidity": 72,
      "description": "partly cloudy",
      "wind_speed": 12.5
    }
  },
  "success": true,
  "error_message": null,
  "elapsed_time_ms": 210.72,
  "cost": 5.0
}
```

#### Response Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| execution_id | string | Yes | Unique identifier for this execution |
| result | object | Yes | Tool execution result |
| success | boolean | Yes | Whether the execution was successful |
| error_message | string | No | Error message if execution failed |
| elapsed_time_ms | number | No | Execution time in milliseconds |
| cost | number | No | cost deducted from account |

If the call to the third-party service fails due to reasons such as insufficient balance, quota exceeded, or other issues, success will be false, and error_message will contain detailed information about the failure.

#### Result Fields for Long Tool Response

If the tool generates data longer than max_response_size bytes, result will have no data field but the fields below.

```json
{
  "result": {
    "message": "Result content is too long (3210 bytes). You can reference the truncated content (200 bytes) and download the full content from the url provided.",
    "full_content_file_url": "http://qveris-tool-results-cache-bj.oss-cn-beijing.aliyuncs.com/tool_result_cache%2F20260120%2Fpubmed_refined.search_articles.v1%2F2409f329c07949a295b5ab0b704883ca.json?OSSAccessKeyId=LTAI5tM3qNRZSgSrg1iSTALm&Expires=1768920673&Signature=ThkQxoa9ryYHn%2F6XbVloiegS5ss%3D",
    "truncated_content": "{\"query\": \"evolution\", \"sort\": \"relevance\", \"total_results\": 890994, \"returned\": 10, \"articles\": [{\"pmid\": \"34099656\", \"title\": \"Towards an engineering theory of evolution.\", \"journal\": \"Nature commun",
    "content_schema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string"
        },
        "sort": {
          "type": "string"
        },
        "total_results": {
          "type": "number"
        },
        "returned": {
          "type": "number"
        },
        "articles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "pmid": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "journal": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| truncated_content | string | No | The initial max_response_size bytes of tool response. |
| full_content_file_url | string | No | The url to the file that contains the full content. Valid for 120min. |
| message | string | No | Message to LLM about the truncation. |
| content_schema | object | No | The JSON schema of the full content. |

---

## Data Models

### Tool Parameter Schema

Each tool parameter follows this schema:

```json
{
  "name": "string",
  "type": "string|number|boolean|array|object",
  "required": true,
  "description": "string",
  "enum": ["option1", "option2"]
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| name | string | Yes | Parameter name |
| type | string | Yes | Data type (string, number, boolean, array, object) |
| required | boolean | Yes | Whether parameter is required |
| description | string | Yes | Parameter description |
| enum | array | No | Valid values (if applicable) |

### Tool Historical execution performance statistics in search results

```json
{
  "avg_execution_time_ms": 8564.43,
  "success_rate": 0.748
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| avg_execution_time_ms | number | No | Historical average execution time of the tool |
| success_rate | number | No | Historical success rate of the tool |

---

## LLM/Agent Use Examples

For LLM/agent tool use scenario, below are example code snippets to encapsulate QVeris AI REST API calls into tools that can be invoked by large language models:

```typescript
export async function searchTools(
  query: string,
  sessionId: string,
  limit: number = 20
): Promise<SearchResponse> {
  const response = await api.post<SearchResponse>('/search', {
    query,
    limit,
    session_id: sessionId,
  })
  return response.data
}

export async function executeTool(
  toolId: string,
  searchId: string,
  sessionId: string,
  parameters: object
): Promise<ToolExecutionResponse> {
  const response = await api.post<ToolExecutionResponse>(
    `/tools/execute?tool_id=${toolId}`,
    {
      search_id: searchId,
      session_id: sessionId,
      parameters,
    }
  )
  return response.data
}

export const qverisApi = {
  searchTools,
  executeTool,
}

// Execute tool function
async function executeTool(name: string, args: Record<string, unknown>) {
  console.log(`[Tool] Executing ${name} with:`, args)

  if (name === 'search_tools') {
    const result = await qverisApi.searchTools(
      args.query as string,
      args.session_id as string,
      20
    )
    return result
  } else if (name === 'execute_tool') {
    let parsedParams: Record<string, unknown>
    try {
      parsedParams = JSON.parse(args.params_to_tool as string) as
        Record<string, unknown>
    } catch (parseError) {
      throw new Error(
        `Invalid JSON in params_to_tool: ${
          parseError instanceof Error
            ? parseError.message
            : 'Unknown parse error'
        }`
      )
    }

    const result = await qverisApi.executeTool(
      args.tool_id as string,
      args.search_id as string,
      args.session_id as string,
      parsedParams
    )
    return result
  }

  throw new Error(`Unknown tool: ${name}`)
}
```

Below are example declarations for the encapsulated search and execute tools. Just add them to chat completion tool list.

```javascript
{
  type: 'function',
  function: {
    name: 'search_tools',
    description:
      'Search for available tools. Returns relevant tools that can help accomplish tasks.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query describing the general capability of the tool. Not specific params you want to pass to the tool later.',
        },
        session_id: {
          type: 'string',
          description: 'The uuid of the user session. Should be changed only if new session.'
        },
      },
      required: ['query'],
    },
  },
},
{
  type: 'function',
  function: {
    name: 'execute_tool',
    description:
      'Execute a specific remote tool with provided parameters. The tool_id must come from a previous search_tools call; The params_to_tool is where the params can be passed.',
    parameters: {
      type: 'object',
      properties: {
        tool_id: {
          type: 'string',
          description: 'The ID of the remote tool to execute (from search results)',
        },
        search_id: {
          type: 'string',
          description: 'The search_id in the response of the search_tools call that returned the information of this remote tool',
        },
        session_id: {
          type: 'string',
          description: 'The uuid of the user session. Should be changed only if new session.'
        },
        params_to_tool: {
          type: 'string',
          description: 'An JSON stringified dictionary of parameters to pass to the remote tool, where keys are param names and values can be of any type, used to pass multiple arguments to the tool. For example: { "param1": "value1", "param2": 42, "param3": { "nestedKey": "nestedValue" } }',
        },
        max_response_size: {
          type: 'integer',
          description: 'If tool generates data longer than max_response_size (in bytes), do not return the full data to avoid big LLM token cost. Default value is 20480.',
        },
      },
      required: ['tool_id', 'search_id', 'params_to_tool'],
    },
  },
}
```

You can then use below system prompt and start testing! Have fun exploring!

```javascript
{
  role: 'system',
  content: 'You are a helpful assistant that can dynamically discover and call capabilities to help the user. First think about what kind of capabilities might be useful to accomplish the user\'s task. Then use the search_tools tool with a query describing the capability, not the specific parameters you will pass later. Then call suitable capabilities using the execute_tool tool, passing parameters through params_to_tool. If a capability has success_rate and avg_execution_time (in seconds), consider them when selecting which to call. You can reference the examples given for each capability. You can make multiple tool calls in a single response.',
}

```

