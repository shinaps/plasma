import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { errorMessage } from '../shared/errors.ts';
import { parseFileRoute } from '../shared/file-route.ts';
import { terminalOps, workbenchOps } from '../shared/protocol.ts';
import { startProjects } from './lifecycle.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const projects = startProjects();
// この SDK はツール単位のアイコンを持たないので、ホストは serverInfo のアイコンを使う。
const icons = [
  {
    src: `data:image/svg+xml;base64,${fs.readFileSync(path.join(here, '../assets/plasma.svg')).toString('base64')}`,
    mimeType: 'image/svg+xml',
    sizes: ['20x20'],
  },
];
const server = new McpServer({
  name: 'plasma',
  title: 'Plasma',
  version: packageJson.version,
  icons,
});
new OpenAIExtensions(server);
const uri = 'ui://plasma/editor';
registerAppResource(server, 'plasma', uri, {}, async () => ({
  contents: [
    {
      uri,
      mimeType: RESOURCE_MIME_TYPE,
      text: fs.readFileSync(path.join(here, '../dist/index.html'), 'utf8'),
      _meta: {
        ui: { prefersBorder: true },
        'openai/ui': {
          preferredDisplayMode: 'fullscreen',
          availableDisplayModes: ['inline', 'fullscreen'],
        },
      },
    },
  ],
}));
// ツール名 open_workbench は README の起動リンク codex://mcp-app/.../open_workbench が参照する。変えるとリンクが切れる。
registerAppTool(
  server,
  'open_workbench',
  {
    title: 'Plasma',
    description:
      'Opens the Plasma panel in this conversation. When the user asks to open a file, set route to the absolute project path, the relative file path and the line range. Without a route, the project picker opens.',
    inputSchema: {
      route: z
        .string()
        .optional()
        .describe(
          'To target a file: /open?project=ABSOLUTE_PATH&file=RELATIVE_PATH&line=START&endLine=END, with each value URL-encoded. Omit to open the project picker.',
        ),
    },
    annotations: { readOnlyHint: true },
    _meta: {
      ui: { resourceUri: uri },
      'openai/ui': { entrypoints: [{ type: 'thread' }, { type: 'global' }] },
    },
  },
  async ({ route }) => {
    const target = route ? parseFileRoute(route) : null;
    return {
      content: [
        {
          type: 'text',
          text: target
            ? `Plasma: opening ${target.file}:${target.line}–${target.endLine}`
            : 'Plasma: select a project',
        },
      ],
      structuredContent: await projects.dispatch({ op: 'project-list' }),
    };
  },
);
// 入力の形は shared/protocol.ts の requestSchema が Projects.dispatch の入口で検証する。
// MCP の inputSchema は最上位が object でなければならないので、ここでは op だけを列挙する。
const toolHandler = async (input: unknown) => {
  try {
    return { content: [], structuredContent: await projects.dispatch(input) };
  } catch (error) {
    // stdout は MCP の通信路なので、原因とスタックは stderr に残す。
    console.error(error);
    return { isError: true, content: [{ type: 'text' as const, text: errorMessage(error) }] };
  }
};
registerAppTool(
  server,
  'workbench_request',
  {
    title: 'Plasma Request',
    description: 'For the editor UI only. Reads, writes and analyzes the workspace.',
    inputSchema: z.looseObject({ op: z.enum(workbenchOps) }),
    _meta: { ui: { visibility: ['app'] } },
  },
  toolHandler,
);
registerAppTool(
  server,
  'workbench_terminal',
  {
    title: 'Plasma Terminal',
    description: 'For the editor UI only. Local shell tabs.',
    inputSchema: z.looseObject({ op: z.enum(terminalOps) }),
    _meta: { ui: { visibility: ['app'] } },
  },
  toolHandler,
);
process.stdin.once('end', () => projects.dispose());
await server.connect(new StdioServerTransport());
