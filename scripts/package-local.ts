import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.shinaps/work/distribution');
fs.mkdirSync(output, { recursive: true });
const build = fs.mkdtempSync(path.join(output, 'build-'));
const name = `plasma-${packageJson.version}-local-preview`;
const stage = path.join(build, name);
fs.mkdirSync(stage);
// 配布物は許可リストで組み立てる。設定・作業履歴・既存 marketplace の絶対パスを含めない。
for (const entry of [
  'server',
  'shared',
  'assets',
  'dist/index.html',
  'scripts/prepare-local-plugin.ts',
  'scripts/prepare-terminal.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]) {
  const target = path.join(stage, entry);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(root, entry), target, { recursive: true });
}
fs.copyFileSync(path.join(root, 'docs/local-distribution.md'), path.join(stage, 'README.md'));
fs.writeFileSync(
  path.join(stage, 'package.json'),
  `${JSON.stringify(
    {
      ...packageJson,
      scripts: {
        start: packageJson.scripts.start,
        mcp: packageJson.scripts.mcp,
        postinstall: packageJson.scripts.postinstall,
        'setup:plugin': 'node scripts/prepare-local-plugin.ts',
      },
    },
    null,
    2,
  )}\n`,
);

const notices = path.join(stage, 'third-party');
fs.mkdirSync(notices);
for (const entry of [
  'src/assets/atom-material/LICENSE',
  'src/assets/atom-material/README.md',
  'src/components/ui/LICENSE.md',
  'src/features/editor/themes/ONE-DARK-LICENSE',
  'src/features/editor/themes/README.md',
]) {
  const target = path.join(notices, entry);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, entry), target);
}
// pnpm の仮想ストアから推移的依存も収集し、バンドルに含まれるライセンスを残す。
const manifests = fs.globSync(
  [
    'node_modules/.pnpm/*/node_modules/*/package.json',
    'node_modules/.pnpm/*/node_modules/@*/*/package.json',
  ],
  { cwd: root },
);
const directories = [
  ...new Set(manifests.map((manifest) => fs.realpathSync(path.dirname(path.join(root, manifest))))),
].sort();
const dependencies: string[] = [];
for (const directory of directories) {
  const entry = path.relative(root, directory);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  dependencies.push(`${metadata.name}@${metadata.version}: ${metadata.license ?? 'See package'}`);
  for (const file of fs.readdirSync(directory)) {
    if (!/^(licen[cs]e|copying|notice)([.-]|$)/i.test(file)) continue;
    const target = path.join(notices, entry, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(directory, file), target, { recursive: true });
  }
}
fs.writeFileSync(path.join(notices, 'dependencies.txt'), `${dependencies.join('\n')}\n`);
const archive = path.join(build, `${name}.tar.gz`);
execFileSync('tar', ['-czf', archive, '-C', build, name], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
});
const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
console.log(archive);
