import { useRef } from 'react';
import { renderReact, unmountReact } from '../lib/react-view';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

type Options = { title: string; description?: string; initialName?: string; accept: string };
/**
 * ネイティブ prompt を使えない埋め込みブラウザでも、入力と破棄確認を同じダイアログで行う。
 * @param options initialName を渡したときだけ名前の入力欄を出す。省略すると確認だけのダイアログになる。accept は確定ボタンの文言
 * @returns キャンセルなら undefined。確定なら入力した名前 (入力欄のない確認では空文字)
 */
export function fileDialog(options: Options): Promise<string | undefined> {
  const returnFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const host = document.createElement('div');
  document.body.append(host);
  return new Promise((resolve) => {
    const finish = (value?: string): void => {
      unmountReact(host);
      host.remove();
      resolve(value);
    };
    renderReact(host, <FileDialog options={options} finish={finish} returnFocus={returnFocus} />);
  });
}
function FileDialog({
  options,
  finish,
  returnFocus,
}: {
  options: Options;
  finish: (value?: string) => void;
  returnFocus?: HTMLElement;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish();
      }}
    >
      <DialogContent
        {...(!options.description && { 'aria-describedby': undefined })}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // メニュー項目は閉じると消える。その場合は呼び出し元が戻したフォーカスを保つ。
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          if (input.current) {
            event.preventDefault();
            input.current.focus();
            input.current.select();
          }
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            finish(input.current?.value ?? '');
          }}
        >
          <DialogTitle className="mb-3 text-body font-semibold">{options.title}</DialogTitle>
          {options.description && (
            <DialogDescription className="mb-4 whitespace-pre-wrap break-words text-caption text-muted-foreground">
              {options.description}
            </DialogDescription>
          )}
          {options.initialName !== undefined && (
            <Input
              ref={input}
              aria-label="Name"
              defaultValue={options.initialName}
              required
              className="mb-4"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="plain" size="sm" type="button" onClick={() => finish()}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" type="submit">
              {options.accept}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 確認も同じ埋め込み対応ダイアログを使い、ネイティブconfirmに依存しない。 */
export async function confirmDialog(description: string): Promise<boolean> {
  return (
    (await fileDialog({ title: 'Confirm action', description, accept: 'Continue' })) !== undefined
  );
}
