import * as monaco from 'monaco-editor/editor/editor.api';
import { errorMessage } from '../../../shared/errors.ts';
import { languageFor } from '../../../shared/language.ts';
import type { DiskDocument, SendRequest } from '../../../shared/protocol.ts';

export type EditorDocument = {
  model: monaco.editor.ITextModel;
  /** ディスクと一致していたときのモデルの版。undo でこの版に戻れば未保存ではなくなる。 */
  savedVersionId: number;
  revision: string;
  conflict: boolean;
  /** ディスクから消えた (読めなくなった) 文書。通知は一度だけにし、戻るまで再読込を試みない */
  missing: boolean;
  viewState?: monaco.editor.ICodeEditorViewState | null;
};
/** どの版もディスクと一致しないことを表す。モデルの版は 1 以上なので一致しない。 */
const noSavedVersion = -1;
export const isDirty = (document: EditorDocument): boolean =>
  document.model.getAlternativeVersionId() !== document.savedVersionId;

/**
 * 新しい本文との差分を行単位で置き換える。setValue や全範囲の置換と違い、変わっていない部分の
 * カーソル・スクロール・undo 履歴を保ち、変わった行にあるカーソルも同じ行番号に留まる
 * (整形や外部変更の取り込みで位置を失わない)。
 */
function replaceText(model: monaco.editor.ITextModel, text: string): void {
  // 改行コードだけが変わった本文 (外部の正規化など) にも追従する。行の比較では見えないため。
  const crlf = text.includes('\r\n');
  if (/\r?\n/.test(text) && crlf !== (model.getEOL() === '\r\n'))
    model.pushEOL(crlf ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
  const eol = model.getEOL();
  const old = model.getLinesContent();
  const next = text.split(/\r\n|\n/);
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start++;
  let oldEnd = old.length;
  let nextEnd = next.length;
  while (oldEnd > start && nextEnd > start && old[oldEnd - 1] === next[nextEnd - 1]) {
    oldEnd--;
    nextEnd--;
  }
  if (oldEnd === start && nextEnd === start) return;
  const lineRange = (line: number): monaco.Range =>
    new monaco.Range(line, 1, line, model.getLineMaxColumn(line));
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  const paired = Math.min(oldEnd, nextEnd) - start;
  for (let i = 0; i < paired - 1; i++)
    edits.push({ range: lineRange(start + i + 1), text: next[start + i] });
  const rest = next.slice(start + paired, nextEnd);
  if (paired > 0) {
    // 最後の対の行に、余った行の挿入か削除をまとめる (範囲が接する編集を作らない)。
    const line = start + paired;
    edits.push({
      range: new monaco.Range(line, 1, oldEnd, model.getLineMaxColumn(oldEnd)),
      text: [next[line - 1], ...rest].join(eol),
    });
  } else if (oldEnd > start) {
    edits.push({
      range:
        oldEnd < old.length
          ? new monaco.Range(start + 1, 1, oldEnd + 1, 1)
          : new monaco.Range(
              start,
              model.getLineMaxColumn(start),
              oldEnd,
              model.getLineMaxColumn(oldEnd),
            ),
      text: '',
    });
  } else {
    const column = start === 0 ? 1 : model.getLineMaxColumn(start);
    edits.push({
      range: new monaco.Range(Math.max(start, 1), column, Math.max(start, 1), column),
      text: start === 0 ? rest.join(eol) + eol : eol + rest.join(eol),
    });
  }
  model.pushEditOperations([], edits, () => null);
}

/** 開いている文書のモデルとディスクのリビジョンを持つ。画面遷移では文書の一覧もリビジョンも変わらない。 */
export class DocumentStore {
  private readonly request: SendRequest;
  private readonly onEdit: (path: string) => void;
  private readonly documentsByPath = new Map<string, EditorDocument>();
  private readonly loading = new Map<string, Promise<EditorDocument>>();
  private applyingDiskChange = false;
  private saving: Promise<unknown> = Promise.resolve();
  get documents(): ReadonlyMap<string, EditorDocument> {
    return this.documentsByPath;
  }
  /**
   * @param onEdit 利用者の編集で本文が変わったときに呼ぶ。ディスクの内容を取り込むときは呼ばない
   */
  constructor(request: SendRequest, onEdit: (path: string) => void) {
    this.request = request;
    this.onEdit = onEdit;
  }

  load(path: string): Promise<EditorDocument> {
    const loaded = this.documentsByPath.get(path);
    if (loaded) return Promise.resolve(loaded);
    const pending = this.loading.get(path);
    if (pending) return pending;
    const task = this.createDocument(path).finally(() => this.loading.delete(path));
    this.loading.set(path, task);
    return task;
  }
  /** ディスクから読んでモデルを作り、一覧に登録して編集の監視を始める。 */
  private async createDocument(path: string): Promise<EditorDocument> {
    const file = await this.request({ op: 'read', path });
    // パスは解釈させずにそのまま持つ。`#` `?` `%` を含む名前が別の URI になったり、他のファイルと重なったりしない。
    const model = monaco.editor.createModel(
      file.text,
      languageFor(path),
      monaco.Uri.from({ scheme: 'file', path: `/workspace/${path}` }),
    );
    const document: EditorDocument = {
      model,
      savedVersionId: model.getAlternativeVersionId(),
      revision: file.revision,
      conflict: false,
      missing: false,
    };
    this.documentsByPath.set(path, document);
    model.onDidChangeContent(() => {
      if (!this.applyingDiskChange) this.onEdit(path);
    });
    return document;
  }
  close(path: string): void {
    this.documentsByPath.get(path)?.model.dispose();
    this.documentsByPath.delete(path);
  }
  clear(): void {
    for (const document of this.documentsByPath.values()) document.model.dispose();
    this.documentsByPath.clear();
  }
  hasDirty(): boolean {
    return [...this.documentsByPath.values()].some(isDirty);
  }
  /**
   * 未保存の本文をサーバーに送る。保存済みの本文はディスクと同じなので送らない。
   * 定義のプレビュー用に読み込んだだけのモデルは編集ではないので、opened に無いものも送らない。
   * @param opened タブとして開いているパス
   */
  async sync(opened: ReadonlySet<string>): Promise<void> {
    await this.request({
      op: 'sync',
      documents: [...this.documentsByPath]
        .filter(([path, document]) => opened.has(path) && isDirty(document))
        .map(([path, document]) => ({ path, text: document.model.getValue() })),
    });
  }
  /**
   * 未保存の文書を順に保存し、保存できなかった文書と整形の警告を返す。
   * 保存の要求は直列にする。前の保存が返る前に次の保存を送ると、古いリビジョンで競合になるため。
   */
  save(opened: ReadonlySet<string>): Promise<string[]> {
    const task = this.saving.then(() => this.saveDocuments(opened));
    this.saving = task.catch(() => undefined);
    return task;
  }
  private async saveDocuments(opened: ReadonlySet<string>): Promise<string[]> {
    const problems: string[] = [];
    for (const path of opened) {
      const document = this.documentsByPath.get(path);
      if (!document || !isDirty(document)) continue;
      const text = document.model.getValue();
      const sentVersionId = document.model.getAlternativeVersionId();
      let result: DiskDocument;
      try {
        result = await this.request({ op: 'save', path, text, revision: document.revision });
      } catch (error) {
        problems.push(`${path}: ${errorMessage(error)}`);
        continue;
      }
      if (document.model.isDisposed()) continue;
      // 整形結果は undo できる。保存中に入力があれば本文は置き換えない。
      const untouched = document.model.getAlternativeVersionId() === sentVersionId;
      if (untouched && result.text !== text) {
        document.model.pushStackElement();
        replaceText(document.model, result.text);
        document.model.pushStackElement();
      }
      // 保存中に入力があれば、ディスクと一致するのは送った版だけ。整形で本文が変わっていれば、どの版も一致しない。
      document.savedVersionId = untouched
        ? document.model.getAlternativeVersionId()
        : result.text === text
          ? sentVersionId
          : noSavedVersion;
      document.revision = result.revision;
      document.conflict = false;
      if (result.warning) problems.push(`${path}: ${result.warning}`);
    }
    return problems;
  }
  async reload(path: string): Promise<void> {
    const document = this.documentsByPath.get(path);
    if (!document) return;
    const result = await this.request({ op: 'discard', path });
    if (this.documentsByPath.get(path) === document) this.applyDisk(document, result);
  }
  /**
   * ディスクの変更を取り込む。未保存の文書は上書きせず競合として残す。
   * 読めなくなった文書は missing として一度だけ返す。読み直しは続け、戻れば通常の流れに乗せる。
   */
  async refresh(
    opened: ReadonlySet<string>,
  ): Promise<{ changed: boolean; conflicts: string[]; missing: string[] }> {
    let changed = false;
    const conflicts: string[] = [];
    const missing: string[] = [];
    for (const path of opened) {
      const document = this.documentsByPath.get(path);
      if (!document) continue;
      const revision = document.revision;
      const version = document.model.getVersionId();
      let result: DiskDocument;
      try {
        result = await this.request({ op: 'read', path });
      } catch {
        if (this.documentsByPath.get(path) === document && !document.missing) {
          document.missing = true;
          missing.push(path);
        }
        continue;
      }
      if (this.documentsByPath.get(path) === document && document.missing) {
        document.missing = false;
        changed = true;
      }
      if (
        this.documentsByPath.get(path) !== document ||
        revision !== document.revision ||
        version !== document.model.getVersionId()
      )
        continue;
      if (result.revision === document.revision) {
        // ディスクが読み込んだ版に戻れば競合ではない。編集はそのまま保存できる。
        if (document.conflict) {
          document.conflict = false;
          changed = true;
        }
        continue;
      }
      if (isDirty(document)) {
        if (!document.conflict) conflicts.push(path);
        document.conflict = true;
      } else {
        this.applyDisk(document, result);
        changed = true;
      }
    }
    return { changed, conflicts, missing };
  }
  private applyDisk(document: EditorDocument, file: DiskDocument): void {
    this.applyingDiskChange = true;
    try {
      replaceText(document.model, file.text);
    } finally {
      this.applyingDiskChange = false;
    }
    document.savedVersionId = document.model.getAlternativeVersionId();
    document.revision = file.revision;
    document.conflict = false;
    document.missing = false;
  }
}
