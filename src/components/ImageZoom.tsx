import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  src: string;
  alt?: string;
  className?: string;
}

/** 탭하면 전체화면으로 확대(핀치줌 가능). */
export default function ImageZoom({ src, alt = '명함 이미지', className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full">
        <img src={src} alt={alt} className={className} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="safe-top absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
            aria-label="닫기"
          >
            <X size={22} />
          </button>
          <img
            src={src}
            alt={alt}
            className="max-h-full max-w-full object-contain"
            style={{ touchAction: 'pinch-zoom' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
