import { useEffect, useRef, useState } from "react";
import { Camera, X, RotateCcw, Check } from "lucide-react";
import { toast } from "sonner";

/**
 * CameraCapture - opens device camera, captures still photo, returns File.
 * onCapture(file) called with a JPEG File when user confirms.
 */
export default function CameraCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [facing, setFacing] = useState("environment"); // user | environment
  const [shot, setShot] = useState(null); // dataURL after capture

  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1707 } },
          audio: false,
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        toast.error("Cannot access camera. Please grant permission.");
        onClose?.();
      }
    };
    start();
    return () => {
      active = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  const snap = () => {
    const v = videoRef.current; const c = canvasRef.current;
    if (!v || !c) return;
    const w = v.videoWidth, h = v.videoHeight;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, w, h);
    setShot(c.toDataURL("image/jpeg", 0.9));
  };

  const retake = () => setShot(null);

  const confirm = async () => {
    if (!shot) return;
    const blob = await (await fetch(shot)).blob();
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    onCapture(file);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#0e1411] flex flex-col" data-testid="camera-modal">
      <div className="flex items-center justify-between px-4 py-3 text-white/90">
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
        <div className="text-sm font-medium">Camera</div>
        <button onClick={() => setFacing(f => f === "environment" ? "user" : "environment")} className="p-2 rounded-lg hover:bg-white/10" title="Switch camera">
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
        {!shot ? (
          <video ref={videoRef} playsInline muted className="max-h-full max-w-full" />
        ) : (
          <img src={shot} alt="captured" className="max-h-full max-w-full" />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="px-6 py-6 flex items-center justify-center gap-6 bg-[#0e1411]">
        {!shot ? (
          <button onClick={snap} className="w-16 h-16 rounded-full bg-white shadow-lg ring-4 ring-white/30 active:scale-95 transition" data-testid="camera-shutter" aria-label="Capture" />
        ) : (
          <>
            <button onClick={retake} className="px-5 py-3 rounded-xl bg-white/10 text-white inline-flex items-center gap-2" data-testid="camera-retake">
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            <button onClick={confirm} className="px-6 py-3 rounded-xl text-white inline-flex items-center gap-2" style={{ background: "var(--bl-primary)" }} data-testid="camera-confirm">
              <Check className="w-4 h-4" /> Use photo
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function CameraButton({ onCapture, label = "Take photo" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="bl-btn-ghost inline-flex items-center justify-center gap-2" data-testid="camera-open-button">
        <Camera className="w-4 h-4" /> {label}
      </button>
      {open && <CameraCapture onCapture={(f) => { setOpen(false); onCapture(f); }} onClose={() => setOpen(false)} />}
    </>
  );
}
