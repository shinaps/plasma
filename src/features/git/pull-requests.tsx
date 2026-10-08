import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../shared/errors.ts';
import type { PullRequest, PullRequestComparison, SendRequest } from '../../../shared/protocol.ts';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

export function PullRequests({
  request,
  onSelect,
}: {
  request: SendRequest;
  onSelect: (value?: PullRequestComparison) => void;
}) {
  const [requests, setRequests] = useState<PullRequest[]>([]);
  const [repository, setRepository] = useState('');
  const [selected, setSelected] = useState<PullRequestComparison>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const load = useCallback(
    async (number?: number) => {
      const current = ++revision.current;
      setBusy(true);
      setError('');
      setSelected(undefined);
      onSelect(undefined);
      try {
        if (number) {
          const comparison = await request({ op: 'git-pr-open', number });
          if (current !== revision.current) return;
          setSelected(comparison);
          onSelect(comparison);
        } else {
          const result = await request({ op: 'git-pr-list' });
          if (current !== revision.current) return;
          setRepository(result.repository);
          setRequests(result.requests);
        }
      } catch (error) {
        if (current === revision.current) setError(errorMessage(error));
      } finally {
        if (current === revision.current) setBusy(false);
      }
    },
    [request, onSelect],
  );
  // プロジェクトやモードの切り替え後に、以前の取得結果を表示しない。
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  return (
    <section aria-label="Pull Requests" className="space-y-2 px-2 pb-2 text-caption">
      <div className="flex items-center gap-1">
        <Select
          value={selected ? String(selected.number) : ''}
          disabled={busy}
          onValueChange={(value) => void load(Number(value))}
        >
          <SelectTrigger aria-label="Select pull request" className="min-w-0 flex-1">
            <SelectValue placeholder="Select pull request" />
          </SelectTrigger>
          <SelectContent position="popper">
            {requests.map((pr) => (
              <SelectItem key={pr.number} value={String(pr.number)}>
                #{pr.number} {pr.title}
                {pr.draft ? ' · Draft' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh pull requests"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {busy && <p role="status">Loading pull request…</p>}
      {error && <Alert className="text-destructive whitespace-pre-wrap">{error}</Alert>}
      {!busy && !error && !requests.length && <p>No open pull requests.</p>}
      {selected ? (
        <div className="space-y-1">
          <p className="font-medium break-words">
            #{selected.number} {selected.title}
          </p>
          <p className="text-muted-foreground break-all">
            {selected.head} → {selected.base}
          </p>
          <p className="text-muted-foreground">{selected.entries.length} files · Read only</p>
          {!selected.entries.length && <p>No changes in this pull request.</p>}
        </div>
      ) : (
        <p className="text-muted-foreground break-all">{repository}</p>
      )}
    </section>
  );
}
