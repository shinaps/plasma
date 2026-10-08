import type { ReactElement, ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator as Separator,
  ContextMenuSubmenu as Submenu,
} from '../../components/ui/context-menu';

export type ExplorerAction =
  | 'new-file'
  | 'new-directory'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'absolute-path'
  | 'relative-path'
  | 'file-name'
  | 'rename'
  | 'delete'
  | 'reload'
  | 'diff';
export function ExplorerMenu({
  path,
  root,
  directory,
  excluded,
  canPaste,
  onAction,
  onAnalysisChange,
  children,
}: {
  path: string;
  root: string;
  directory: boolean;
  excluded: boolean;
  canPaste: boolean;
  onAction: (action: ExplorerAction) => void;
  /** 解析の除外を切り替える。excluded なら含める方向、そうでなければ除外する方向。 */
  onAnalysisChange: () => void;
  children: ReactElement;
}): ReactNode {
  const entry = (
    action: ExplorerAction,
    label: string,
    disabled = false,
    value?: string,
  ): ReactNode => (
    <ContextMenuItem disabled={disabled} onSelect={() => onAction(action)} textValue={label}>
      <span className="shrink-0">{label}</span>
      {value !== undefined && (
        <span className="max-w-96 truncate text-muted-foreground" title={value}>
          {value}
        </span>
      )}
    </ContextMenuItem>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <Submenu label="New">
          {entry('new-file', 'File…')}
          {entry('new-directory', 'Directory…')}
        </Submenu>
        <Separator />
        {entry('cut', 'Cut', !path)}
        {entry('copy', 'Copy', !path)}
        {entry('paste', 'Paste', !canPaste)}
        <Submenu label="Copy Path">
          {entry('absolute-path', 'Absolute Path', false, path ? `${root}/${path}` : root)}
          {entry('relative-path', 'Relative Path', false, path || '.')}
          {entry('file-name', 'File Name', false, (path || root).split('/').at(-1))}
        </Submenu>
        <Separator />
        {entry('rename', 'Rename…', !path)}
        {entry('delete', 'Delete…', !path)}
        <Separator />
        {entry('reload', 'Reload from Disk')}
        {!directory && <Submenu label="Git">{entry('diff', 'Show Diff')}</Submenu>}
        {!!path && (
          <>
            <Separator />
            {directory ? (
              <Submenu label="Mark Directory As">
                <ContextMenuItem onSelect={onAnalysisChange}>
                  {excluded ? 'Include in Analysis' : 'Excluded'}
                </ContextMenuItem>
              </Submenu>
            ) : (
              <ContextMenuItem onSelect={onAnalysisChange}>
                {excluded ? 'Include in Analysis' : 'Exclude from Analysis'}
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
