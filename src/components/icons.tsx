import { fileIconSource, type IconName, iconClassName, iconMarkup } from '../lib/icons';

export function FileIcon({ path, folder = false }: { path: string; folder?: boolean }) {
  return (
    <span className={iconClassName} aria-hidden="true">
      <img src={fileIconSource(path, folder)} alt="" draggable={false} />
    </span>
  );
}
export function Icon({ name }: { name: IconName }) {
  return (
    <span
      className={iconClassName}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 同梱した固定の図形の表だけが SVG を供給する。
      dangerouslySetInnerHTML={{ __html: iconMarkup(name) }}
    />
  );
}
