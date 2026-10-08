import { type ReactNode, useState } from 'react';
import { errorMessage } from '../../../shared/errors';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';

type Props = { paths: string[]; commit: (message: string) => Promise<string> };
export function CommitForm({ paths, commit }: Props): ReactNode {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  return (
    <form
      className="shrink-0 border-t border-border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !paths.length || !message.trim()) return;
        setBusy(true);
        setResult('');
        try {
          setResult(await commit(message.trim()));
          setMessage('');
        } catch (error) {
          setResult(errorMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label className="block text-caption" htmlFor="commit-message">
        Commit message
      </Label>
      <Textarea
        id="commit-message"
        className="mt-1 resize-none field-sizing-content p-2 text-caption"
        rows={3}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={busy}
      />
      <p className="my-2 text-caption text-muted-foreground">
        Commits checked files and selected changes. Save edits before committing.
      </p>
      <Button
        variant="secondary"
        size="sm"
        type="submit"
        disabled={busy || !paths.length || !message.trim()}
      >
        {busy ? 'Committing…' : `Commit ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`}
      </Button>
      {result && (
        <p
          role="status"
          className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-caption"
        >
          {result}
        </p>
      )}
    </form>
  );
}
