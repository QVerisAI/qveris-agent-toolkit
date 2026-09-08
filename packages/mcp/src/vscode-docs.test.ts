import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const guides = [
  {
    path: 'docs/en-US/mcp-server.md',
    heading: '##### Hosted MCP configuration',
    endpoint: 'https://mcp.qveris.ai/mcp',
  },
  {
    path: 'docs/zh-CN/mcp-server.md',
    heading: '##### 托管 MCP 配置',
    endpoint: 'https://mcp.qveris.ai/mcp',
  },
  {
    path: 'docs/cn/zh-CN/mcp-server.md',
    heading: '##### 托管 MCP 配置',
    endpoint: 'https://mcp.qveris.cn/mcp',
  },
] as const;

function readSection(path: string, heading: string): string {
  const guide = readFileSync(join(process.cwd(), '..', '..', path), 'utf8');
  const start = guide.indexOf(heading);
  expect(start, `${path} is missing ${heading}`).toBeGreaterThanOrEqual(0);

  const nextHeading = guide.indexOf('\n##### ', start + heading.length);
  return guide.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

describe('VS Code MCP guide', () => {
  it.each(guides)('keeps OAuth and API-key fallback examples valid in $path', ({ path, heading, endpoint }) => {
    const section = readSection(path, heading);

    expect(section).toContain(endpoint);
    expect(section).toContain('"servers"');
    expect(section).not.toContain('"mcpServers"');
    expect(section).toContain('"inputs"');
    expect(section).toContain('"password": true');
    expect(section).toContain('"Authorization": "Bearer ${input:qveris-api-key}"');
  });
});
