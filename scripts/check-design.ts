import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('src');
const failures: string[] = [];
function scan(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // 配布元のライセンスを保つ構文配色と SVG 素材は、アプリ本体の見た目の規約の対象外にする。
      if (!['assets', 'themes'].includes(entry.name)) scan(file);
      continue;
    }
    if (!/\.(tsx?|css)$/.test(file) || entry.name === 'tokens.css') continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/(?:['"\s:]|\[)#[\da-f]{3,8}(?=[\s;'"\]},])/i.test(text))
      failures.push(`${file}: literal color`);
    if (/(?:text|rounded|shadow)-\[/.test(text))
      failures.push(`${file}: arbitrary appearance utility`);
    if (entry.name.endsWith('.css') && !['base.css', 'globals.css'].includes(entry.name))
      failures.push(`${file}: component stylesheet`);
  }
}
scan(source);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Design tokens: no component color literals or arbitrary appearance utilities.');
