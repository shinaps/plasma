import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';

export function ExplorerSettings({
  id,
  defaults,
  title,
  description,
  value,
  busy,
  onSave,
}: {
  id: string;
  defaults: string[];
  title: string;
  description: string;
  value: string[];
  busy: boolean;
  onSave: (value: string[]) => Promise<void>;
}): ReactNode {
  const saved = value.join('\n');
  const [draft, setDraft] = useState(saved);
  // 保存済みの内容が変わったときだけ入力を差し替える。他の設定の保存や同じ内容の再取得で入力中の文を消さない。
  useEffect(() => setDraft(saved), [saved]);
  return (
    <section aria-label={title}>
      <h2 className="mt-8 mb-4 text-body font-semibold">{title}</h2>
      <p id={`${id}-help`} className="text-caption leading-relaxed text-muted-foreground">
        {description} Enter one folder name (at any depth) or project-relative path per line. Prefix
        a path with ./ to match only that location. Wildcards are not supported. Git and formatter
        rules are unchanged.
      </p>
      <Label htmlFor={id} className="block mb-2 text-caption">
        {title}
      </Label>
      <Textarea
        id={id}
        aria-describedby={`${id}-help`}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        rows={12}
        spellCheck={false}
        className="w-full rounded-control border border-solid border-input bg-muted p-3 font-mono text-caption text-foreground"
      />
      <div className="mt-4 flex gap-3">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={busy}
          onClick={() =>
            void onSave([
              ...new Set(
                draft
                  .split('\n')
                  .map((line) => line.trim().replace(/\/+$/, ''))
                  .filter(Boolean),
              ),
            ])
          }
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={busy}
          className="bg-muted"
          onClick={() => setDraft(defaults.join('\n'))}
        >
          Restore Defaults
        </Button>
      </div>
      <p className="mt-4 text-caption text-muted-foreground">
        Save to refresh the tree. Showing large generated folders may slow down scanning.
      </p>
    </section>
  );
}
