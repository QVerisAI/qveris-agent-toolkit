**@qverisai/sdk**

***

# TypeScript SDK API 参考

本页根据 package 公开导出和源码注释自动生成。安装、认证与完整工作流请参阅 TypeScript SDK 指南。

## 类

### Qveris

QVeris API client.

#### 示例

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });

const found = await qveris.discover('stock price market data API', { limit: 5 });
const tool = found.results[0];

const outcome = await qveris.call(tool.tool_id, {
  searchId: found.search_id,
  parameters: { symbol: 'AAPL' },
});
```

#### 构造函数

##### 构造函数

> **new Qveris**(`config`): [`Qveris`](#qveris)

###### 参数

###### config

[`QverisClientConfig`](#qverisclientconfig)

###### 返回

[`Qveris`](#qveris)

#### 访问器

##### rateLimitRetryCount

###### Getter 签名

> **get** **rateLimitRetryCount**(): `number`

How many times the client has backed off on a rate-limited (429) /
transient (503) response so far. Rate-limit backoff is retried pressure,
not failure — observe this rather than counting the retried responses.

###### 返回

`number`

#### 方法

##### call()

> **call**(`toolId`, `options`): `Promise`\<[`ExecuteResponse`](#executeresponse)\>

Call a capability. The response may include pre-settlement billing;
final charges are reflected in usage() and ledger().

###### 参数

###### toolId

`string`

###### options

[`CallOptions`](#calloptions)

###### 返回

`Promise`\<[`ExecuteResponse`](#executeresponse)\>

##### credits()

> **credits**(): `Promise`\<[`CreditsResponse`](#creditsresponse)\>

Get current credit balance and bucket details.

###### 返回

`Promise`\<[`CreditsResponse`](#creditsresponse)\>

##### discover()

> **discover**(`query`, `options?`): `Promise`\<[`SearchResponse`](#searchresponse)\>

Discover capabilities from a natural-language query. Free.

###### 参数

###### query

`string`

###### options?

[`DiscoverOptions`](#discoveroptions) = `{}`

###### 返回

`Promise`\<[`SearchResponse`](#searchresponse)\>

##### inspect()

> **inspect**(`toolIds`, `options?`): `Promise`\<[`SearchResponse`](#searchresponse)\>

Inspect capabilities by id to get current parameter schemas. Free.
An empty id list resolves locally without a network request.

###### 参数

###### toolIds

`string` \| `string`[]

###### options?

[`InspectOptions`](#inspectoptions) = `{}`

###### 返回

`Promise`\<[`SearchResponse`](#searchresponse)\>

##### ledger()

> **ledger**(`filters?`): `Promise`\<[`CreditsLedgerResponse`](#creditsledgerresponse)\>

Query final credits ledger entries.

###### 参数

###### filters?

[`CreditsLedgerRequest`](#creditsledgerrequest) = `{}`

###### 返回

`Promise`\<[`CreditsLedgerResponse`](#creditsledgerresponse)\>

##### usage()

> **usage**(`filters?`): `Promise`\<[`UsageEventsResponse`](#usageeventsresponse)\>

Query request-level usage audit history.

###### 参数

###### filters?

[`UsageHistoryRequest`](#usagehistoryrequest) = `{}`

###### 返回

`Promise`\<[`UsageEventsResponse`](#usageeventsresponse)\>

##### fromEnv()

> `static` **fromEnv**(`overrides?`): [`Qveris`](#qveris)

Create a client from the QVERIS_API_KEY environment variable.
An explicit baseUrl override takes priority over QVERIS_BASE_URL.

###### 参数

###### overrides?

`Omit`\<[`QverisClientConfig`](#qverisclientconfig), `"apiKey"`\>

###### 返回

[`Qveris`](#qveris)

***

### QverisApiError

Error thrown for any failed QVeris API interaction: HTTP errors,
failure envelopes, timeouts, and network failures.

Carries the same shape as the wire-level [ApiError](#apierror) so callers can
branch on `status` and inspect `observability` for diagnostics.

#### 继承

- `Error`

#### 实现

- [`ApiError`](#apierror)

#### 构造函数

##### 构造函数

> **new QverisApiError**(`error`): [`QverisApiError`](#qverisapierror)

###### 参数

###### error

[`ApiError`](#apierror)

###### 返回

[`QverisApiError`](#qverisapierror)

###### 重写了

`Error.constructor`

#### 属性

##### cause?

> `readonly` `optional` **cause?**: `string`

Lower-level transport or runtime cause when available

###### 实现了

[`ApiError`](#apierror).[`cause`](#cause-1)

###### 重写了

`Error.cause`

##### details?

> `readonly` `optional` **details?**: `unknown`

Original error details if available

###### 实现了

[`ApiError`](#apierror).[`details`](#details-1)

##### message

> **message**: `string`

Error message

###### 实现了

[`ApiError`](#apierror).[`message`](#message-2)

###### 继承自

`Error.message`

##### name

> **name**: `string`

###### 继承自

`Error.name`

##### observability?

> `readonly` `optional` **observability?**: [`ApiObservability`](#apiobservability)

Request metadata for diagnosing API failures

###### 实现了

[`ApiError`](#apierror).[`observability`](#observability-1)

##### stack?

> `optional` **stack?**: `string`

###### 继承自

`Error.stack`

##### status

> `readonly` **status**: `number`

HTTP status code (0 for network errors, 408 for timeouts)

###### 实现了

[`ApiError`](#apierror).[`status`](#status-2)

##### stackTraceLimit

> `static` **stackTraceLimit**: `number`

The `Error.stackTraceLimit` property specifies the number of stack frames
collected by a stack trace (whether generated by `new Error().stack` or
`Error.captureStackTrace(obj)`).

The default value is `10` but may be set to any valid JavaScript number. Changes
will affect any stack trace captured _after_ the value has been changed.

If set to a non-number value, or set to a negative number, stack traces will
not capture any frames.

###### 继承自

`Error.stackTraceLimit`

#### 方法

##### captureStackTrace()

> `static` **captureStackTrace**(`targetObject`, `constructorOpt?`): `void`

Creates a `.stack` property on `targetObject`, which when accessed returns
a string representing the location in the code at which
`Error.captureStackTrace()` was called.

```js
const myObject = {};
Error.captureStackTrace(myObject);
myObject.stack;  // Similar to `new Error().stack`
```

The first line of the trace will be prefixed with
`${myObject.name}: ${myObject.message}`.

The optional `constructorOpt` argument accepts a function. If given, all frames
above `constructorOpt`, including `constructorOpt`, will be omitted from the
generated stack trace.

The `constructorOpt` argument is useful for hiding implementation
details of error generation from the user. For instance:

```js
function a() {
  b();
}

function b() {
  c();
}

function c() {
  // Create an error without stack trace to avoid calculating the stack trace twice.
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  const error = new Error();
  Error.stackTraceLimit = stackTraceLimit;

  // Capture the stack trace above function b
  Error.captureStackTrace(error, b); // Neither function c, nor b is included in the stack trace
  throw error;
}

a();
```

###### 参数

###### targetObject

`object`

###### constructorOpt?

`Function`

###### 返回

`void`

###### 继承自

`Error.captureStackTrace`

##### prepareStackTrace()

> `static` **prepareStackTrace**(`err`, `stackTraces`): `any`

###### 参数

###### err

`Error`

###### stackTraces

`CallSite`[]

###### 返回

`any`

###### 参阅

https://v8.dev/docs/stack-trace-api#customizing-stack-traces

###### 继承自

`Error.prepareStackTrace`

## 接口

### ApiEnvelope

#### 类型参数

##### T

`T`

#### 属性

##### data

> **data**: `T`

##### message?

> `optional` **message?**: `string`

##### status

> **status**: `string`

##### status\_code?

> `optional` **status\_code?**: `number`

***

### ApiError

#### 属性

##### cause?

> `optional` **cause?**: `string`

Lower-level transport or runtime cause when available.

##### details?

> `optional` **details?**: `unknown`

Original error details if available

##### message

> **message**: `string`

Error message

##### observability?

> `optional` **observability?**: [`ApiObservability`](#apiobservability)

Request metadata for diagnosing API/provider/tool-chain failures.

##### status

> **status**: `number`

HTTP status code

***

### ApiObservability

#### 属性

##### endpoint

> **endpoint**: `string`

##### error\_type?

> `optional` **error\_type?**: [`ApiErrorType`](#apierrortype)

##### http\_status?

> `optional` **http\_status?**: `number`

##### method

> **method**: `"GET"` \| `"POST"`

##### operation

> **operation**: [`ApiOperation`](#apioperation)

##### query\_params?

> `optional` **query\_params?**: `Record`\<`string`, `string`\>

##### request\_id?

> `optional` **request\_id?**: `string`

##### source

> **source**: `"qveris_api"`

##### timeout\_ms

> **timeout\_ms**: `number`

##### url

> **url**: `string`

***

### BillingChargeLine

#### 属性

##### amount\_credits?

> `optional` **amount\_credits?**: `number` \| `null`

##### component\_key

> **component\_key**: `string`

##### description?

> `optional` **description?**: `string` \| `null`

##### is\_adjustment?

> `optional` **is\_adjustment?**: `boolean` \| `null`

##### price?

> `optional` **price?**: [`BillingPrice`](#billingprice) \| `null`

##### quantity?

> `optional` **quantity?**: `number` \| `null`

##### unit?

> `optional` **unit?**: `string` \| `null`

##### unit\_label?

> `optional` **unit\_label?**: `string` \| `null`

***

### BillingPrice

#### 属性

##### amount\_credits

> **amount\_credits**: `number`

##### per?

> `optional` **per?**: `number` \| `null`

##### unit?

> `optional` **unit?**: `string` \| `null`

##### unit\_label?

> `optional` **unit\_label?**: `string` \| `null`

***

### BillingRule

#### 属性

##### billing\_unit?

> `optional` **billing\_unit?**: `string`

##### billing\_unit\_label?

> `optional` **billing\_unit\_label?**: `string`

##### description?

> `optional` **description?**: `string`

##### metering\_mode?

> `optional` **metering\_mode?**: `string`

##### minimum\_charge\_credits?

> `optional` **minimum\_charge\_credits?**: `number` \| `null`

##### price?

> `optional` **price?**: [`BillingPrice`](#billingprice) \| `null`

##### price\_breakdown?

> `optional` **price\_breakdown?**: `Record`\<`string`, `unknown`\>[] \| `null`

##### pricing\_dimensions?

> `optional` **pricing\_dimensions?**: `Record`\<`string`, `unknown`\>[] \| `null`

##### pricing\_source\_system?

> `optional` **pricing\_source\_system?**: `string` \| `null`

##### runtime\_pricing\_version?

> `optional` **runtime\_pricing\_version?**: `string` \| `null`

##### snapshot\_id?

> `optional` **snapshot\_id?**: `number` \| `null`

##### snapshot\_version?

> `optional` **snapshot\_version?**: `string` \| `null`

***

### CallOptions

Options for [Qveris.call](#call).

#### 属性

##### maxResponseSize?

> `optional` **maxResponseSize?**: `number`

Max response bytes before truncation (-1 for no limit, server default 20480)

##### parameters

> **parameters**: `Record`\<`string`, `unknown`\>

Key-value parameters matching the tool's parameter schema

##### searchId?

> `optional` **searchId?**: `string`

The search_id from the discover call that returned this tool

##### sessionId?

> `optional` **sessionId?**: `string`

Session identifier for tracking

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-request timeout override in milliseconds (default 120s)

***

### CompactBillingStatement

#### 属性

##### charge\_lines?

> `optional` **charge\_lines?**: [`BillingChargeLine`](#billingchargeline)[] \| `null`

##### list\_amount\_credits?

> `optional` **list\_amount\_credits?**: `number` \| `null`

##### minimum\_charge\_credits?

> `optional` **minimum\_charge\_credits?**: `number` \| `null`

##### price?

> `optional` **price?**: [`BillingPrice`](#billingprice) \| `null`

##### quantity?

> `optional` **quantity?**: `number` \| `null`

##### requested\_amount\_credits?

> `optional` **requested\_amount\_credits?**: `number` \| `null`

##### summary?

> `optional` **summary?**: `string` \| `null`

***

### CreditsLedgerItem

#### 属性

##### amount\_credits

> **amount\_credits**: `number`

##### balance\_after?

> `optional` **balance\_after?**: `Record`\<`string`, `unknown`\> \| `null`

##### balance\_before?

> `optional` **balance\_before?**: `Record`\<`string`, `unknown`\> \| `null`

##### created\_at

> **created\_at**: `string`

##### description?

> `optional` **description?**: `string` \| `null`

##### entry\_type

> **entry\_type**: `string`

##### id

> **id**: `string`

##### ledger\_metadata?

> `optional` **ledger\_metadata?**: `Record`\<`string`, `unknown`\> \| `null`

##### pre\_settlement\_bill?

> `optional` **pre\_settlement\_bill?**: `Record`\<`string`, `unknown`\> \| `null`

##### settlement\_result?

> `optional` **settlement\_result?**: `Record`\<`string`, `unknown`\> \| `null`

##### source\_ref\_id?

> `optional` **source\_ref\_id?**: `string` \| `null`

##### source\_ref\_type?

> `optional` **source\_ref\_type?**: `string` \| `null`

##### source\_system

> **source\_system**: `string`

***

### CreditsLedgerRequest

#### 属性

##### bucket?

> `optional` **bucket?**: `string`

##### direction?

> `optional` **direction?**: `string`

##### end\_date?

> `optional` **end\_date?**: `string`

##### entry\_type?

> `optional` **entry\_type?**: `string`

##### limit?

> `optional` **limit?**: `number`

##### max\_credits?

> `optional` **max\_credits?**: `number`

##### min\_credits?

> `optional` **min\_credits?**: `number`

##### page?

> `optional` **page?**: `number`

##### page\_size?

> `optional` **page\_size?**: `number`

##### start\_date?

> `optional` **start\_date?**: `string`

##### summary?

> `optional` **summary?**: `boolean`

***

### CreditsLedgerResponse

#### 属性

##### items

> **items**: [`CreditsLedgerItem`](#creditsledgeritem)[]

##### page

> **page**: `number`

##### page\_size

> **page\_size**: `number`

##### summary?

> `optional` **summary?**: `Record`\<`string`, `unknown`\> \| `null`

##### total

> **total**: `number`

***

### CreditsResponse

#### 属性

##### daily\_free?

> `optional` **daily\_free?**: `Record`\<`string`, `unknown`\>

##### invite\_reward?

> `optional` **invite\_reward?**: `Record`\<`string`, `unknown`\>

##### purchased?

> `optional` **purchased?**: `Record`\<`string`, `unknown`\>

##### remaining\_credits

> **remaining\_credits**: `number`

##### welcome\_bonus?

> `optional` **welcome\_bonus?**: `Record`\<`string`, `unknown`\>

***

### DiscoverOptions

Options for [Qveris.discover](#discover).

#### 属性

##### limit?

> `optional` **limit?**: `number`

Maximum number of results (1-100, server default 20)

##### sessionId?

> `optional` **sessionId?**: `string`

Session identifier for tracking

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-request timeout override in milliseconds

***

### ExecuteRequest

Request body for the Execute Tool API.

#### 属性

##### max\_response\_size?

> `optional` **max\_response\_size?**: `number`

Maximum size of response data in bytes.
If the tool generates data longer than this, it will be truncated
and a download URL will be provided for the full content.
Minimum: -1 (`-1` means no limit).

###### 默认值

```ts
20480 (20KB)
```

##### parameters

> **parameters**: `Record`\<`string`, `unknown`\>

Key-value pairs of parameters to pass to the tool.
Must match the parameter schema from the tool's definition.

##### search\_id

> **search\_id**: `string`

The search_id from the search that returned this tool.
Links the execution to the original search for analytics and billing.

##### session\_id?

> `optional` **session\_id?**: `string`

Session identifier for tracking user sessions.

***

### ExecuteResponse

Response from the Execute Tool API.

#### 属性

##### billing?

> `optional` **billing?**: [`CompactBillingStatement`](#compactbillingstatement)

Structured pre-settlement billing statement when available

##### cost?

> `optional` **cost?**: `number`

Legacy fallback estimate; use usage audit or credits ledger for final charge

##### created\_at?

> `optional` **created\_at?**: `string`

Timestamp of execution (ISO 8601 format)

##### elapsed\_time\_ms?

> `optional` **elapsed\_time\_ms?**: `number`

Execution duration in milliseconds (alternative field)

##### error\_message?

> `optional` **error\_message?**: `string` \| `null`

Error message if execution failed.
Common reasons: insufficient balance, quota exceeded, invalid parameters.

##### execution\_id

> **execution\_id**: `string`

Unique identifier for this execution record

##### execution\_time?

> `optional` **execution\_time?**: `number`

Execution duration in seconds

##### parameters

> **parameters**: `Record`\<`string`, `unknown`\>

The parameters that were passed to the tool

##### pre\_settlement\_bill?

> `optional` **pre\_settlement\_bill?**: `Record`\<`string`, `unknown`\>

Legacy/full pre-settlement bill snapshot when returned directly

##### remaining\_credits?

> `optional` **remaining\_credits?**: `number`

User's remaining credits after this execution

##### result?

> `optional` **result?**: [`ExecuteResult`](#executeresult)

The execution result.
Contains either `data` (if within size limit) or truncation info.

##### success

> **success**: `boolean`

Whether the execution completed successfully

##### tool\_id

> **tool\_id**: `string`

The tool that was executed

***

### ExecuteResultData

Result data when the response fits within max_response_size.

#### 属性

##### data

> **data**: `unknown`

The actual result data from the tool execution

***

### ExecuteResultTruncated

Result data when the response exceeds max_response_size.
Provides truncated content and a URL to download the full result.

#### 属性

##### content\_schema?

> `optional` **content\_schema?**: `Record`\<`string`, `unknown`\>

JSON Schema describing the structure of the full content.
Helps the agent understand the data shape without downloading.

##### full\_content\_file\_url

> **full\_content\_file\_url**: `string`

URL to download the complete result file.
Valid for 120 minutes.

##### message

> **message**: `string`

Explanation message about the truncation

##### truncated\_content

> **truncated\_content**: `string`

The initial portion of the response (max_response_size bytes).
Useful for previewing the data structure.

***

### GetToolsByIdsRequest

Request body for the Get Tools by IDs API.

#### 属性

##### search\_id?

> `optional` **search\_id?**: `string`

The search_id from the search that returned the tool(s).

##### session\_id?

> `optional` **session\_id?**: `string`

Session identifier for tracking user sessions.

##### tool\_ids

> **tool\_ids**: `string`[]

Array of tool IDs to retrieve information for.

***

### InspectOptions

Options for [Qveris.inspect](#inspect).

#### 属性

##### searchId?

> `optional` **searchId?**: `string`

The search_id from the discover call that returned the tool(s)

##### sessionId?

> `optional` **sessionId?**: `string`

Session identifier for tracking

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-request timeout override in milliseconds

***

### QverisClientConfig

Configuration options for the Qveris API client.

#### 属性

##### apiKey

> **apiKey**: `string`

API authentication token

##### baseUrl?

> `optional` **baseUrl?**: `string`

API base URL. Overrides QVERIS_BASE_URL and the built-in default.

##### maxRetries?

> `optional` **maxRetries?**: `number`

Max automatic retries for rate-limited (429) / transient (503) responses.
Honors `Retry-After`, otherwise backs off exponentially with jitter.
Defaults to 3; set to 0 to disable.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Default request timeout in milliseconds

***

### SearchRequest

Request body for the Search Tools API.

#### 属性

##### limit?

> `optional` **limit?**: `number`

Maximum number of results to return.
Minimum: 1. Maximum: 100.

###### 默认值

```ts
20
```

##### query

> **query**: `string`

Natural language search query describing the tool capability you need.

##### session\_id?

> `optional` **session\_id?**: `string`

Session identifier for tracking user sessions.

***

### SearchResponse

Response from the Search Tools API.

#### 属性

##### elapsed\_time\_ms?

> `optional` **elapsed\_time\_ms?**: `number`

Total elapsed time in milliseconds

##### query?

> `optional` **query?**: `string`

The original search query

##### remaining\_credits?

> `optional` **remaining\_credits?**: `number`

User's remaining credits after this operation

##### results

> **results**: [`ToolInfo`](#toolinfo)[]

Array of matching tools

##### search\_id

> **search\_id**: `string`

Unique identifier for this search.
Required when calling call for any tool from these results.

##### stats?

> `optional` **stats?**: [`SearchStats`](#searchstats)

Search performance statistics

##### total?

> `optional` **total?**: `number`

Total number of results returned

***

### SearchStats

Performance statistics for a search operation.

#### 属性

##### fulltext\_recall\_count?

> `optional` **fulltext\_recall\_count?**: `number`

Fulltext recall count

##### search\_time\_ms?

> `optional` **search\_time\_ms?**: `number`

Total time to complete the search in milliseconds

##### vector\_recall\_count?

> `optional` **vector\_recall\_count?**: `number`

Vector recall count

***

### ToolCapability

Standardized capability descriptor attached to a tool
(e.g. "MKT.BARS.ADJUSTED" with market coverage tags).

#### 属性

##### id?

> `optional` **id?**: `string`

##### tag?

> `optional` **tag?**: [`ToolCapabilityTag`](#toolcapabilitytag-1)[]

***

### ToolCapabilityTag

Coverage tag attached to a capability (e.g. market coverage).

#### 属性

##### description?

> `optional` **description?**: `string`

##### id?

> `optional` **id?**: `string`

##### name?

> `optional` **name?**: `string`

##### type?

> `optional` **type?**: `string`

***

### ToolCategory

Category/tag attached to a tool.
Current API responses return category objects; legacy responses returned
plain strings, so `ToolInfo.categories` accepts both.

#### 属性

##### description?

> `optional` **description?**: `string`

##### name?

> `optional` **name?**: `string`

##### slug?

> `optional` **slug?**: `string`

***

### ToolExamples

Example usage for a tool, showing sample parameters.

#### 属性

##### sample\_parameters?

> `optional` **sample\_parameters?**: `Record`\<`string`, `unknown`\>

Sample parameter values demonstrating typical usage

***

### ToolInfo

Information about a tool returned from search results.
Contains everything needed to understand and execute the tool.

#### 属性

##### billing\_rule?

> `optional` **billing\_rule?**: [`BillingRule`](#billingrule)

Structured rule-level billing metadata when available

##### capabilities?

> `optional` **capabilities?**: [`ToolCapability`](#toolcapability)[]

Standardized capability descriptors with coverage tags

##### categories?

> `optional` **categories?**: (`string` \| [`ToolCategory`](#toolcategory))[]

Tool categories/tags: category objects, or plain strings in legacy responses

##### description

> **description**: `string`

Detailed description of what the tool does

##### docs\_url?

> `optional` **docs\_url?**: `string`

Documentation URL for the tool

##### examples?

> `optional` **examples?**: [`ToolExamples`](#toolexamples)

Usage examples with sample parameters

##### expected\_cost?

> `optional` **expected\_cost?**: `string` \| `number`

Pre-call cost estimate in credits, when available

##### final\_score?

> `optional` **final\_score?**: `number`

Relevance score for the search query (0.0 - 1.0, higher = better match)

##### has\_last\_execution?

> `optional` **has\_last\_execution?**: `boolean`

Whether this tool has been executed before (verified in production)

##### last\_execution\_record?

> `optional` **last\_execution\_record?**: `Record`\<`string`, `unknown`\>

Most recent execution record, if available

##### name

> **name**: `string`

Human-readable display name

##### params?

> `optional` **params?**: [`ToolParameter`](#toolparameter)[]

List of parameters the tool accepts

##### protocol?

> `optional` **protocol?**: `string`

Protocol type

##### provider\_description?

> `optional` **provider\_description?**: `string`

Description of the provider

##### provider\_id?

> `optional` **provider\_id?**: `string`

Provider identifier

##### provider\_name?

> `optional` **provider\_name?**: `string`

Name of the organization/service providing this tool

##### provider\_website\_url?

> `optional` **provider\_website\_url?**: `string`

Provider website URL

##### region?

> `optional` **region?**: `string`

Geographic availability of the tool.
- "global" - Available worldwide
- "US|CA" - Whitelist: only available in US and Canada
- "-CN|RU" - Blacklist: not available in China and Russia

##### stats?

> `optional` **stats?**: [`ToolStats`](#toolstats)

Historical execution performance statistics

##### tool\_id

> **tool\_id**: `string`

Unique identifier for the tool (used in call)

##### why\_recommended?

> `optional` **why\_recommended?**: `string`

Human-readable explanation of why this tool was recommended (Discover results only)

***

### ToolParameter

Parameter definition for a tool.

#### 属性

##### description

> **description**: `string`

Human-readable description of what this parameter does

##### enum?

> `optional` **enum?**: `string`[]

If present, restricts valid values to this list

##### name

> **name**: `string`

Parameter name (used as key in the parameters object)

##### required

> **required**: `boolean`

Whether this parameter must be provided

##### type

> **type**: `"string"` \| `"number"` \| `"boolean"` \| `"object"` \| `"array"`

Data type of the parameter

***

### ToolStats

Historical execution performance statistics for a tool.

#### 属性

##### avg\_execution\_time\_ms?

> `optional` **avg\_execution\_time\_ms?**: `number`

Historical average execution time in milliseconds

##### cost?

> `optional` **cost?**: `number`

Legacy fallback estimate in credits per call

##### success\_rate?

> `optional` **success\_rate?**: `number`

Historical success rate (0.0 - 1.0)

***

### UsageEventItem

#### 属性

##### actual\_amount\_credits?

> `optional` **actual\_amount\_credits?**: `number` \| `null`

##### billing\_snapshot\_status?

> `optional` **billing\_snapshot\_status?**: `string` \| `null`

##### billing\_summary?

> `optional` **billing\_summary?**: `string` \| `null`

##### charge\_outcome?

> `optional` **charge\_outcome?**: `string` \| `null`

##### created\_at

> **created\_at**: `string`

##### credits\_ledger\_entry\_id?

> `optional` **credits\_ledger\_entry\_id?**: `string` \| `null`

##### display\_target?

> `optional` **display\_target?**: `string` \| `null`

##### error\_message?

> `optional` **error\_message?**: `string` \| `null`

##### event\_type

> **event\_type**: `string`

##### execution\_id?

> `optional` **execution\_id?**: `string` \| `null`

##### id

> **id**: `string`

##### kind?

> `optional` **kind?**: `string` \| `null`

##### model?

> `optional` **model?**: `string` \| `null`

##### pre\_settlement\_amount\_credits?

> `optional` **pre\_settlement\_amount\_credits?**: `number` \| `null`

##### pre\_settlement\_bill?

> `optional` **pre\_settlement\_bill?**: `Record`\<`string`, `unknown`\> \| `null`

##### query?

> `optional` **query?**: `string` \| `null`

##### requested\_amount\_credits?

> `optional` **requested\_amount\_credits?**: `number` \| `null`

##### search\_id?

> `optional` **search\_id?**: `string` \| `null`

##### session\_id?

> `optional` **session\_id?**: `string` \| `null`

##### settled\_amount\_credits?

> `optional` **settled\_amount\_credits?**: `number` \| `null`

##### settlement\_result?

> `optional` **settlement\_result?**: `Record`\<`string`, `unknown`\> \| `null`

##### source\_ref\_id?

> `optional` **source\_ref\_id?**: `string` \| `null`

##### source\_ref\_type?

> `optional` **source\_ref\_type?**: `string` \| `null`

##### source\_system

> **source\_system**: `string`

##### success

> **success**: `boolean`

##### tool\_id?

> `optional` **tool\_id?**: `string` \| `null`

***

### UsageEventsResponse

#### 属性

##### items

> **items**: [`UsageEventItem`](#usageeventitem)[]

##### page

> **page**: `number`

##### page\_size

> **page\_size**: `number`

##### summary?

> `optional` **summary?**: `Record`\<`string`, `unknown`\> \| `null`

##### total

> **total**: `number`

***

### UsageHistoryRequest

#### 属性

##### bucket?

> `optional` **bucket?**: `string`

##### charge\_outcome?

> `optional` **charge\_outcome?**: `string`

##### end\_date?

> `optional` **end\_date?**: `string`

##### event\_type?

> `optional` **event\_type?**: `string`

##### execution\_id?

> `optional` **execution\_id?**: `string`

##### kind?

> `optional` **kind?**: `string`

##### limit?

> `optional` **limit?**: `number`

##### max\_credits?

> `optional` **max\_credits?**: `number`

##### min\_credits?

> `optional` **min\_credits?**: `number`

##### page?

> `optional` **page?**: `number`

##### page\_size?

> `optional` **page\_size?**: `number`

##### search\_id?

> `optional` **search\_id?**: `string`

##### start\_date?

> `optional` **start\_date?**: `string`

##### success?

> `optional` **success?**: `boolean`

##### summary?

> `optional` **summary?**: `boolean`

## 类型别名

### ApiErrorType

> **ApiErrorType** = `"http_error"` \| `"invalid_json"` \| `"timeout"` \| `"network_error"`

***

### ApiOperation

> **ApiOperation** = `"discover"` \| `"inspect"` \| `"call"` \| `"credits"` \| `"usage_history"` \| `"credits_ledger"`

Error response from the Qveris API.

***

### ExecuteResult

> **ExecuteResult** = [`ExecuteResultData`](#executeresultdata) \| [`ExecuteResultTruncated`](#executeresulttruncated)

Union type for execution results (either full data or truncated).

## 函数

### getQverisTools()

> **getQverisTools**(`qveris`, `options?`): `object`

Build Vercel AI SDK tools for the QVeris discover/inspect/call workflow.

#### 参数

##### qveris

[`Qveris`](#qveris)

The Qveris client to route calls through.

##### options?

Optional `sessionId` for correlation/pricing context.

###### sessionId?

`string`

#### 返回

`object`

A tools object keyed by `qveris_discover` / `qveris_inspect` /
  `qveris_call`, ready to pass to `generateText`/`streamText`.

##### qveris\_call

> **qveris\_call**: `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never`

##### qveris\_discover

> **qveris\_discover**: `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never`

##### qveris\_inspect

> **qveris\_inspect**: `never` \| `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object` \| `never` \| `object` & `object` & `object` & `object` & `object`
