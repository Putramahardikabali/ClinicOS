import { useEffect, useRef } from "react";

export default function SignaturePad({ value, onChange, testid = "signature-pad" }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, c.width, c.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const t = e.touches?.[0];
    const cx = (t?.clientX ?? e.clientX) - r.left;
    const cy = (t?.clientY ?? e.clientY) - r.top;
    return { x: (cx / r.width) * c.width, y: (cy / r.height) * c.height };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const c = canvasRef.current; const ctx = c.getContext("2d");
    const p = pos(e);
    ctx.strokeStyle = "#2D3A33"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvasRef.current; const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, c.width, c.height);
    onChange("");
  };

  return (
    <div>
      <div className="bl-card overflow-hidden">
        <canvas
          ref={canvasRef}
          width={520}
          height={140}
          className="w-full block touch-none cursor-crosshair"
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          data-testid={testid}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-[#5C6C62]">
        <span>Sign within the box above</span>
        <button type="button" onClick={clear} className="hover:text-[#2D3A33]" data-testid={`${testid}-clear`}>Clear</button>
      </div>
    </div>
  );
}
