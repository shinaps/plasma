import { Projects } from './projects.ts';

/** HTTP と MCP の両方の入口が使う。プロセスの終了時に、開いているシェルと言語サービスを必ず解放する。 */
export function startProjects(): Projects {
  const projects = new Projects();
  process.once('exit', () => projects.dispose());
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      projects.dispose();
      process.exit(0);
    });
  return projects;
}
