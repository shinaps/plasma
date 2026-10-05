import { useState } from 'react';

export function ImagePreview({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-full min-h-48 items-center justify-center rounded-control bg-muted p-8">
      {failed ? (
        <p role="status" className="text-caption text-muted-foreground">
          Unable to display this image. Check the file format and contents.
        </p>
      ) : (
        // img 要素として読み込むので、SVG のスクリプトや外部資源はエディタの文書に入らない。
        <img
          className="h-full w-full object-contain"
          src={src}
          alt={label}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
