export type FileTarget = { project: string; file: string; line: number; endLine: number };

/**
 * 会話パネルと単体の開発用 UI が共有するリンクの形式。
 * ファイルがプロジェクトの中にあるかはサーバーの `Workspace.resolve` が確かめるので、ここでは行範囲と形式だけを見る。
 */
export function parseFileRoute(route: string): FileTarget | null {
  if (route === '/') return null;
  if (!route.startsWith('/open?')) throw new Error('Invalid Plasma link.');
  const query = new URLSearchParams(route.slice('/open?'.length));
  const project = query.get('project');
  const file = query.get('file');
  const line = Number(query.get('line') || 1);
  const endLine = Number(query.get('endLine') || line);
  const validRange = Number.isSafeInteger(line) && line >= 1 && Number.isSafeInteger(endLine);
  if (!project?.startsWith('/') || !file || !validRange || endLine < line)
    throw new Error('Check the project, file and line range.');
  return { project, file, line, endLine };
}
