import { useEffect, useRef, useState } from 'react';
import type { Appearance } from '../../../shared/appearance.ts';
import { errorMessage } from '../../../shared/errors.ts';
import {
  formatterIdSchema,
  type ProjectSettings,
  type SendRequest,
  type SettingsView,
} from '../../../shared/protocol.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { renderReact, unmountReact } from '../../lib/react-view';
import { AppearanceSettings } from './appearance-settings';
import { LayoutSettings } from './layout-settings';

const triggerStyle =
  'h-10 flex-none justify-start rounded-control border-0 px-3 text-caption text-muted-foreground shadow-none data-[state=active]:bg-accent data-[state=active]:text-foreground';

function SettingsPage({
  root,
  request,
  onAppearanceChange,
}: {
  root: string;
  request: SendRequest;
  onAppearanceChange: (value: Appearance) => void;
}) {
  const [settings, setSettings] = useState<SettingsView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    request({ op: 'settings-get' })
      .then((value) => {
        if (live) setSettings(value);
      })
      .catch((cause: unknown) => {
        if (live) setError(errorMessage(cause));
      });
    return () => {
      live = false;
    };
  }, [request]);
  // 設定画面はポータルで後から描かれるので、開いた側がフォーカスを移すには遅い。初回の描画後にここで移す。
  useEffect(() => {
    firstTab.current?.focus();
  }, []);
  const save = async (change: Partial<ProjectSettings>): Promise<void> => {
    if (!settings || busy) return;
    setBusy(true);
    setError('');
    try {
      setSettings(
        await request({
          op: 'settings-set',
          formatOnSave: settings.formatOnSave,
          formatter: settings.formatter,
          ...change,
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const missing =
    settings &&
    settings.formatter !== 'auto' &&
    !settings.available.some((formatter) => formatter.id === settings.formatter);
  return (
    <Tabs
      defaultValue="save"
      orientation="vertical"
      className="gap-10 max-[850px]:flex-col max-[850px]:gap-6"
    >
      <TabsList
        aria-label="Settings categories"
        className="w-44 shrink-0 items-stretch gap-1.5 bg-transparent p-0"
      >
        <TabsTrigger ref={firstTab} value="save" className={triggerStyle}>
          On Save
        </TabsTrigger>
        <TabsTrigger value="format" className={triggerStyle}>
          Formatting
        </TabsTrigger>
        <TabsTrigger value="appearance" className={triggerStyle}>
          Appearance
        </TabsTrigger>
        <TabsTrigger value="layout" className={triggerStyle}>
          Layout
        </TabsTrigger>
      </TabsList>
      <div className="min-w-0 max-w-2xl flex-1">
        <h1 className="m-0 mb-2 text-title font-semibold text-foreground">Settings</h1>
        <p className="m-0 mb-7 break-all text-caption text-muted-foreground">{root}</p>
        <TabsContent value="save">
          <h2 className="mt-8 mb-4 text-body font-semibold">On Save</h2>
          <div className="flex items-center justify-between gap-6 rounded-panel bg-muted p-6">
            <div>
              <label htmlFor="format-on-save">Format on Save</label>
              <p className="m-0 mt-1.5 text-caption leading-relaxed text-muted-foreground">
                Formats TypeScript and JavaScript files with your project’s formatting rules.
              </p>
            </div>
            <Switch
              id="format-on-save"
              checked={settings?.formatOnSave ?? false}
              disabled={!settings || busy}
              onCheckedChange={(formatOnSave) => void save({ formatOnSave })}
            />
          </div>
        </TabsContent>
        <TabsContent value="format">
          <h2 className="mt-8 mb-4 text-body font-semibold">Formatting</h2>
          <div className="flex items-center justify-between gap-6 rounded-panel bg-muted p-6">
            <span id="formatter-label">Formatter</span>
            <Select
              value={settings?.formatter ?? 'auto'}
              disabled={!settings || busy}
              onValueChange={(formatter) =>
                void save({ formatter: formatterIdSchema.parse(formatter) })
              }
            >
              <SelectTrigger
                aria-labelledby="formatter-label"
                className="min-w-44 rounded-control border-0 bg-accent px-3 text-caption shadow-none hover:bg-input data-[size=default]:h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="end"
                className="rounded-panel border border-solid border-input p-1 shadow-popover [&_[role=option]]:min-h-9 [&_[role=option]]:rounded-control [&_[role=option]]:text-caption"
              >
                <SelectItem value="auto">Auto-detect</SelectItem>
                {settings?.available.map((formatter) => (
                  <SelectItem key={formatter.id} value={formatter.id}>
                    {formatter.name}
                  </SelectItem>
                ))}
                {missing && (
                  <SelectItem value={settings?.formatter ?? 'auto'}>
                    {settings?.formatter ?? 'auto'} (not detected)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <p className="my-5 text-caption leading-relaxed text-muted-foreground">
            {!settings
              ? 'Loading…'
              : settings.active
                ? `${settings.active.name} ${settings.active.version} · Installed in project`
                : 'No supported formatter found. Install Biome, Oxfmt, or Vite+ in your project.'}
          </p>
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceSettings request={request} onChange={onAppearanceChange} />
        </TabsContent>
        <TabsContent value="layout">
          <LayoutSettings />
        </TabsContent>
        {error && (
          <p className="text-caption whitespace-pre-wrap text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </Tabs>
  );
}
/** 設定画面を描き、閉じる関数を返す。 */
export function openSettings(
  host: HTMLElement,
  root: string,
  request: SendRequest,
  onAppearanceChange: (value: Appearance) => void,
): () => void {
  renderReact(
    host,
    <SettingsPage root={root} request={request} onAppearanceChange={onAppearanceChange} />,
  );
  return () => unmountReact(host);
}
