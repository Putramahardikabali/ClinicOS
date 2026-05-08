import { useEffect, useRef, useState } from "react";
import api, { fileUrl } from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import { Pen, Eraser, MapPin, Type, Trash2, Save, RotateCcw } from "lucide-react";

const TEMPLATES = {
  face: {
    label: "Face outline",
    bg: "https://customer-assets.emergentagent.com/job_aesthetic-records/artifacts/face-outline.svg", // optional
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">
      <ellipse cx="200" cy="220" rx="120" ry="160" fill="none" stroke="#C7BFA7" stroke-width="2"/>
      <circle cx="155" cy="200" r="6" fill="none" stroke="#C7BFA7" stroke-width="1.5"/>
      <circle cx="245" cy="200" r="6" fill="none" stroke="#C7BFA7" stroke-width="1.5"/>
      <path d="M180 250 Q200 270 220 250" fill="none" stroke="#C7BFA7" stroke-width="1.5"/>
      <path d="M165 305 Q200 325 235 305" fill="none" stroke="#C7BFA7" stroke-width="1.5"/>
      <path d="M155 200 Q140 175 130 195" fill="none" stroke="#C7BFA7" stroke-width="1"/>
      <path d="M245 200 Q260 175 270 195" fill="none" stroke="#C7BFA7" stroke-width="1"/>
    </svg>`
  },
  body_front: {
    label: "Body front",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600">
      <circle cx="150" cy="60" r="40" fill="none" stroke="#C7BFA7" stroke-width="2"/>
      <path d="M110 100 L100 130 L70 200 L80 320 L100 320 L110 220 L110 350 L120 540 L140 540 L145 360 L155 360 L160 540 L180 540 L190 350 L190 220 L200 320 L220 320 L230 200 L200 130 L190 100 Z" fill="none" stroke="#C7BFA7" stroke-width="2"/>
    </svg>`
  },
  body_back: {
    label: "Body back",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600">
      <circle cx="150" cy="60" r="40" fill="none" stroke="#C7BFA7" stroke-width="2"/>
      <path d="M110 100 L100 130 L70 200 L80 320 L100 320 L110 220 L110 350 L120 540 L140 540 L145 360 L155 360 L160 540 L180 540 L190 350 L190 220 L200 320 L220 320 L230 200 L200 130 L190 100 Z" fill="none" stroke="#C7BFA7" stroke-width="2"/>
      <line x1="150" y1="100" x2="150" y2="350" stroke="#C7BFA7" stroke-width="1" stroke-dasharray="4 4"/>
    </svg>`
  },
};

const COLORS = ["#E76F51", "#8A9A86", "#457B9D", "#D4A373", "#2D3A33"];

export default function MappingCanvas({ visit, onSaved }) {
  const { user } = useAuth();
  const editable = can(user, "edit_mapping");
  const [mapType, setMapType] = useState("face");
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(3);
  const [strokes, setStrokes] = useState([]); // [{tool, color, size, points:[{x,y}]}]
  const [markers, setMarkers] = useState([]); // [{x,y,label,color}]
  const [labelInput, setLabelInput] = useState("0.5 ml");
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const cur = useRef(null);

  const tpl = TEMPLATES[mapType];

  // Render
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, c.width, c.height);

    // Draw template SVG as background
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // strokes
      strokes.forEach((s) => {
        ctx.strokeStyle = s.color; ctx.lineWidth = s.size; ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (s.tool === "eraser") { ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = s.size * 4; }
        if (s.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
      });
      // markers
      markers.forEach((m) => {
        ctx.fillStyle = m.color;
        ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath(); ctx.arc(m.x, m.y, 3, 0, Math.PI * 2); ctx.fill();
        if (m.label) {
          ctx.font = "12px DM Sans, sans-serif";
          ctx.fillStyle = "#2D3A33";
          ctx.fillRect(m.x + 10, m.y - 18, ctx.measureText(m.label).width + 10, 18);
          ctx.fillStyle = "#FFFFFF";
          ctx.fillText(m.label, m.x + 15, m.y - 5);
        }
      });
    };
    img.src = "data:image/svg+xml;utf8," + encodeURIComponent(tpl.svg);
  }, [strokes, markers, mapType]);

  const pos = (e) => {
    const c = canvasRef.current; const r = c.getBoundingClientRect();
    const t = e.touches?.[0];
    return {
      x: ((t?.clientX ?? e.clientX) - r.left) * (c.width / r.width),
      y: ((t?.clientY ?? e.clientY) - r.top) * (c.height / r.height),
    };
  };

  const handleStart = (e) => {
    if (!editable) return;
    e.preventDefault();
    const p = pos(e);
    if (tool === "marker") {
      setMarkers((m) => [...m, { x: p.x, y: p.y, label: labelInput, color }]);
      return;
    }
    drawing.current = true;
    cur.current = { tool, color, size, points: [p] };
    setStrokes((s) => [...s, cur.current]);
  };
  const handleMove = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    cur.current.points.push(pos(e));
    setStrokes((s) => [...s.slice(0, -1), { ...cur.current, points: [...cur.current.points] }]);
  };
  const handleEnd = () => {
    drawing.current = false;
    cur.current = null;
  };

  const undo = () => {
    if (markers.length > 0) setMarkers((m) => m.slice(0, -1));
    else setStrokes((s) => s.slice(0, -1));
  };

  const clearAll = () => { setStrokes([]); setMarkers([]); };

  const save = async () => {
    const c = canvasRef.current;
    const dataUrl = c.toDataURL("image/png");
    try {
      await api.post(`/visits/${visit.id}/mappings`, {
        map_type: mapType,
        image_data: dataUrl,
        raw_json: { strokes, markers },
        notes: "",
      });
      toast.success("Mapping saved");
      onSaved?.();
      clearAll();
    } catch (e) {
      toast.error("Failed to save mapping");
    }
  };

  const delMap = async (id) => {
    try { await api.delete(`/visits/${visit.id}/mappings/${id}`); onSaved?.(); } catch {}
  };

  return (
    <div className="space-y-5">
      {editable && (
        <div className="bl-card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select className="bl-input w-auto" value={mapType} onChange={(e)=>{ setMapType(e.target.value); clearAll(); }} data-testid="map-template-select">
              <option value="face">Face outline</option>
              <option value="body_front">Body front</option>
              <option value="body_back">Body back</option>
            </select>
            <div className="flex items-center gap-1 bg-[#F3F1EB] rounded-lg p-1">
              <button onClick={()=>setTool("pen")} className={`p-2 rounded-md ${tool==="pen" ? "bg-white shadow-sm" : ""}`} data-testid="tool-pen"><Pen className="w-4 h-4" /></button>
              <button onClick={()=>setTool("eraser")} className={`p-2 rounded-md ${tool==="eraser" ? "bg-white shadow-sm" : ""}`} data-testid="tool-eraser"><Eraser className="w-4 h-4" /></button>
              <button onClick={()=>setTool("marker")} className={`p-2 rounded-md ${tool==="marker" ? "bg-white shadow-sm" : ""}`} data-testid="tool-marker"><MapPin className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button key={c} onClick={()=>setColor(c)} className={`w-7 h-7 rounded-full border-2 ${color === c ? "border-[#2D3A33]" : "border-transparent"}`} style={{ background: c }} aria-label={c} />
              ))}
            </div>
            <input type="range" min="1" max="10" value={size} onChange={(e)=>setSize(parseInt(e.target.value))} className="w-24" />
            {tool === "marker" && (
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-[#5C6C62]" />
                <input className="bl-input w-32 py-1.5" placeholder="Dosage label" value={labelInput} onChange={(e)=>setLabelInput(e.target.value)} data-testid="marker-label" />
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <button onClick={undo} className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"><RotateCcw className="w-3.5 h-3.5" /> Undo</button>
              <button onClick={clearAll} className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Clear</button>
              <button onClick={save} className="bl-btn-primary text-sm inline-flex items-center gap-1.5" data-testid="map-save"><Save className="w-3.5 h-3.5" /> Save mapping</button>
            </div>
          </div>

          <div className="bg-[#FBF8EF] rounded-xl border border-[#EAE6D7] flex justify-center p-4">
            <canvas
              ref={canvasRef}
              width={mapType === "face" ? 400 : 300}
              height={mapType === "face" ? 500 : 600}
              className="bg-white rounded-lg border border-[#EAE6D7] touch-none"
              style={{ maxWidth: "100%", maxHeight: "70vh" }}
              onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
              onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}
              data-testid="mapping-canvas"
            />
          </div>
        </div>
      )}

      {/* Saved mappings */}
      <div>
        <div className="label-eyebrow mb-3">Saved mappings</div>
        {(visit.mappings || []).length === 0 ? (
          <div className="bl-card p-8 text-center text-[#5C6C62]">No mappings yet</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="mappings-list">
            {visit.mappings.map(m => (
              <div key={m.id} className="bl-card overflow-hidden group">
                <div className="bg-[#F3F1EB] aspect-[3/4] relative">
                  <img src={m.image_data} alt={m.map_type} className="w-full h-full object-contain" />
                  {editable && (
                    <button onClick={()=>delMap(m.id)} className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 text-[#B14A2C] opacity-0 group-hover:opacity-100 transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="p-3">
                  <div className="text-sm font-medium capitalize">{m.map_type.replace("_"," ")}</div>
                  <div className="text-xs text-[#5C6C62]">{new Date(m.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
