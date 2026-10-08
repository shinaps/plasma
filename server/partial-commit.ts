import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectedContent } from '../shared/partial-changes.ts';
import type { PartialSelection } from '../shared/protocol.ts';
import { decodeText, hasByteOrderMark } from './content.ts';
import { assertNoPendingOperation, gitStatus, runGit } from './git.ts';

/**
 * 一時indexで選択内容をコミットし、作業ファイルと未選択のステージ内容は保持する。
 * @param paths 現在の Git の変更一覧にあるプロジェクト相対パス。一覧にないパスがあれば失敗する
 * @param message コミットメッセージ
 * @param partial 差分単位で選ぶファイル。before/after は選択時の HEAD と作業ツリーの本文で、ディスクと一致しなければ失敗する。changes は selectedContent の差分単位の番号
 */
export function commitSelection(
  root: string,
  paths: string[],
  message: string,
  partial: PartialSelection[],
): { hash: string } {
  const repository = runGit(root, ['rev-parse', '--show-toplevel']).toString().trim();
  assertNoPendingOperation(repository);
  const indexPath = runGit(root, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
    .toString()
    .trim();
  const lock = `${indexPath}.lock`;
  // パスは常にリテラルとして扱う。`[a].ts` のような名前が別のファイルに一致してはいけない。
  const git = (index: string, args: string[], input?: string): string =>
    runGit(repository, ['--literal-pathspecs', ...args], input, {
      ...process.env,
      GIT_INDEX_FILE: index,
    }).toString();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plasma-commit-'));
  const temporary = path.join(directory, 'commit-index');
  const preserved = path.join(directory, 'preserved-index');
  // index.lock は自分で取れたときだけ後始末する。他の Git 操作のロックは消さない。
  let indexLockFile: number | undefined;
  let installed = false;
  try {
    try {
      indexLockFile = fs.openSync(lock, 'wx');
    } catch (error) {
      throw new Error('Another Git operation holds the index. Retry after it finishes.', {
        cause: error,
      });
    }
    const head = runGit(repository, ['rev-parse', 'HEAD']).toString().trim();
    fs.copyFileSync(indexPath, preserved);
    git(temporary, ['read-tree', head]);
    const state = gitStatus(root);
    const entries = paths.map((file) => {
      const entry = state.entries.find((candidate) => candidate.path === file);
      if (!entry) throw new Error('Changes have changed. Refresh and select again.');
      return entry;
    });
    // --path で git add と同じ属性 (改行変換・clean filter) を通し、格納内容を通常のコミットと揃える。
    const update = (index: string, file: string, mode: string, text: string) => {
      const hash = git(index, ['hash-object', '-w', '--stdin', '--path', file], text).trim();
      git(index, ['update-index', '--add', '--cacheinfo', `${mode},${hash},${file}`]);
    };
    for (const entry of entries) {
      const selection = partial.find((candidate) => candidate.path === entry.path);
      if (!selection) {
        const renamed = entry.oldPath && (entry.index === 'R' || entry.working === 'R');
        for (const target of [temporary, preserved]) {
          if (entry.kind === 'deleted')
            git(target, ['update-index', '--force-remove', '--', entry.repoPath]);
          else git(target, ['add', '--all', '--', entry.repoPath]);
          // 改名元だけを消す。コピー元 (status.renames=copies) は残す。
          if (renamed && entry.oldPath)
            git(target, ['update-index', '--force-remove', '--', entry.oldPath]);
        }
        continue;
      }
      if (entry.kind !== 'modified' || entry.oldPath)
        throw new Error('Select the whole file for added, removed, renamed or conflicted files.');
      const beforeBytes = runGit(repository, ['show', `${head}:${entry.repoPath}`]);
      const afterBytes = fs.readFileSync(path.join(repository, entry.repoPath));
      const before = decodeText(beforeBytes);
      const after = decodeText(afterBytes);
      if (before !== selection.before || after !== selection.after)
        throw new Error('File changed since selection. Refresh and select its changes again.');
      const metadata = git(preserved, ['ls-files', '-s', '--', entry.repoPath]).split(/\s/);
      if (!['100644', '100755'].includes(metadata[0]))
        throw new Error('Partial commit requires a regular tracked file.');
      const content =
        (hasByteOrderMark(afterBytes) ? '﻿' : '') +
        selectedContent(before, after, selection.changes);
      update(temporary, entry.repoPath, metadata[0], content);
      // 既存のステージ済み編集と選択変更を3-wayで合わせる。衝突時はコミット前に止める。
      const staged = git(preserved, ['show', `:${entry.repoPath}`]);
      const files = [staged, beforeBytes.toString('utf8'), content].map((text, i) => {
        const file = path.join(directory, `merge-${i}`);
        fs.writeFileSync(file, text);
        return file;
      });
      let merged: string;
      try {
        merged = git(preserved, ['merge-file', '-p', ...files]);
      } catch {
        throw new Error(
          'Selected changes overlap different staged edits. Resolve the staged edits before committing.',
        );
      }
      update(preserved, entry.repoPath, metadata[0], merged);
    }
    if (runGit(repository, ['rev-parse', 'HEAD']).toString().trim() !== head)
      throw new Error('HEAD changed. Refresh before committing.');
    git(temporary, ['commit', '-m', message]);
    // index.lockを保持したまま置換し、他のGit操作が途中状態を読んで更新することを防ぐ。
    fs.writeFileSync(indexLockFile, fs.readFileSync(preserved));
    fs.closeSync(indexLockFile);
    fs.renameSync(lock, indexPath);
    installed = true;
    return { hash: runGit(repository, ['rev-parse', 'HEAD']).toString().trim() };
  } finally {
    if (indexLockFile !== undefined && !installed) {
      try {
        fs.closeSync(indexLockFile);
      } catch {}
      fs.rmSync(lock, { force: true });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
