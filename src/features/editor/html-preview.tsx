// 試作の HTML を動かせるようにしつつ、Plasma の文書やストレージには触れさせない。
// CSP は利用者のマークアップより前に置き、プレビュー全体に資源の制限を効かせる。
const policy =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'";

export function HtmlPreview({ source }: { source: string }) {
  return (
    <iframe
      title="HTML preview"
      className="block h-full w-full border-0 bg-background"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${source}`}
    />
  );
}
