import * as monaco from 'monaco-editor/editor/editor.api';

/** 折り返しの切り替えを登録し、切り替える関数を返す。 */
export function registerWrapping(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  const toggle = (): void => {
    const enabled = editor.getOption(monaco.editor.EditorOption.wordWrap) !== 'off';
    editor.updateOptions({ wordWrap: enabled ? 'off' : 'on' });
  };
  editor.addAction({
    id: 'plasma.toggleWrap',
    label: 'Toggle Word Wrap',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
    run: toggle,
  });
  return toggle;
}
