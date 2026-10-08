import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OpenAIUiToolMetadataSchema } from '@openai/mcp-extensions/server';

test('MCP handshake, entrypoint metadata, UI resource and tool round-trip', async (context) => {
  const client = new Client({ name: 'workbench-test', version: '1.0.0' });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-mcp-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const state = path.join(temp, 'state');
  const project = path.join(temp, 'project');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/main.ts'), 'export const main = 1;\n');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['server/mcp.ts'],
    cwd: process.cwd(),
    env: { ...process.env, WORKBENCH_STATE_DIR: state },
  });
  context.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  const open = tools.find((tool) => tool.name === 'open_workbench');
  assert.ok(open);
  const ui = open._meta?.ui as { resourceUri: string };
  OpenAIUiToolMetadataSchema.parse(open._meta?.['openai/ui']);
  const { resources } = await client.listResources();
  assert.ok(resources.some((resource) => resource.uri === ui.resourceUri));
  const appearance = await client.callTool({
    name: 'workbench_request',
    arguments: { op: 'appearance-set', appearance: { editor: 18 } },
  });
  assert.deepEqual(appearance.structuredContent, { editor: 18 });
  const restored = await client.callTool({
    name: 'workbench_request',
    arguments: { op: 'appearance-get' },
  });
  assert.deepEqual(restored.structuredContent, { editor: 18 });
  const initial = await client.callTool({ name: 'open_workbench', arguments: {} });
  assert.deepEqual((initial.structuredContent as { recent: unknown[] }).recent, []);
  const route = `/open?${new URLSearchParams({ project, file: 'src/main.ts', line: '3', endLine: '5' })}`;
  const targeted = await client.callTool({ name: 'open_workbench', arguments: { route } });
  assert.equal(targeted.isError, undefined);
  const invalid = await client.callTool({
    name: 'open_workbench',
    arguments: { route: '/open?project=relative&file=main.ts' },
  });
  assert.equal(invalid.isError, true);
  const rejected = await client.callTool({
    name: 'workbench_request',
    arguments: { op: 'read', path: 'src/main.ts' },
  });
  assert.equal(rejected.isError, true);
  const opened = await client.callTool({
    name: 'workbench_request',
    arguments: { op: 'project-open', path: project },
  });
  const root = (opened.structuredContent as { root: string }).root;
  const result = await client.callTool({
    name: 'workbench_request',
    arguments: { op: 'workspace', root, expanded: ['src'] },
  });
  assert.equal(result.isError, undefined);
  assert.ok((result.structuredContent as { files: string[] }).files.includes('src/main.ts'));
});
