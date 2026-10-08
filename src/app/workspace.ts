import * as monaco from 'monaco-editor/editor/editor.api';
import { createElement } from 'react';
import type { Appearance } from '../../shared/appearance.ts';
import { errorMessage } from '../../shared/errors.ts';
import { isExcludedPath } from '../../shared/explorer-settings.ts';
import { type FileTarget, parseFileRoute } from '../../shared/file-route.ts';
import { imageType } from '../../shared/image-types.ts';
import { isSource, languageFor, semanticLanguages } from '../../shared/language.ts';
import {
  type Diagnostic,
  emptyGitStatus,
  type GitStatus,
  type Location,
  type WorkspaceInfo,
} from '../../shared/protocol.ts';
import { confirmDialog, fileDialog } from '../components/file-dialog';
import { createButton } from '../components/ui/button';
import { attachCodeNavigation } from '../features/editor/code-navigation';
import { attachDocumentPreview } from '../features/editor/document-preview';
import { DocumentStore, isDirty } from '../features/editor/documents';
import { createFileTabs } from '../features/editor/file-tabs';
import { showImage } from '../features/editor/image-view';
import { showRecentFiles } from '../features/editor/recent-files';
import { type SplitDirection, SplitEditor } from '../features/editor/split-editor';
import { configureTabDrag, type EditorGroup } from '../features/editor/tab-drag';
import { registerWrapping } from '../features/editor/wrapping';
import { showGitHistory } from '../features/git/git-history';
import { ToolDock } from '../features/layout/tool-dock';
import { openProject } from '../features/projects/open-project';
import { WorkspaceHeader } from '../features/projects/workspace-header';
import { applyFontSizeTokens } from '../features/settings/font-sizes';
import { requireElement } from '../lib/dom';
import { renderReact, unmountReact } from '../lib/react-view';
import { rendererTheme } from '../styles/renderer-theme';
import { Connection } from './connection';
import { mountWorkspace } from './workspace-shell';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands';
// Peek Definition のウィジェットは standalone 用の contribution が登録して初めて開く。無いとメニューの項目が何もしない。
import 'monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline';
import '../styles/globals.css';
import { Annotations } from '../features/editor/annotations';
import { setupHighlighting } from '../features/editor/highlighting';
import type { ExplorerAction } from '../features/explorer/explorer-menu';
import { FileTree } from '../features/explorer/file-tree';
import { GitPanel } from '../features/git/git-panel';
import { chooseProject } from '../features/projects/project-picker';
import { openSettings, updateSettingsView } from '../features/settings/settings';
import { TerminalPanel } from '../features/terminal/terminal';

type MainView = 'editor' | 'diff' | 'settings';

/** 「戻る」で辿れる位置の数。これを超えた古い位置は削除する。 */
const historyLimit = 50;
/** 最近開いたファイルの表示件数。 */
const recentFilesLimit = 12;
/** 入力が止まってから診断を取るまでの時間。入力中に診断が走り続けないようにする。 */
const diagnosticsDelay = 600;
/** ディスクの変更を取り込む間隔と、Git の状態を取り直す間隔。 */
const pollInterval = { disk: 2000, git: 5000 };
/** サイドバーの幅の範囲。これより狭いとファイル名が読めず、広いとエディタが足りない。 */
const sidebarWidth = { min: 150, max: 440 };

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => requireElement<T>(`#${id}`);
mountWorkspace();
// macOS の Delete は Backspace。Monaco 標準の行削除に結び、Undo と複数カーソルも共通に扱う。
if (/Mac/.test(navigator.platform))
  monaco.editor.addKeybindingRule({
    keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backspace,
    command: 'editor.action.deleteLines',
    when: 'editorTextFocus && !editorReadonly',
  });

const connection = new Connection(() => workspaceRoot);
const request = connection.request;
const store = new DocumentStore(request, (path) => {
  // 定義のプレビュー (Peek) で読み込んだだけの文書も、編集されたら保存・破棄・競合の対象にするためタブとして開く。
  if (!opened.has(path)) {
    opened.add(path);
    rightOnly.delete(path);
  }
  diagnosticGeneration++;
  renderTabs();
  clearTimeout(checkingTimer);
  checkingTimer = setTimeout(safely(refreshDiagnostics), diagnosticsDelay);
});
const documents = store.documents;
const opened = new Set<string>();
const imagePaths = new Set<string>();
const rightOnly = new Set<string>();
let workspaceRoot = '';
let navigationGeneration = 0;
let settingsOpened = false;
let settingsGroup: EditorGroup = 'left';
// ファイルパスにはヌル文字が入らないので、どのタブのパスとも重ならない。
const settingsTabId = '\0settings';
const settingsHome = requireElement('main');
let mainView: MainView = 'editor';
let disposeSettings: (() => void) | undefined;
let active = '';
let fileNames: string[] = [];
let diagnosticGeneration = 0;
let checkingTimer: ReturnType<typeof setTimeout>;
let polling = false;
let gitRefresh: Promise<void> | undefined;
let choosingProject = true;
let historyStack: { path: string; position: monaco.IPosition }[] = [];
let noticeTimer: ReturnType<typeof setTimeout>;
const notice = (message = '', error = false): void => {
  clearTimeout(noticeTimer);
  if (error && requireElement<HTMLElement>('.workspace').hidden) {
    const fallback = byId('global-notice');
    fallback.hidden = false;
    byId('global-notice-message').textContent = message;
    return;
  }
  byId('global-notice').hidden = true;
  byId('notice-message').textContent = message;
  byId('notice').hidden = !message;
  byId('notice').classList.toggle('error', error);
  byId('notice').setAttribute('role', error ? 'alert' : 'status');
  if (message && !error)
    noticeTimer = setTimeout(() => {
      byId('notice').hidden = true;
    }, 5000);
};
byId('notice-close').onclick = () => notice();
byId('global-notice-close').onclick = () => notice();

/** 例外を通知に変換する入口。Error 以外や空のメッセージでも何かが表示される。 */
const reportError = (error: unknown): void => notice(errorMessage(error), true);
const safely = (task: () => Promise<unknown>) => (): void => {
  void task().catch(reportError);
};

// 埋め込みの文書を再読み込みするとホストとの接続も失われるため、既存の画面内で復帰する。
byId('global-notice-reload').textContent = 'Back to Projects';
byId('global-notice-reload').onclick = safely(async () => {
  const picker = document.querySelector<HTMLElement>('[data-project-picker]');
  if (picker) {
    notice();
    picker.querySelector<HTMLButtonElement>('button')?.focus();
    return;
  }
  if (store.hasDirty() && !(await confirmDialog('Discard unsaved changes and return to projects?')))
    return;
  await openProjectPicker();
});

const appearance = rendererTheme();
// テーマ「workbench」はまだ登録されていない。start() で setupHighlighting が登録するまでワークスペースを表示しないので、
// 未登録のテーマで描かれた画面は利用者に見えない。
const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: 'workbench',
  automaticLayout: true,
  fontSize: appearance.editorFontSize,
  lineHeight: appearance.editorLineHeight,
  fontFamily: appearance.fontFamily,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  // The tab bar already provides the gap above the first line.
  padding: { top: 0 },
  tabSize: 2,
  renderLineHighlight: 'all',
  smoothScrolling: true,
  ariaLabel: 'Code Editor',
  fixedOverflowWidgets: true,
};
const editor = monaco.editor.create(byId('editor'), editorOptions);
const toggleWrapping = registerWrapping(editor);
attachCodeNavigation(
  editor,
  byId('editor'),
  request,
  () => active,
  (path) => {
    showTool(false);
    requireElement<HTMLInputElement>('#filter').value = '';
    tree.search('');
    tree.reveal(path);
  },
);
attachDocumentPreview(editor, byId('editor'), requireElement('.toolbar')).id = 'editor-area';
const splitEditor = new SplitEditor(
  requireElement('.editor-stack'),
  editorOptions,
  (path) => {
    if (path === settingsTabId) closeSettings();
    else if (rightOnly.has(path)) void closeDocument(path).catch(reportError);
    else splitEditor.close(path);
  },
  (except) => void closeTabs(except).catch(reportError),
);
configureTabDrag(requireElement('.editor-stack'), splitEditor.pane, (path, source, target) => {
  void moveEditorTab(path, source, target).catch(reportError);
});
async function moveEditorTab(
  path: string,
  source: EditorGroup,
  target: EditorGroup,
): Promise<void> {
  if (path === settingsTabId) {
    moveSettings(target);
    return;
  }
  const openDocument = documents.get(path);
  if (!openDocument) return;
  if (target === 'right') {
    // 次に表示する左のタブは隣のもの。先頭に飛ばない。
    const paths = [...opened].filter((candidate) => !rightOnly.has(candidate));
    const index = paths.indexOf(path);
    const next = paths[index + 1] ?? paths[index - 1];
    rightOnly.add(path);
    if (active === path) openDocument.viewState = editor.saveViewState();
    splitEditor.open(path, openDocument.model, undefined, openDocument.viewState);
    if (active === path) {
      active = '';
      editor.setModel(null);
      if (next) await open(next);
      else annotations.clear();
    }
  } else {
    rightOnly.delete(path);
    await open(path);
    if (source === 'right') splitEditor.close(path);
  }
  renderTabs();
}

const terminal = new TerminalPanel(requireElement('.work-area'), request, notice);
const annotations = new Annotations({
  host: requireElement('main'),
  extensions: () => connection.extensions,
  report: notice,
  pasteTerminal: (text) => terminal.paste(text),
});
const editorSelection = annotations.bind(editor, () =>
  mainView !== 'editor' || !active ? undefined : { root: workspaceRoot, path: active },
);
annotations.bind(splitEditor.editor, () =>
  splitEditor.path ? { root: workspaceRoot, path: splitEditor.path } : undefined,
);
const tree = new FileTree(
  byId('files'),
  (path) => {
    void open(path).catch(reportError);
  },
  (path, directory, include) => {
    void (async () => {
      const settings = await request({ op: 'settings-get' });
      const matching = settings.analysisExcludedPaths.filter((entry) =>
        isExcludedPath(path, directory, [entry]),
      );
      // 親や全階層のルールを解除する場合は、選択項目以外にも影響することを伝える。
      if (
        include &&
        matching.some(
          (entry) => entry !== `./${path}` && !(entry.includes('/') && entry === path),
        ) &&
        (await fileDialog({
          title: 'Include in Analysis',
          description: `Remove these exclusion rules?\n\n${matching.join('\n')}\n\nOther files covered by these rules will also be included.`,
          accept: 'Include in Analysis',
        })) === undefined
      )
        return;
      const updated = await request({
        op: 'settings-set',
        analysisExcludedPaths: include
          ? settings.analysisExcludedPaths.filter((entry) => !matching.includes(entry))
          : [...new Set([...settings.analysisExcludedPaths, `./${path}`])],
      });
      updateSettingsView(updated);
      await refresh();
      await refreshDiagnostics();
      notice(
        include ? 'Included in analysis.' : 'Excluded from analysis. Still available in Project.',
      );
    })().catch(reportError);
  },
  (action, path, directory) => {
    void explorerAction(action, path, directory).catch(reportError);
  },
  (recursive) => {
    if (choosingProject) return;
    void refresh(false, recursive).catch(reportError);
  },
);
type FileClipboard = { path: string; move: boolean };
let fileClipboard: FileClipboard | undefined;
let changingFiles = false;
const withinEntry = (entry: string, candidate: string): boolean =>
  !entry || candidate === entry || candidate.startsWith(`${entry}/`);
const parentPath = (path: string): string => path.split('/').slice(0, -1).join('/');
const childPath = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name);

async function explorerAction(
  action: ExplorerAction,
  path: string,
  directory: boolean,
): Promise<void> {
  if (changingFiles || choosingProject) return;
  if (action === 'absolute-path' || action === 'relative-path' || action === 'file-name') {
    const value =
      action === 'absolute-path'
        ? childPath(workspaceRoot, path).replace(/\/$/, '')
        : action === 'relative-path'
          ? path || '.'
          : ((path || workspaceRoot).split('/').at(-1) ?? '');
    await navigator.clipboard.writeText(value);
    notice(`Copied: ${value}`);
    return;
  }
  if (action === 'cut' || action === 'copy') {
    fileClipboard = { path, move: action === 'cut' };
    tree.setClipboard(true);
    notice(
      `${action === 'cut' ? 'Cut' : 'Copied'} ${path}. Choose a destination folder and Paste.`,
    );
    return;
  }
  if (action === 'diff') {
    await gitPanel.open(path);
    return;
  }
  // 応答待ちの間も編集できると、移動後に古いパスのバッファが残る。操作完了までワークスペースの入力を止める。
  changingFiles = true;
  const shell = requireElement<HTMLElement>('.workspace');
  shell.inert = true;
  let focusPath = path;
  let focusEditor = false;
  let reopenPath = '';
  try {
    const folder = directory ? path : parentPath(path);
    let destination = '';
    const clipboard = fileClipboard;
    if (action === 'new-file' || action === 'new-directory' || action === 'rename') {
      const name = await fileDialog({
        title:
          action === 'rename' ? 'Rename' : action === 'new-file' ? 'New File' : 'New Directory',
        description: action === 'rename' ? path : `In ${folder || workspaceRoot}`,
        initialName: action === 'rename' ? (path.split('/').at(-1) ?? '') : '',
        accept: action === 'rename' ? 'Rename' : 'Create',
      });
      if (name === undefined) return;
      if (!name || name === '.' || name === '..' || /[/\\]/.test(name))
        throw new Error('Enter a single file or directory name.');
      destination = childPath(action === 'rename' ? parentPath(path) : folder, name);
      if (action === 'rename' && destination === path) return;
    } else if (action === 'paste') {
      if (!clipboard) return;
      destination = childPath(folder, clipboard.path.split('/').at(-1) ?? '');
    }
    const source = action === 'paste' ? (clipboard?.path ?? path) : path;
    const affected = (): string[] =>
      [...documents.keys()].filter((candidate) => withinEntry(source, candidate));
    if (
      action === 'delete' &&
      (await fileDialog({
        title: 'Permanently Delete',
        description: `Delete "${path}"${directory ? ' and all its contents' : ''}? This cannot be undone.`,
        accept: 'Delete Permanently',
      })) === undefined
    )
      return;
    if (
      action === 'reload' &&
      hasUnsavedChanges(affected()) &&
      (await fileDialog({
        title: 'Reload from Disk',
        description: 'Discard unsaved changes in the selected file or folder?',
        accept: 'Discard and Reload',
      })) === undefined
    )
      return;

    await connection.settle();
    if (action === 'reload') {
      for (const candidate of affected()) await store.reload(candidate);
      if (!directory && !documents.has(path)) await open(path);
      else if (imagePaths.has(active) && withinEntry(path, active)) await open(active);
    } else {
      if (action !== 'new-file' && action !== 'new-directory' && hasUnsavedChanges(affected()))
        throw new Error('Save the files in this selection before changing or copying them.');
      const removesSource =
        action === 'rename' || action === 'delete' || (action === 'paste' && clipboard?.move);
      if (action === 'new-file' || action === 'new-directory') {
        await request({
          op: 'file-create',
          path: destination,
          directory: action === 'new-directory',
        });
      } else if (action === 'delete') await request({ op: 'file-delete', path });
      else
        await request({
          op: 'file-transfer',
          path: source,
          destination,
          move: action === 'rename' || !!clipboard?.move,
        });
      if (removesSource) {
        if (action !== 'delete' && active && withinEntry(source, active))
          reopenPath = destination + active.slice(source.length);
        navigationGeneration++;
        const previousFile = localStorage.getItem(`code-file:${workspaceRoot}`);
        if (previousFile && withinEntry(source, previousFile))
          localStorage.removeItem(`code-file:${workspaceRoot}`);
        for (const candidate of new Set([...opened, ...documents.keys()])) {
          if (withinEntry(source, candidate)) removeTab(candidate);
        }
        recentFiles = recentFiles.filter((candidate) => !withinEntry(source, candidate));
        historyStack = historyStack.filter((entry) => !withinEntry(source, entry.path));
        if (fileClipboard && withinEntry(source, fileClipboard.path)) {
          fileClipboard = undefined;
          tree.setClipboard(false);
        }
      }
    }
    await refresh();
    await refreshDiagnostics();
    renderTabs();
    if (reopenPath || action === 'new-file' || (action === 'rename' && !directory)) {
      await open(reopenPath || destination);
      focusEditor = true;
    } else if (destination) {
      tree.reveal(destination);
      focusPath = destination;
    }
    notice(action === 'reload' ? 'Reloaded from disk.' : 'Project files updated.');
  } finally {
    shell.inert = false;
    changingFiles = false;
    if (focusEditor) editor.focus();
    else
      byId('files')
        .querySelector<HTMLElement>(`[data-path="${CSS.escape(focusPath)}"]`)
        ?.focus();
  }
}

function renderFiles(): void {
  tree.reveal(active);
}
const renderFileTabs = createFileTabs(byId('tabs'));
let recentFiles: string[] = [];
function renderTabs(): void {
  const paths = [...opened].filter((path) => !rightOnly.has(path));
  const tabs: Parameters<typeof renderFileTabs>[0] = paths.map((path) => {
    const openDocument = documents.get(path);
    if (!openDocument && !imagePaths.has(path))
      throw new Error(`Open tab has no document: ${path}`);
    const name = path.split('/').at(-1) ?? path;
    const label =
      paths.filter((other) => other.split('/').at(-1) === name).length > 1 ? path : name;
    return {
      id: path,
      title: path,
      label: `${label}${openDocument && isDirty(openDocument) ? ' ●' : ''}${openDocument?.conflict || openDocument?.missing ? ' ⚠' : ''}`,
      active: path === active && mainView !== 'settings',
      settings: false,
      open: safely(() => open(path)),
      close: safely(() => closeDocument(path)),
      draggable: !!openDocument,
      split: openDocument
        ? (direction: SplitDirection) =>
            // 表示中の文書は今の選択・スクロールを、他は最後に表示していた状態を右側へ引き継ぐ。
            splitEditor.open(
              path,
              openDocument.model,
              direction,
              active === path ? editor.saveViewState() : openDocument.viewState,
            )
        : undefined,
      wrap: openDocument
        ? safely(async () => {
            await open(path);
            toggleWrapping();
          })
        : undefined,
    };
  });
  if (settingsOpened && settingsGroup === 'left')
    tabs.push({
      id: settingsTabId,
      title: 'Settings',
      label: 'Settings',
      active: mainView === 'settings',
      settings: true,
      open: safely(showSettings),
      close: closeSettings,
      split: (direction) => moveSettings('right', direction),
    });
  renderFileTabs(
    tabs.map((tab) => ({
      ...tab,
      closeAll: safely(() => closeTabs()),
      closeOthers: safely(() => closeTabs(tab.id)),
    })),
  );
  const empty = mainView === 'editor' && !active;
  byId('image-view').hidden = mainView !== 'editor' || !imagePaths.has(active);
  byId('editor-area').hidden = mainView !== 'editor' || empty || imagePaths.has(active);
  requireElement<HTMLElement>('.toolbar').hidden = mainView !== 'editor' || empty;
  byId('recent-files').hidden = !empty;
  if (empty)
    showRecentFiles(byId('recent-files'), recentFiles, (path) => safely(() => open(path))());
  const activeDocument = documents.get(active);
  const anyDirty = store.hasDirty();
  byId('save').hidden = !anyDirty;
  // 競合した文書は保存時にサーバーが拒否して知らせる。他の文書の保存までは止めない。
  byId<HTMLButtonElement>('save').disabled = ![...documents.values()].some(
    (candidate) => isDirty(candidate) && !candidate.conflict,
  );
  byId('reload').hidden = !activeDocument || (!isDirty(activeDocument) && !activeDocument.conflict);
}
/** パスごとに閉じた回数。読み込み中の open() が、その間に閉じられたタブを開き直さないために使う。 */
const removals = new Map<string, number>();
/** タブを状態から外す。同期処理だけなので、await をまたいで古い前提で動くことがない。 */
function removeTab(path: string): void {
  removals.set(path, (removals.get(path) ?? 0) + 1);
  const wasActive = active === path;
  opened.delete(path);
  imagePaths.delete(path);
  rightOnly.delete(path);
  if (wasActive) {
    active = '';
    editor.setModel(null);
    showImage(byId('image-view'));
    if (mainView === 'editor') annotations.clear();
    tree.reveal('');
  }
  gitPanel.release(path);
  splitEditor.close(path);
  store.close(path);
  markerScopes.delete(path);
  renderTabs();
}
function hasUnsavedChanges(paths: Iterable<string>): boolean {
  return [...paths].some((path) => {
    const openDocument = documents.get(path);
    return !!openDocument && isDirty(openDocument);
  });
}
async function closeTabs(except?: string): Promise<void> {
  const paths = [...opened].filter((path) => path !== except);
  if (
    hasUnsavedChanges(paths) &&
    !(await confirmDialog('Discard unsaved changes and close these tabs?'))
  )
    return;
  const activeClosed = paths.includes(active);
  for (const path of paths) removeTab(path);
  if (except === settingsTabId) await showSettings();
  else if (settingsOpened) closeSettings();
  // 右の文書を残す「他を閉じる」では左は空のままにする。open() は文書を左へ移すため。
  if (activeClosed && except && opened.has(except) && !rightOnly.has(except))
    await open(except, undefined, false);
  // 閉じたバッファをサーバーから外す。refreshDiagnostics が最初に未保存の本文を同期し直す。
  await refreshDiagnostics();
}
async function closeDocument(path: string): Promise<void> {
  const openDocument = documents.get(path);
  if (!openDocument && !imagePaths.has(path)) return;
  if (
    hasUnsavedChanges([path]) &&
    !(await confirmDialog('Discard unsaved changes and close this tab?'))
  )
    return;
  // 次に表示するタブは、状態を変える前に決める。
  const paths = [...opened].filter((candidate) => !rightOnly.has(candidate));
  const index = paths.indexOf(path);
  const next = active === path ? (paths[index + 1] ?? paths[index - 1]) : undefined;
  removeTab(path);
  if (next) await open(next, undefined, false);
  await refreshDiagnostics();
}

async function open(
  path: string,
  target?: Location | monaco.IPosition,
  remember = true,
): Promise<void> {
  const generation = ++navigationGeneration;
  const removedBefore = removals.get(path) ?? 0;
  const image = imageType(path) ? await request({ op: 'image-read', path }) : undefined;
  const openDocument = image ? undefined : await store.load(path);
  // 遅い読み込みが、その後に開いた別のファイルや設定画面からフォーカスを奪わない。
  if (generation !== navigationGeneration) return;
  // 読み込み中に閉じられたタブは開き直さない。読み込んだモデルも残さない。
  if ((removals.get(path) ?? 0) !== removedBefore) {
    store.close(path);
    return;
  }
  setMainView('editor');
  gitPanel.close();
  if (remember && active && (path !== active || target)) {
    historyStack.push({
      path: active,
      position: editor.getPosition() ?? { lineNumber: 1, column: 1 },
    });
    if (historyStack.length > historyLimit) historyStack.shift();
  }
  const previous = documents.get(active);
  if (previous) previous.viewState = editor.saveViewState();
  rightOnly.delete(path);
  opened.add(path);
  if (image) imagePaths.add(path);
  showImage(byId('image-view'), image?.src, path);
  active = path;
  recentFiles = [path, ...recentFiles.filter((candidate) => candidate !== path)].slice(
    0,
    recentFilesLimit,
  );
  editor.setModel(openDocument?.model ?? null);
  if (!target && openDocument?.viewState) editor.restoreViewState(openDocument.viewState);
  if (target) {
    const position = 'line' in target ? { lineNumber: target.line, column: target.column } : target;
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
  }
  const filter = byId<HTMLInputElement>('filter');
  if (filter.value && !path.toLowerCase().includes(filter.value.trim().toLowerCase())) {
    filter.value = '';
    tree.search('');
  }
  notice();
  renderFiles();
  renderTabs();
  // タブが無く隠れていたエディタ領域が表示されたとき、表示前の 0 サイズのままにしない。
  editor.layout();
  editor.focus();
  if (!connection.embedded && workspaceRoot)
    localStorage.setItem(`code-file:${workspaceRoot}`, path);
  void refreshDiagnostics().catch(reportError);
  if (openDocument?.conflict)
    notice(
      'The file changed on disk. Your edits are preserved. Copy any edits you need before reloading.',
      true,
    );
}

function syncAll(): Promise<void> {
  return store.sync(opened);
}

function range(location: Location): monaco.IRange {
  return {
    startLineNumber: location.line,
    startColumn: location.column,
    endLineNumber: location.endLine,
    endColumn: location.endColumn,
  };
}
/** 解析の対象になるカーソル位置。未保存の本文を送ってから、サーバーに渡すパスと位置を返す。 */
async function cursorTarget(
  model = editor.getModel(),
  position = editor.getPosition(),
): Promise<{ path: string; position: number } | undefined> {
  if (!model || !position || !semanticLanguages.includes(model.getLanguageId())) return undefined;
  await syncAll();
  const entry = [...documents].find(([, candidate]) => candidate.model === model);
  if (!entry) return undefined;
  return { path: entry[0], position: model.getOffsetAt(position) };
}
async function jump(): Promise<void> {
  const target = await cursorTarget();
  const locations = target ? (await request({ op: 'definition', ...target })).locations : [];
  if (!locations.length) {
    notice('No definition found in this project. Place the cursor on a symbol.');
    return;
  }
  if (locations.length === 1) await open(locations[0].path, locations[0]);
  else showLocations(locations);
}
function showPanel(name: string): void {
  byId('results').hidden = false;
  for (const [id, tab] of [
    ['problems', 'problems-tab'],
    ['refs', 'refs-tab'],
  ]) {
    byId(id).hidden = id !== name;
    byId(tab).classList.toggle('active', id === name);
  }
}
function locationButton(location: Location, message: string, prefix = ''): HTMLButtonElement {
  const button = createButton({
    className:
      'flex w-full flex-col items-start rounded-control px-2 py-2 text-left justify-start hover:bg-accent [&_strong]:text-caption [&_strong]:font-medium [&_strong]:text-muted-foreground [&_span]:font-mono [&_span]:text-caption [&_span]:whitespace-pre-wrap',
  });

  const title = document.createElement('strong');
  title.textContent = `${prefix}${location.path}:${location.line}:${location.column}`;
  const detail = document.createElement('span');
  detail.textContent = message;
  button.append(title, detail);
  button.onclick = safely(() => open(location.path, location));
  return button;
}
function showLocations(locations: Location[]): void {
  byId('refs-count').textContent = String(locations.length);
  byId('refs').replaceChildren(
    ...locations.map((location) => locationButton(location, location.preview)),
  );
  if (!locations.length) byId('refs').textContent = 'No references found.';
  showPanel('refs');
}
/** 文書ごとに、今付いている診断の印を出した tsconfig (診断の scope)。 */
const markerScopes = new Map<string, string>();
/** 未保存の本文を同期してから診断を取り直し、Problems パネルとエディタの印を更新する。 */
async function refreshDiagnostics(): Promise<void> {
  if (choosingProject) return;
  const generation = ++diagnosticGeneration;
  // Markdown や画像を表示中も、開いているソースの診断を保つ。
  const path = isSource(active) ? active : ([...opened].find(isSource) ?? '');
  await syncAll();
  if (!isSource(path)) {
    byId('problems').replaceChildren();
    byId('problem-count').textContent = '0';
    byId('problems-toggle').textContent = '✓';
    byId('problems-toggle').classList.remove('text-destructive');
    return;
  }
  const { diagnostics, scope } = await request({ op: 'diagnostics', path });
  if (generation !== diagnosticGeneration) return;
  byId('problem-count').textContent = String(diagnostics.length);
  byId('problems-toggle').textContent = diagnostics.length ? `⚠ ${diagnostics.length}` : '✓';
  byId('problems-toggle').classList.toggle('text-destructive', diagnostics.length > 0);
  byId('problems').replaceChildren(
    ...diagnostics.map((diagnostic) =>
      locationButton(diagnostic, diagnostic.message, `TS${diagnostic.code} · `),
    ),
  );
  if (!diagnostics.length) byId('problems').textContent = 'No problems';
  const byPath = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics)
    byPath.set(diagnostic.path, [...(byPath.get(diagnostic.path) ?? []), diagnostic]);
  for (const [path, openDocument] of documents) {
    const own = byPath.get(path);
    // 印を更新するのは、この tsconfig の診断に現れた文書と、前回この tsconfig の印を付けた文書だけ。
    // 別の tsconfig に属する文書の印は、その文書の診断を取るまで残す。
    if (!own && markerScopes.get(path) !== scope) continue;
    if (own && scope !== null) markerScopes.set(path, scope);
    else markerScopes.delete(path);
    monaco.editor.setModelMarkers(
      openDocument.model,
      'typescript',
      (own ?? []).map((diagnostic) => ({
        ...range(diagnostic),
        message: diagnostic.message,
        severity:
          diagnostic.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        code: String(diagnostic.code),
      })),
    );
  }
}

async function saveAll(): Promise<void> {
  const problems = await store.save(opened);
  notice(problems.join('\n'), problems.length > 0);
  renderTabs();
  await refreshDiagnostics();
}

for (const id of semanticLanguages)
  monaco.languages.registerHoverProvider(id, {
    async provideHover(model, position, cancellation) {
      const target = await cursorTarget(model, position);
      if (!target) return null;
      const { info } = await request({ op: 'hover', ...target });
      if (!info?.location || cancellation.isCancellationRequested) return null;
      return {
        range: range(info.location),
        contents: [
          { value: `\`\`\`typescript\n${info.signature}\n\`\`\`` },
          { value: info.documentation },
        ],
      };
    },
  });
for (const id of semanticLanguages)
  monaco.languages.registerDefinitionProvider(id, {
    async provideDefinition(model, position) {
      const target = await cursorTarget(model, position);
      if (!target) return [];
      const { locations } = await request({ op: 'definition', ...target });
      return Promise.all(
        locations.map(async (location) => ({
          uri: (await store.load(location.path)).model.uri,
          range: range(location),
        })),
      );
    },
  });
monaco.editor.registerEditorOpener({
  async openCodeEditor(_source, resource, selection) {
    const entry = [...documents].find(
      ([, candidate]) => candidate.model.uri.toString() === resource.toString(),
    );
    if (!entry) return false;
    const position =
      selection &&
      ('startLineNumber' in selection
        ? { lineNumber: selection.startLineNumber, column: selection.startColumn }
        : selection);
    await open(entry[0], position);
    return true;
  },
});

const goBack = async (): Promise<void> => {
  const previous = historyStack.pop();
  if (previous) await open(previous.path, previous.position, false);
};
byId('save').onclick = safely(saveAll);
function setMainView(view: MainView): void {
  mainView = view;
  requireElement('main').dataset.view = view;
  byId('editor-area').hidden = view !== 'editor';
  byId('diff-view').hidden = view !== 'diff';
  if (settingsGroup === 'left') byId('settings-view').hidden = view !== 'settings';
  requireElement<HTMLElement>('.toolbar').hidden = view !== 'editor';
  requireElement('main').classList.toggle('settings-active', view === 'settings');
  if (view !== 'editor') byId('results').hidden = true;
  if (view === 'editor') {
    editor.layout();
    if (active) editorSelection.refresh();
    else annotations.clear();
  } else annotations.clear();
  renderTabs();
}
let defaultWordWrap: boolean | undefined;
/** 外観設定 (文字サイズと折り返しの既定) をエディタ・差分・ターミナルに反映する。 */
function applyAppearance(value: Appearance): void {
  const wordWrap = value.wordWrap ?? false;
  if (wordWrap !== defaultWordWrap) {
    defaultWordWrap = wordWrap;
    for (const target of [editor, splitEditor.editor])
      target.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' });
  }
  applyFontSizeTokens(value);
  const theme = rendererTheme();
  editor.updateOptions({ fontSize: theme.editorFontSize, lineHeight: theme.editorLineHeight });
  splitEditor.editor.updateOptions({
    fontSize: theme.editorFontSize,
    lineHeight: theme.editorLineHeight,
  });
  gitPanel.updateFontSize();
  terminal.updateFontSize();
}
async function showSettings(): Promise<void> {
  navigationGeneration++;
  gitPanel.close();
  if (settingsGroup === 'left') setMainView('settings');
  else splitEditor.openSettingsView(settingsTabId, byId('settings-view'), 'Settings');
  const load = !settingsOpened;
  settingsOpened = true;
  renderTabs();
  if (load)
    disposeSettings = openSettings(
      byId('settings-view'),
      workspaceRoot,
      request,
      applyAppearance,
      async () => {
        await refresh();
        await refreshDiagnostics();
      },
    );
  // 初回は設定画面が自分でフォーカスを移す。2 回目以降の再表示はここで移す。
  byId('settings-view').querySelector<HTMLButtonElement>('[role=tab][data-state=active]')?.focus();
}
function moveSettings(group: EditorGroup, direction?: SplitDirection): void {
  settingsGroup = group;
  if (group === 'right') {
    // DOM を移して設定の入力途中の値と選択中のセクションを保つ。
    splitEditor.openSettingsView(settingsTabId, byId('settings-view'), 'Settings', direction);
    setMainView('editor');
  } else {
    splitEditor.close(settingsTabId);
    settingsHome.append(byId('settings-view'));
    setMainView('settings');
    byId('settings-view')
      .querySelector<HTMLElement>('[role=tab][aria-selected=true], input')
      ?.focus();
  }
  renderTabs();
}
function closeSettings(): void {
  const wasActive = mainView === 'settings';
  if (settingsGroup === 'right') {
    splitEditor.close(settingsTabId);
    settingsHome.append(byId('settings-view'));
    settingsGroup = 'left';
  }
  byId('settings-view').hidden = true;
  settingsOpened = false;
  if (wasActive) setMainView('editor');
  disposeSettings?.();
  disposeSettings = undefined;
  renderTabs();
  if (wasActive) editor.focus();
}
byId('settings-tool').onclick = safely(showSettings);
byId('reload').onclick = safely(() => explorerAction('reload', active, false));
byId('filter').oninput = () => tree.search(byId<HTMLInputElement>('filter').value);
const closeResults = (): void => {
  byId('results').hidden = true;
  editor.focus();
};
byId('close-results').onclick = closeResults;
byId('results').onkeydown = (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeResults();
  }
};
for (const [tab, panel] of [
  ['problems-tab', 'problems'],
  ['refs-tab', 'refs'],
])
  byId(tab).onclick = () => showPanel(panel);
let workspaceRevision: number | undefined;
let workspaceRequest = 0;
async function refresh(revealActive = true, recursive?: string): Promise<WorkspaceInfo> {
  const version = ++workspaceRequest;
  const data = await request({
    op: 'workspace',
    expanded: tree.expandedPaths,
    recursive: tree.searching ? '' : recursive,
  });
  if (version !== workspaceRequest) return data;
  workspaceRevision = data.revision;
  fileNames = data.files;
  workspaceRoot = data.root;
  tree.setProject(data.name, data.root);
  document.title = `${data.name} — Plasma`;
  tree.setFiles(fileNames, data.directories, data.analysisExcludedPaths, data.symlinks);
  if (revealActive && active) tree.reveal(active);
  await refreshGit();
  return data;
}
let gitState: GitStatus = emptyGitStatus();
const gitPanel = new GitPanel({
  panel: byId('git-panel'),
  view: byId('diff-view'),
  request,
  language: languageFor,
  onDiff: () => {
    navigationGeneration++;
    setMainView('diff');
  },
  onClose: () => {
    if (mainView === 'diff') setMainView('editor');
  },
  report: (message) => notice(message, true),
  annotations,
  root: () => workspaceRoot,
  loadWorkingModel: async (path) => {
    const openDocument = await store.load(path);
    opened.add(path);
    renderTabs();
    return openDocument.model;
  },
  openFile: open,
  save: saveAll,
  hasUnsaved: hasUnsavedChanges,
  onCommitted: async () => {
    // コミット前に始まった取得は古い一覧を返す。その完了を待ってから取り直し、更新済みの一覧で差分を開き直す。
    await gitRefresh?.catch(() => undefined);
    await refreshGit();
    await gitPanel.refreshSelection();
  },
});
let historyOpen = false;
const historyDock = new ToolDock(
  requireElement('.work-area'),
  byId('git-history-view'),
  () => setHistoryOpen(!historyOpen),
  {
    id: 'history',
    label: 'Git History',
    initialSide: 'bottom',
    button: byId<HTMLButtonElement>('git-history-tool'),
    // 他のドックに押し出されて隠れたときも通る。履歴が無いとどのコミットの差分か分からないので、コミットの差分も閉じる。
    onHide: () => {
      historyOpen = false;
      unmountReact(byId('git-history-view'));
      gitPanel.releaseCommit();
    },
  },
);
function setHistoryOpen(visible: boolean): void {
  historyOpen = visible;
  const host = byId('git-history-view');
  historyDock.setVisible(visible);
  if (!visible) return;
  showGitHistory(host, {
    root: workspaceRoot,
    request,
    onClose: () => setHistoryOpen(false),
    onSelect: () => gitPanel.close(),
    onFile: (path, commit) => {
      void gitPanel.open(path, commit).catch(reportError);
    },
  });
}

function showTool(git: boolean): void {
  byId('project-panel').hidden = git;
  byId('git-panel').hidden = !git;
  byId('panel-title').textContent = git ? 'Git' : 'Project';
  byId('project-tool').classList.toggle('active', !git);
  byId('git-tool').classList.toggle('active', git);
  byId('reveal').hidden = git;
}
function refreshGit(): Promise<void> {
  // 前回の取得が終わっていなければ重ねず、その結果を待つ。git status が遅いときに要求が溜まらないようにする。
  gitRefresh ??= fetchGitStatus().finally(() => {
    gitRefresh = undefined;
  });
  return gitRefresh;
}
async function fetchGitStatus(): Promise<void> {
  {
    const state = await request({ op: 'git-status' });
    renderReact(
      byId('workspace-header'),
      createElement(WorkspaceHeader, {
        key: workspaceRoot,
        root: workspaceRoot,
        branch: state.branch,
        request,
        onProject: async (root) => {
          if (
            store.hasDirty() &&
            !(await confirmDialog('Discard unsaved changes and switch projects?'))
          )
            return;
          await openProjectPicker(undefined, root);
        },
        onBranch: async (branch) => {
          if (store.hasDirty())
            throw new Error('Save or discard unsaved edits before switching branches.');
          const shell = requireElement<HTMLElement>('.workspace');
          changingFiles = true;
          shell.inert = true;
          try {
            await request({ op: 'git-switch', branch });
            // 切り替え前のモデルや履歴を残さず、同じプロジェクトの新しいディスク状態から再構築する。
            await openProjectPicker(undefined, workspaceRoot);
          } finally {
            shell.inert = false;
            changingFiles = false;
          }
        },
        report: (message) => notice(message, true),
      }),
    );
    byId('git-tool').title = `Git Changes · ${state.entries.length} files`;
    if (JSON.stringify(state) !== JSON.stringify(gitState)) {
      gitState = state;
      tree.setStatuses(state.entries, state.ignoredPaths);
      gitPanel.update(state);
    }
  }
}
byId('project-tool').onclick = () => {
  showTool(false);
  gitPanel.close();
};
byId('git-tool').onclick = safely(async () => {
  showTool(true);
  await refreshGit();
});
byId('reveal').addEventListener('click', () => {
  byId<HTMLInputElement>('filter').value = '';
  tree.search('');
  tree.reveal(active);
});
byId('expand').addEventListener('click', () => {
  if (!byId('git-panel').hidden) gitPanel.expandSelected();
  else tree.expandSelected();
});
byId('collapse').addEventListener('click', () => {
  if (!byId('git-panel').hidden) gitPanel.collapseAll();
  else tree.collapseAll();
});
let closingFile = false;
window.addEventListener(
  'keydown',
  (event) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== 'w' ||
      choosingProject
    )
      return;
    const target = event.target as HTMLElement;
    if (target.closest('#terminal-panel,.annotation-panel,input,textarea')) return;
    // Cmd/Ctrl+W でブラウザのタブが閉じないように既定の動作を止め、他のキーハンドラにも渡さない。
    // ターミナル・注釈・入力欄の中では上で return しているので、その操作には影響しない。
    event.preventDefault();
    event.stopImmediatePropagation();
    if (changingFiles) return;
    if (splitEditor.pane.contains(target)) {
      const path = splitEditor.path;
      if (path === settingsTabId) closeSettings();
      else if (rightOnly.has(path)) void closeDocument(path).catch(reportError);
      else splitEditor.close();
      return;
    }
    if (mainView === 'settings') {
      closeSettings();
      return;
    }
    if (closingFile) return;
    if (mainView === 'diff') {
      gitPanel.close();
      return;
    }
    if (!active) return;
    closingFile = true;
    void closeDocument(active)
      .catch(reportError)
      .finally(() => {
        closingFile = false;
      });
  },
  true,
);
function toggleProblems(): void {
  if (mainView !== 'editor') return;
  if (!byId('results').hidden && !byId('problems').hidden) closeResults();
  else showPanel('problems');
}
byId('problems-toggle').onclick = toggleProblems;
window.addEventListener('keydown', (event) => {
  if (changingFiles || event.defaultPrevented) return;
  if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    toggleProblems();
  }
  if (event.metaKey && event.key === '1') {
    event.preventDefault();
    showTool(false);
    byId('files').querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }
  if (event.key === 'Escape' && mainView === 'diff') gitPanel.close();
});
byId('refresh').addEventListener(
  'click',
  safely(async () => {
    await refresh();
    await refreshDiagnostics();
    await gitPanel.refreshSelection();
  }),
);
editor.addAction({
  id: 'workbench.definition',
  label: 'Go to Definition',
  contextMenuGroupId: 'navigation',
  keybindings: [monaco.KeyCode.F12],
  run: () => jump().catch(reportError),
});
editor.addAction({
  id: 'workbench.references',
  label: 'Find References',
  contextMenuGroupId: 'navigation',
  keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
  run: safely(async () => {
    const target = await cursorTarget();
    showLocations(target ? (await request({ op: 'references', ...target })).locations : []);
  }),
});
for (const codeEditor of [editor, splitEditor.editor])
  codeEditor.addAction({
    id: 'workbench.save',
    label: 'Save All',
    contextMenuGroupId: 'modification',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
    run: () => saveAll().catch(reportError),
  });
editor.addAction({
  id: 'workbench.back',
  label: 'Back',
  contextMenuGroupId: 'navigation',
  keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow],
  run: () => goBack().catch(reportError),
});
editor.addAction({
  id: 'workbench.type',
  label: 'Show Type',
  contextMenuGroupId: 'navigation',
  run: safely(async () => {
    const target = await cursorTarget();
    const info = target ? (await request({ op: 'hover', ...target })).info : null;
    notice(
      info
        ? `${info.signature}${info.documentation ? ` — ${info.documentation}` : ''}`
        : 'No type information',
    );
  }),
});
const resize = byId('resize');
new ResizeObserver(() => {
  resize.setAttribute(
    'aria-valuenow',
    String(Math.round(byId('sidebar').getBoundingClientRect().width)),
  );
}).observe(byId('sidebar'));
function resizeSidebar(width: number): void {
  const clamped = Math.max(
    sidebarWidth.min,
    Math.min(sidebarWidth.max, window.innerWidth * 0.5, width),
  );
  byId('sidebar').style.width = `${clamped}px`;
  resize.setAttribute('aria-valuenow', String(Math.round(clamped)));
}
resize.onpointerdown = (event) => {
  resize.setPointerCapture(event.pointerId);
  resize.classList.add('dragging');
};
resize.onpointermove = (event) => {
  if (resize.hasPointerCapture(event.pointerId))
    resizeSidebar(event.clientX - byId('sidebar').getBoundingClientRect().left);
};
resize.onpointerup = (event) => {
  resize.releasePointerCapture(event.pointerId);
  resize.classList.remove('dragging');
};
resize.onlostpointercapture = () => resize.classList.remove('dragging');
resize.onkeydown = (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    resizeSidebar(
      byId('sidebar').getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -20 : 20),
    );
  }
};
window.addEventListener('beforeunload', (event) => {
  if (store.hasDirty()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function poll(): Promise<void> {
  if (choosingProject || changingFiles || polling || document.hidden) return;
  polling = true;
  try {
    const root = workspaceRoot;
    // 更新前の MCP プロセスは revision を返さない。再起動までは既存の文書監視だけを続ける。
    const revision =
      workspaceRevision === undefined
        ? undefined
        : (await request({ op: 'workspace-revision' })).revision;
    if (choosingProject || root !== workspaceRoot) return;
    const workspaceChanged = revision !== workspaceRevision;
    // 連続した変更をポーリング間隔でまとめ、選択や折りたたみを維持して取り込む。
    if (workspaceChanged) await refresh(false);
    const { changed, conflicts, missing } = await store.refresh(opened);
    if (choosingProject || root !== workspaceRoot) return;
    if (conflicts.includes(active))
      notice('The file changed on disk. Your unsaved edits are preserved.', true);
    if (missing.length)
      notice(
        `${missing.join(', ')}: no longer on disk. Copy any text you need, then close the tab.`,
        true,
      );
    if (changed || conflicts.length || missing.length) renderTabs();
    if (changed || workspaceChanged) await refreshDiagnostics();
    if (workspaceChanged) await gitPanel.refreshSelection();
  } catch (error) {
    reportError(error);
  } finally {
    polling = false;
  }
}

let selectLinkedProject: ((target: FileTarget) => Promise<void>) | undefined;
let linkedNavigation: Promise<void> = Promise.resolve();
async function openTarget(target: FileTarget): Promise<void> {
  if (selectLinkedProject) return selectLinkedProject(target);
  if (workspaceRoot !== target.project) {
    if (
      store.hasDirty() &&
      !(await confirmDialog('Discard unsaved changes and open the linked project?'))
    )
      return;
    await openProjectPicker(target);
    return;
  }
  await openTargetFile(target);
}
async function openTargetFile(target: FileTarget): Promise<void> {
  await open(target.file, { lineNumber: target.line, column: 1 });
  const model = editor.getModel();
  if (!model) return;
  const start = Math.min(target.line, model.getLineCount());
  const end = Math.min(target.endLine, model.getLineCount());
  editor.setSelection({
    startLineNumber: start,
    startColumn: 1,
    endLineNumber: end,
    endColumn: model.getLineMaxColumn(end),
  });
  editor.revealLineInCenter(start);
}
/**
 * 現在のワークスペースを閉じて、別のプロジェクトへ移る。
 * target か project があればそのプロジェクトを直接開き、どちらもなければ選択画面を出す。
 */
/**
 * 前回開いていたファイルを開く。ツリーはルート直下しか取得していないので、一覧ではなくファイルの有無で決める。
 * 開けば展開も追従する (reveal が未取得の階層を取りに行く)。
 */
async function restoreLastFile(): Promise<boolean> {
  const previous = connection.embedded ? null : localStorage.getItem(`code-file:${workspaceRoot}`);
  if (!previous) return false;
  try {
    await open(previous);
    return true;
  } catch {
    return false;
  }
}
async function openProjectPicker(target?: FileTarget, project?: string): Promise<void> {
  // リンク先のプロジェクトを開けることを確かめてから、現在のワークスペースで開いている文書とモデルを破棄する。
  const destination = target?.project ?? project;
  const linked = destination ? await openProject(request, destination) : undefined;
  if (destination && !linked) return;
  navigationGeneration++;
  choosingProject = true;
  fileClipboard = undefined;
  tree.setClipboard(false);
  const shell = requireElement<HTMLElement>('.workspace');
  shell.hidden = true;
  clearTimeout(checkingTimer);
  diagnosticGeneration++;
  await terminal.detach();
  // 前のプロジェクトの応答を待ってから、その表示を破棄する。
  await connection.settle();
  closeSettings();
  setHistoryOpen(false);
  gitPanel.reset();
  gitState = emptyGitStatus();
  tree.setStatuses([]);
  active = '';
  editor.setModel(null);
  annotations.clear();
  splitEditor.clear();
  store.clear();
  markerScopes.clear();
  opened.clear();
  imagePaths.clear();
  showImage(byId('image-view'));
  rightOnly.clear();
  historyStack = [];
  recentFiles = [];
  renderTabs();
  notice();
  byId('results').hidden = true;
  byId<HTMLInputElement>('filter').value = '';
  tree.search('');
  tree.collapseAll();
  tree.reveal('');
  showTool(false);
  document.title = 'Plasma';
  workspaceRoot =
    linked?.root ??
    (await chooseProject(request, (select) => {
      selectLinkedProject = async (next) => {
        const result = await openProject(request, next.project);
        if (!result) return;
        target = next;
        select(result.root);
      };
      return () => {
        selectLinkedProject = undefined;
      };
    }));
  // 既定の展開 (src) を決めてから取得する。取得後に展開を変えると、開いた表示なのに中身の無いフォルダになる。
  tree.setProject(workspaceRoot.split('/').at(-1) || workspaceRoot, workspaceRoot);
  await syncAll();
  const workspace = await refresh();
  shell.hidden = false;
  choosingProject = false;
  editor.layout();
  if (target) await openTargetFile(target);
  else if (!(await restoreLastFile()) && fileNames.length)
    await open(
      fileNames.find((file) => file === 'README.md') ??
        fileNames.find(
          (file) => isSource(file) && !file.includes('.gen.') && !file.endsWith('.d.ts'),
        ) ??
        fileNames[0],
    );
  if (workspace.unreadableDirectories.length)
    notice(
      `${workspace.unreadableDirectories.length} folders could not be read and were skipped.`,
      true,
    );
  if (workspaceRevision === undefined)
    notice('Restart the desktop app to enable automatic file and folder updates.', true);
}

async function start(): Promise<void> {
  requireElement<HTMLElement>('.workspace').hidden = true;
  await setupHighlighting();
  await connection.connect();
  try {
    applyAppearance(await request({ op: 'appearance-get' }));
  } catch (error) {
    notice(`Unable to load appearance settings: ${errorMessage(error)}`, true);
  }
  connection.onNavigate = (route) => {
    linkedNavigation = linkedNavigation
      .then(async () => {
        const target = parseFileRoute(route);
        if (target) await openTarget(target);
      })
      .catch(reportError);
  };
  let target: FileTarget | null = null;
  try {
    if (connection.route) target = parseFileRoute(connection.route);
  } catch (error) {
    reportError(error);
  }
  // 初回の読み込みが失敗しても、選び直した後の自動更新は有効にしておく。
  setInterval(() => void poll(), pollInterval.disk);
  setInterval(() => {
    if (!choosingProject && !document.hidden) void refreshGit().catch(reportError);
  }, pollInterval.git);
  await openProjectPicker(target ?? undefined);
}
void start().catch(reportError);
