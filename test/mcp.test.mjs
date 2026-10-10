import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function isolatedHome(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-mcp-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return temporary;
}

test('MCP SDK negotiates protocol, discovers tools and receives actionable connection errors', async t => {
  const temporary = await isolatedHome(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: ['bin/tabbridge.mjs', 'mcp'], env: { PATH: process.env.PATH, TABBRIDGE_HOME: temporary } });
  const client = new Client({ name: 'tabbridge-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some(t => t.name === 'browser_snapshot'));
    assert.ok(tools.some(t => t.name === 'browser_batch'));
    assert.ok(tools.some(t => t.name === 'browser_activate' && !t.annotations.readOnlyHint));
    const result = await client.callTool({ name: 'browser_status', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /NOT_CONNECTED/);
    // Invalid input must fail at the MCP boundary, before any browser request.
    for (const [name, args] of [
      ['browser_snapshot', { tabId: '1' }],
      ['browser_snapshot', { tabId: -1 }],
      ['browser_snapshot', { tabId: 1.5 }],
      ['browser_snapshot', { tabId: 1, diff: 'true' }],
      ['browser_snapshot', { tabId: 1, maxNodes: 1001 }],
      ['browser_fill', { tabId: 1, ref: 's1:e1', text: 123 }],
      ['browser_status', { unexpected: true }],
      ['browser_status', JSON.parse('{"__proto__":{}}')],
      ['browser_status', { toString: 'unexpected' }],
      ['browser_wait', { tabId: 1, text: 'Ready', timeoutMs: 12001 }],
      ['browser_batch', { tabId: 1, steps: [] }],
      ['browser_batch', { tabId: 1, steps: Array(13).fill({ method: 'click', params: {} }) }],
      ['browser_batch', { tabId: 1, steps: [{ method: 'evaluate', params: {} }] }],
      ['browser_batch', { tabId: 1, steps: [{ method: 'click', params: [] }] }],
      ['browser_batch', { tabId: 1, steps: [{ method: 'click', params: {}, unknown: true }] }]
    ]) {
      await assert.rejects(client.callTool({ name, arguments: args }), error => error.code === -32602, `${name} ${JSON.stringify(args)}`);
    }
    const valid = await client.callTool({ name: 'browser_snapshot', arguments: { tabId: 1, maxNodes: 20 } });
    assert.match(valid.content[0].text, /NOT_CONNECTED/);
  } finally { await client.close(); }
});

test('MCP reports parse and lifecycle errors without responding to notifications', async t => {
  const temporary = await isolatedHome(t);
  const requests = [
    '{bad',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25' } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'unknown' }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'browser_status', arguments: null } }),
    JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'ping' })
  ];
  const result = spawnSync(process.execPath, ['bin/tabbridge.mjs', 'mcp'], { input: requests.join('\n') + '\n', env: { ...process.env, TABBRIDGE_HOME: temporary }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies.map(reply => reply.id), [null, 1, 2, 3, 4, 5]);
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].error.code, -32000);
  assert.equal(replies[2].result.protocolVersion, '2025-11-25');
  assert.equal(replies[3].error.code, -32601);
  assert.equal(replies[4].error.code, -32602);
  assert.deepEqual(replies[5].result, {});
});

test('MCP rejects oversized input with bounded buffering', async t => {
  const temporary = await isolatedHome(t);
  const result = spawnSync(process.execPath, ['bin/tabbridge.mjs', 'mcp'], { input: 'x'.repeat(1024 * 1024 + 1), env: { ...process.env, TABBRIDGE_HOME: temporary }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MCP input exceeds 1 MiB/);
  assert.equal(result.stdout, '');
});
