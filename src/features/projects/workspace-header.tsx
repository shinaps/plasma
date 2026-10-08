import { Folder, GitBranch } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { errorMessage } from '../../../shared/errors';
import type { RecentProject, SendRequest } from '../../../shared/protocol';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '../../components/ui/select';

type Props = {
  root: string;
  branch: string;
  request: SendRequest;
  /** root が undefined ならプロジェクト選択画面を開く。 */
  onProject: (root: string | undefined) => Promise<void>;
  onBranch: (branch: string) => Promise<void>;
  report: (message: string) => void;
};

export function WorkspaceHeader({
  root,
  branch,
  request,
  onProject,
  onBranch,
  report,
}: Props): ReactNode {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const name = root.split('/').at(-1) || root;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      report(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const projects = [{ root, name }, ...recent.filter((project) => project.root !== root)];
  return (
    <>
      <Select
        value={root}
        disabled={busy}
        onOpenChange={(open) => {
          if (open)
            void request({ op: 'project-list' })
              .then((result) => setRecent(result.recent))
              .catch((error) => report(errorMessage(error)));
        }}
        onValueChange={(value) => void run(() => onProject(value === 'browse' ? undefined : value))}
      >
        <SelectTrigger
          aria-label="Switch project"
          title={root}
          size="sm"
          className="min-w-0 max-w-64 gap-2 border-0 px-2.5 py-1.5 text-caption shadow-none hover:bg-accent data-[state=open]:bg-accent"
        >
          <Folder className="size-4" aria-hidden="true" />
          <span className="min-w-0 truncate">{name}</span>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {projects.map((project) => (
            <SelectItem key={project.root} value={project.root}>
              <span title={project.root}>{project.name}</span>
            </SelectItem>
          ))}
          <SelectItem value="browse">Open Project…</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={branch || undefined}
        disabled={busy || !branch}
        onOpenChange={(open) => {
          if (open)
            void request({ op: 'git-branches' })
              .then((result) => setBranches(result.branches))
              .catch((error) => report(errorMessage(error)));
        }}
        onValueChange={(value) => void run(() => onBranch(value))}
      >
        <SelectTrigger
          aria-label="Switch branch"
          title={branch || 'Not a Git repository'}
          size="sm"
          className="min-w-0 max-w-64 gap-2 border-0 px-2.5 py-1.5 text-caption shadow-none hover:bg-accent data-[state=open]:bg-accent"
        >
          <GitBranch className="size-4" aria-hidden="true" />
          <span className="min-w-0 truncate">{branch || 'No branch'}</span>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectGroup>
            <SelectLabel>Local branches</SelectLabel>
            {[...new Set([branch, ...branches])].filter(Boolean).map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}
