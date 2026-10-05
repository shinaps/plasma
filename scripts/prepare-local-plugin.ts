import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketplace = path.join(root, '.shinaps/work/local-marketplace');
const plugin = path.join(marketplace, 'plugins/typescript-workbench');
fs.mkdirSync(path.join(plugin, 'assets'), { recursive: true });
for (const name of ['plasma.svg', 'plasma-light.svg', 'plasma-dark.svg'])
  fs.copyFileSync(path.join(root, 'assets', name), path.join(plugin, 'assets', name));
const write = (file: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};
// Codex が同梱プラグインと同じ配置で MCP サーバーを見つけられるようにする。
// プラグイン ID (typescript-workbench) はインストール済みの環境を保つために変えない。
write(path.join(plugin, '.codex-plugin/plugin.json'), {
  name: 'typescript-workbench',
  version: packageJson.version,
  description: 'Browse local code and discuss selected code with annotations.',
  mcpServers: './.mcp.json',
  interface: {
    displayName: 'Plasma',
    composerIcon: './assets/plasma.svg',
    logo: './assets/plasma-light.svg',
    logoDark: './assets/plasma-dark.svg',
    shortDescription: 'Browse code, diffs and annotations',
    developerName: 'Shinaps',
    category: 'Developer Tools',
  },
});
// 展開先で生成するため、開発者の絶対パスを配布しない。登録後はこのフォルダを移動しない。
write(path.join(plugin, '.mcp.json'), {
  mcpServers: {
    plasma: { command: process.execPath, args: [path.join(root, 'server/mcp.ts')], cwd: root },
  },
});
write(path.join(marketplace, '.agents/plugins/marketplace.json'), {
  name: 'workbench-local',
  interface: { displayName: 'Workbench Local' },
  plugins: [
    {
      name: 'typescript-workbench',
      source: { source: 'local', path: './plugins/typescript-workbench' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Developer Tools',
    },
  ],
});
console.log(marketplace);
