import { Folder, Square, SquareCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type TreeRow, TreeView } from '../../components/tree-view';

type Node = {
  id: string;
  name: string;
  ref?: string;
  children: Map<string, Node>;
};
type Props = { refs: string[]; selected: string[]; onSelect: (ref: string) => void };

export function BranchTree({ refs, selected, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const groups = useMemo(() => {
    return [
      ['Local', 'refs/heads/'],
      ['Remotes', 'refs/remotes/'],
      ['Tags', 'refs/tags/'],
    ].map(([name, prefix]) => {
      const root: Node = { id: prefix, name, children: new Map() };
      for (const ref of refs.filter((ref) => ref.startsWith(prefix))) {
        let node = root;
        const parts = ref.slice(prefix.length).split('/');
        for (const [index, part] of parts.entries()) {
          let child = node.children.get(part);
          if (!child) {
            child = {
              id: prefix + parts.slice(0, index + 1).join('/'),
              name: part,
              children: new Map(),
            };
            node.children.set(part, child);
          }
          node = child;
        }
        node.ref = ref;
      }
      return root;
    });
  }, [refs]);
  const rows: TreeRow[] = [
    {
      id: 'HEAD',
      path: 'HEAD',
      label: 'HEAD (current)',
      level: 1,
      selected: selected.includes('HEAD'),
      icon: selected.includes('HEAD') ? (
        <SquareCheck size={13} className="shrink-0 text-primary" />
      ) : (
        <Square size={13} className="shrink-0 text-muted-foreground" />
      ),
    },
  ];
  function visit(node: Node, level: number, parentId?: string): void {
    const folder = !node.ref;
    rows.push({
      id: node.id,
      path: node.ref ?? node.id,
      label: node.name,
      level,
      parentId,
      group: level === 1,
      expanded: folder ? !collapsed.has(node.id) : undefined,
      selected: !!node.ref && selected.includes(node.ref),
      icon: folder ? (
        <Folder size={13} className="shrink-0 text-muted-foreground" />
      ) : node.ref && selected.includes(node.ref) ? (
        <SquareCheck size={13} className="shrink-0 text-primary" />
      ) : (
        <Square size={13} className="shrink-0 text-muted-foreground" />
      ),
    });
    if (folder && !collapsed.has(node.id)) {
      [...node.children.values()]
        .sort(
          (left, right) =>
            Number(!!left.ref) - Number(!!right.ref) || left.name.localeCompare(right.name),
        )
        .forEach((child) => {
          visit(child, level + 1, node.id);
        });
    }
  }
  for (const group of groups) if (group.children.size) visit(group, 1);
  return (
    <TreeView
      label="History branches"
      multiselect
      rows={rows}
      emptyMessage="No branches"
      onActivate={(row) => {
        if (row.expanded === undefined) onSelect(row.path);
        else
          setCollapsed((previous) => {
            const next = new Set(previous);
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            return next;
          });
      }}
    />
  );
}
