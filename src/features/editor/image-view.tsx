import { renderReact, unmountReact } from '../../lib/react-view';
import { ImagePreview } from './image-preview';
export function showImage(host: HTMLElement, src?: string, path = ''): void {
  if (src) renderReact(host, <ImagePreview key={src} src={src} label={path} />);
  else unmountReact(host);
}
