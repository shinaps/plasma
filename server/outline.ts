import ts from 'typescript';
import { isSource } from '../shared/language.ts';
import type { OutlineSymbol } from '../shared/protocol.ts';

/** 未保存の本文を解析する。正規表現ではコメントやネストを宣言と取り違えるためASTを使う。 */
export function outline(path: string, text: string): OutlineSymbol[] {
  if (!isSource(path)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const symbols: OutlineSymbol[] = [];
  const visit = (node: ts.Node, depth: number) => {
    const declaration =
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      (ts.isVariableDeclaration(node) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)));
    const name = declaration && node.name?.getText(source);
    if (name) {
      symbols.push({
        name,
        kind: ts.isClassDeclaration(node)
          ? 'class'
          : ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
            ? 'type'
            : 'function',
        start: node.getStart(source),
        end: node.end,
        depth,
      });
    }
    ts.forEachChild(node, (child) => visit(child, depth + (name ? 1 : 0)));
  };
  visit(source, 0);
  return symbols;
}
