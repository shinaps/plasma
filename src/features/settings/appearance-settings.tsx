import { useEffect, useRef, useState } from 'react';
import type { Appearance } from '../../../shared/appearance.ts';
import { errorMessage } from '../../../shared/errors.ts';
import type { SendRequest } from '../../../shared/protocol.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { defaultFontSizes } from './font-sizes';

const fields = [
  ['ui', 'UI'],
  ['editor', 'Code Editor'],
  ['terminal', 'Terminal'],
] as const;
const sizes = Array.from({ length: 23 }, (_, index) => index + 10);
export function AppearanceSettings({
  request,
  onChange,
}: {
  request: SendRequest;
  onChange: (value: Appearance) => void;
}) {
  const [value, setValue] = useState<Appearance>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const defaults = defaultFontSizes();
  useEffect(() => {
    let live = true;
    request({ op: 'appearance-get' })
      .then((result) => {
        if (live) setValue(result);
      })
      .catch((cause: unknown) => {
        if (live) setError(errorMessage(cause));
      });
    return () => {
      live = false;
    };
  }, [request]);
  async function save(next: Appearance): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await request({ op: 'appearance-set', appearance: next });
      onChange(saved);
      setValue(saved);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Appearance">
      <h2 className="mt-8 mb-4 text-body font-semibold">Font Size</h2>
      <p className="text-caption text-muted-foreground">Applies to all projects.</p>
      <div className="space-y-5 rounded-panel bg-muted p-6">
        {fields.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-6">
            <label htmlFor={`font-${key}`}>{label}</label>
            <Select
              disabled={!value || busy}
              value={String(value?.[key] ?? defaults[key])}
              onValueChange={(size) => void save({ ...value, [key]: Number(size) })}
            >
              <SelectTrigger id={`font-${key}`} aria-label={`${label} font size`} className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <h2 className="mt-8 mb-4 text-body font-semibold">Editor</h2>
      <div className="flex items-center justify-between gap-6 rounded-panel bg-muted p-6">
        <div>
          <label htmlFor="editor-word-wrap">Word Wrap by Default</label>
          <p className="mt-1 text-caption text-muted-foreground">
            Applies to both editor groups. Override from a tab’s context menu.
          </p>
        </div>
        <Switch
          id="editor-word-wrap"
          disabled={!value || busy}
          checked={value?.wordWrap ?? false}
          onCheckedChange={(wordWrap) => void save({ ...value, wordWrap })}
        />
      </div>
      <button
        type="button"
        disabled={!value || busy}
        onClick={() => void save({})}
        className="mt-5 rounded-control px-3 py-2 text-caption text-muted-foreground hover:bg-accent"
      >
        Reset to Defaults
      </button>
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
