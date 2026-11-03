import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';

const MIN = 1;
const MAX = 8;
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));

/**
 * An image full screen: fitted to the window first, then zoomed with the wheel, a pinch, double-click, the buttons or
 * + and −, and moved by dragging. Esc, the close button or a click beside the image closes it. Nothing leaves the device:
 * the image is the data address it already had.
 */
export function ImageViewer({ src, alt, caption, fileName, onClose }: { src: string; alt: string; caption?: string; fileName: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  const zoomTo = (next: number, around?: { x: number; y: number }) => {
    const target = clamp(next);
    if (target === MIN) setOffset({ x: 0, y: 0 });
    else if (around) {
      // Keep the point under the cursor where it is.
      const factor = target / scale;
      setOffset(o => ({ x: around.x - (around.x - o.x) * factor, y: around.y - (around.y - o.y) * factor }));
    }
    setScale(target);
  };
  const centre = (clientX: number, clientY: number) => ({ x: clientX - window.innerWidth / 2, y: clientY - window.innerHeight / 2 });

  useEffect(() => {
    root.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === '+' || event.key === '=') setScale(s => clamp(s * 1.5));
      else if (event.key === '-') setScale(s => { const next = clamp(s / 1.5); if (next === MIN) setOffset({ x: 0, y: 0 }); return next; });
      else if (event.key === '0') { setScale(1); setOffset({ x: 0, y: 0 }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onWheel = (event: ReactWheelEvent) => zoomTo(scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2), centre(event.clientX, event.clientY));

  const onPointerDown = (event: ReactPointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale };
      drag.current = null;
    } else drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      zoomTo(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance));
      moved.current = true;
    } else if (drag.current && scale > MIN) {
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
      setOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy });
    }
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={alt} tabIndex={-1} ref={root} onWheel={onWheel} onClick={event => { if (event.target === event.currentTarget && !moved.current) onClose(); }}>
      <div className="viewer-bar" onClick={event => event.stopPropagation()}>
        <button type="button" className="icon-btn round press" onClick={() => setScale(s => clamp(s / 1.5))} disabled={scale <= MIN} aria-label="Zoom out" title="Zoom out (−)"><ZoomOut size={18} /></button>
        <span className="viewer-scale" aria-live="polite">{Math.round(scale * 100)}%</span>
        <button type="button" className="icon-btn round press" onClick={() => setScale(s => clamp(s * 1.5))} disabled={scale >= MAX} aria-label="Zoom in" title="Zoom in (+)"><ZoomIn size={18} /></button>
        <button type="button" className="icon-btn round press" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} disabled={scale === MIN} aria-label="Fit to the window" title="Fit (0)"><Maximize2 size={17} /></button>
        <a className="icon-btn round press" href={src} download={fileName} aria-label="Save image" title="Save image"><Download size={17} /></a>
        <button type="button" className="icon-btn round press" onClick={onClose} aria-label="Close" title="Close (Esc)"><X size={19} /></button>
      </div>
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={scale > MIN ? 'zoomed' : undefined}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        onDoubleClick={event => zoomTo(scale > MIN ? MIN : 2.5, centre(event.clientX, event.clientY))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {caption && <p className="viewer-caption" onClick={event => event.stopPropagation()}>{caption}</p>}
    </div>,
    document.body,
  );
}
