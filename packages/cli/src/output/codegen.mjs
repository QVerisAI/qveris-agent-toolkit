import { resolve } from "../config/resolve.mjs";

export function generateSnippet(lang, { toolId, discoveryId, parameters, maxResponseSize = 20480 }) {
  const baseUrl = resolve("base_url").value;

  switch (lang) {
    case "curl":
      return generateCurl({ baseUrl, toolId, discoveryId, parameters, maxResponseSize });
    case "js":
    case "javascript":
      return generateJs({ baseUrl, toolId, discoveryId, parameters, maxResponseSize });
    case "python":
    case "py":
      return generatePython({ baseUrl, toolId, discoveryId, parameters, maxResponseSize });
    default:
      return `Unsupported language: ${lang}. Use: curl, js, python`;
  }
}

function generateCurl({ baseUrl, toolId, discoveryId, parameters, maxResponseSize }) {
  const body = JSON.stringify({
    search_id: discoveryId,
    parameters,
    max_response_size: maxResponseSize,
  }, null, 2);

  // Use heredoc to avoid single-quote escaping issues in parameters
  return `curl -sS -X POST "${baseUrl}/tools/execute?tool_id=${toolId}" \\
  -H "Authorization: Bearer $QVERIS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
${body}
EOF`;
}

function generateJs({ baseUrl, toolId, discoveryId, parameters, maxResponseSize }) {
  const paramsStr = JSON.stringify(parameters, null, 4);
  return `const resp = await fetch(
  "${baseUrl}/tools/execute?tool_id=${toolId}",
  {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.QVERIS_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      search_id: "${discoveryId}",
      parameters: ${paramsStr},
      max_response_size: ${maxResponseSize},
    }),
  }
);
const data = await resp.json();
console.log(data);`;
}

function generatePython({ baseUrl, toolId, discoveryId, parameters, maxResponseSize }) {
  const paramsStr = JSON.stringify(parameters, null, 8);
  return `import os
import requests

resp = requests.post(
    "${baseUrl}/tools/execute",
    params={"tool_id": "${toolId}"},
    headers={"Authorization": f"Bearer {os.environ['QVERIS_API_KEY']}"},
    json={
        "search_id": "${discoveryId}",
        "parameters": ${paramsStr},
        "max_response_size": ${maxResponseSize},
    },
    timeout=60,
)
data = resp.json()
print(data)`;
}
