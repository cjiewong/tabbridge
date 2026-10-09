import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP SDK negotiates protocol, discovers tools and receives actionable connection errors', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['bin/tabbridge.mjs', 'mcp'], env: { PATH: process.env.PATH, TABBRIDGE_HOME: '/tmp/tabbridge-test-no-socket' } });
  const client = new Client({ name: 'tabbridge-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some(t => t.name === 'browser_snapshot'));
    assert.ok(tools.some(t => t.name === 'browser_batch'));
    const result = await client.callTool({ name: 'browser_status', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /NOT_CONNECTED/);
  } finally { await client.close(); }
});
