import type { ResponseOf, SendRequest } from '../../../shared/protocol.ts';

type OpenResult = ResponseOf<'project-open'>;

/** プロジェクトを開く。広すぎるフォルダは確認してから開く。利用者が取りやめたら undefined。 */
export async function openProject(
  request: SendRequest,
  path: string,
): Promise<OpenResult | undefined> {
  const result = await request({ op: 'project-open', path });
  if (!result.confirmationRequired) return result;
  if (
    !confirm(
      `Open this broad folder?\n\n${result.root}\n\nThis may include many unrelated files and take longer to load. Open a project folder instead unless this is intentional.`,
    )
  )
    return;
  return request({ op: 'project-open', path: result.root, confirmedRoot: result.root });
}
