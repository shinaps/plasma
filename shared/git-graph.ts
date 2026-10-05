/** colorLane はこの番号のレーンの色で線を描くことを表す。 */
type GraphEdge = { from: number; to: number; half: 'top' | 'bottom'; colorLane: number };
export type GraphRow = { lane: number; edges: GraphEdge[] };
type GraphLayout = { rows: GraphRow[]; lanes: number };

/**
 * 親待ちのコミットをレーンに固定したまま並べる。
 * 関係のないブランチの線が横に動かないので、ページを継ぎ足しても描画が変わらない。
 */
export function layoutCommits(commits: { id: string; parents: string[] }[]): GraphLayout {
  const pending: (string | null)[] = [];
  let lanes = 1;
  const rows = commits.map(({ id, parents }) => {
    let lane = pending.indexOf(id);
    if (lane < 0) {
      lane = pending.findIndex((value) => value == null);
      if (lane < 0) lane = pending.length;
    }
    const edges: GraphEdge[] = [];
    const throughLanes: number[] = [];
    for (let i = 0; i < pending.length; i++) {
      if (pending[i] == null) continue;
      edges.push({ from: i, to: pending[i] === id ? lane : i, half: 'top', colorLane: i });
      if (pending[i] !== id) throughLanes.push(i);
    }
    for (let i = 0; i < pending.length; i++) {
      if (pending[i] === id) pending[i] = null;
    }
    pending[lane] = null;
    for (const [index, parent] of [...new Set(parents)].entries()) {
      let target = index === 0 ? lane : pending.indexOf(parent);
      // 第 1 親の線は、別のレーンが同じ親へ向かっていても自分のレーンに残す。
      // 2 本の線は親のノードで合流し、関係のないブランチは動かない。
      if (index === 0) pending[lane] = parent;
      if (target < 0) {
        target = pending.findIndex((value, i) => value == null && i !== lane);
        if (target < 0) target = pending.length;
        pending[target] = parent;
      }
      edges.push({ from: lane, to: target, half: 'bottom', colorLane: target });
    }
    // 使用中のレーンにマージ線が入っても、そのレーンの通過線は消さない。
    for (const i of throughLanes) edges.push({ from: i, to: i, half: 'bottom', colorLane: i });
    lanes = Math.max(lanes, lane + 1, pending.length);
    return { lane, edges };
  });
  return { rows, lanes };
}
