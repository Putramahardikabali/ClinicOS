import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api, { fileUrl } from "@/lib/api";

export default function PrintVisitPage() {
  const { vid } = useParams();
  const [visit, setVisit] = useState(null);

  useEffect(() => { api.get(`/visits/${vid}`).then(r => setVisit(r.data)); }, [vid]);

  if (!visit) return <div className="p-10">Loading…</div>;

  const fmt = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  const pat = visit.patient;
  const cr = visit.clinical_record;
  const tr = visit.therapist_record;

  const renderAssessment = () => {
    if (!cr?.assessment) return null;
    const entries = Object.entries(cr.assessment).filter(([_, v]) => v && Object.keys(v).length > 0);
    if (!entries.length) return null;
    return (
      <table className="w-full text-sm border border-[#2D3A33]/30">
        <tbody>
          {entries.map(([sec, subs]) => (
            <tr key={sec} className="border-b border-[#2D3A33]/20">
              <td className="px-2 py-1 font-semibold capitalize w-1/3 align-top">{sec.replace(/_/g," ")}</td>
              <td className="px-2 py-1">{Object.entries(subs).map(([k,v]) => v ? `${k}: ${v}` : null).filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="min-h-screen bg-white text-[#2D3A33]" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Print toolbar */}
      <div className="no-print sticky top-0 bg-[#FDFBF7] border-b border-[#EAE6D7] p-4 flex items-center justify-between">
        <div className="font-display text-lg">Print preview · {pat.full_name}</div>
        <div className="flex gap-2">
          <button onClick={()=>window.close()} className="bl-btn-ghost text-sm">Close</button>
          <button onClick={()=>window.print()} className="bl-btn-primary text-sm" data-testid="print-confirm">Print</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-10 print-page">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-[#2D3A33] pb-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-[#8A9A86]">Body Lab Bali</div>
            <div className="font-display text-2xl mt-1">Aesthetic Medical Record</div>
          </div>
          <div className="text-right text-sm">
            <div><span className="text-[#5C6C62]">No. Rekam Medis:</span> {visit.id.slice(0,12)}</div>
            <div><span className="text-[#5C6C62]">Tanggal:</span> {new Date(visit.visit_date || visit.created_at).toLocaleDateString()}</div>
          </div>
        </div>

        {/* Patient Info */}
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
          <div><span className="text-[#5C6C62] inline-block w-28">Nama</span>: <span className="font-medium">{pat.full_name}</span></div>
          <div><span className="text-[#5C6C62] inline-block w-28">No. Tlp</span>: {pat.phone || "—"}</div>
          <div><span className="text-[#5C6C62] inline-block w-28">Tgl. Lahir</span>: {pat.date_of_birth || "—"}</div>
          <div><span className="text-[#5C6C62] inline-block w-28">Lk/Pr</span>: <span className="capitalize">{pat.gender || "—"}</span></div>
          <div className="col-span-2"><span className="text-[#5C6C62] inline-block w-28">Alergi Obat</span>: {pat.allergies || "—"}</div>
        </div>

        {/* Doctor Clinical Record */}
        {cr && (
          <section className="mt-7">
            <div className="text-xs uppercase tracking-[0.25em] text-[#8A9A86]">Doctor · Clinical Record</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-3 text-sm">
              <div><div className="font-semibold">Anamnesis</div><div className="whitespace-pre-wrap">{cr.anamnesis || "—"}</div></div>
              <div><div className="font-semibold">Diagnosis</div><div className="whitespace-pre-wrap">{cr.diagnosis || "—"}</div></div>
              <div><div className="font-semibold">Terapi / Treatment Plan</div><div className="whitespace-pre-wrap">{cr.treatment_plan || "—"}</div></div>
              <div><div className="font-semibold">Therapy Notes</div><div className="whitespace-pre-wrap">{cr.therapy_notes || "—"}</div></div>
            </div>

            <div className="mt-4">
              <div className="font-semibold text-sm mb-2">Facial Assessment</div>
              {renderAssessment() || <div className="text-sm text-[#5C6C62]">—</div>}
            </div>

            <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
              <div><div className="font-semibold">Product</div><div>{cr.product_used || "—"}</div></div>
              <div><div className="font-semibold">Dosage</div><div>{cr.dosage || "—"}</div></div>
              <div><div className="font-semibold">Area treated</div><div>{cr.area_treated || "—"}</div></div>
            </div>

            {cr.doctor_notes && <div className="mt-3 text-sm"><div className="font-semibold">Doctor notes</div><div className="whitespace-pre-wrap">{cr.doctor_notes}</div></div>}

            <div className="mt-6 flex justify-end">
              <div className="text-center w-56">
                <div className="text-xs text-[#5C6C62] mb-1">TTD Dokter</div>
                {cr.signature ? <img src={cr.signature} alt="signature" className="h-16 mx-auto" /> : <div className="h-16 border-b border-[#2D3A33]/40" />}
                <div className="text-sm font-medium mt-1">{cr.doctor_name || ""}</div>
              </div>
            </div>
          </section>
        )}

        {/* Therapist record */}
        {tr && (
          <section className="mt-7">
            <div className="text-xs uppercase tracking-[0.25em] text-[#8A9A86]">Therapist · Treatment Record</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-3 text-sm">
              <div><div className="font-semibold">Concern / Anamnesis</div><div className="whitespace-pre-wrap">{tr.concern_notes || "—"}</div></div>
              <div><div className="font-semibold">Body concern / Diagnosis</div><div className="whitespace-pre-wrap">{tr.body_concern || "—"}</div></div>
              <div><div className="font-semibold">Treatment area</div><div>{tr.treatment_area || "—"}</div></div>
              <div><div className="font-semibold">Area treated</div><div>{tr.area_treated || "—"}</div></div>
              <div><div className="font-semibold">Device used</div><div>{tr.device_used || "—"}</div></div>
              <div><div className="font-semibold">Parameter</div><div>{tr.treatment_parameter || "—"}</div></div>
              <div><div className="font-semibold">Intensity</div><div>{tr.intensity || "—"}</div></div>
              <div><div className="font-semibold">Duration</div><div>{tr.duration || "—"}</div></div>
            </div>

            {tr.contraindication?.length > 0 && (
              <div className="mt-3 text-sm">
                <div className="font-semibold">Contraindications noted</div>
                <div>{tr.contraindication.join(", ")}</div>
              </div>
            )}
            {tr.therapist_notes && <div className="mt-3 text-sm"><div className="font-semibold">Notes</div><div className="whitespace-pre-wrap">{tr.therapist_notes}</div></div>}

            <div className="mt-6 flex justify-end">
              <div className="text-center w-56">
                <div className="text-xs text-[#5C6C62] mb-1">TTD Terapis</div>
                {tr.signature ? <img src={tr.signature} alt="signature" className="h-16 mx-auto" /> : <div className="h-16 border-b border-[#2D3A33]/40" />}
                <div className="text-sm font-medium mt-1">{tr.therapist_name || ""}</div>
              </div>
            </div>
          </section>
        )}

        {/* Treatment items */}
        {(visit.treatment_items || []).length > 0 && (
          <section className="mt-7">
            <div className="text-xs uppercase tracking-[0.25em] text-[#8A9A86]">Treatment items</div>
            <table className="w-full text-sm mt-3 border-t border-b border-[#2D3A33]/30">
              <thead className="text-left">
                <tr className="border-b border-[#2D3A33]/30">
                  <th className="py-1.5">Category</th><th>Name</th><th>Product</th><th>Area</th><th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {visit.treatment_items.map(it => (
                  <tr key={it.id} className="border-b border-[#2D3A33]/10">
                    <td className="py-1.5">{it.category}</td><td>{it.name}</td><td>{it.product_used || "—"}</td><td>{it.area_treated || "—"}</td><td>{it.quantity} {it.unit_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Mappings */}
        {(visit.mappings || []).length > 0 && (
          <section className="mt-7">
            <div className="text-xs uppercase tracking-[0.25em] text-[#8A9A86]">Face / Body mapping</div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              {visit.mappings.map(m => (
                <div key={m.id} className="text-center">
                  <img src={m.image_data} alt={m.map_type} className="border border-[#EAE6D7] rounded" />
                  <div className="text-xs text-[#5C6C62] mt-1 capitalize">{m.map_type.replace("_"," ")}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Photos */}
        {(visit.photos || []).length > 0 && (
          <section className="mt-7">
            <div className="text-xs uppercase tracking-[0.25em] text-[#8A9A86]">Photo documentation</div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              {visit.photos.map(p => (
                <div key={p.id} className="text-center">
                  <img src={fileUrl(p.storage_path)} alt={p.angle} className="w-full aspect-[3/4] object-cover border border-[#EAE6D7] rounded" />
                  <div className="text-xs text-[#5C6C62] mt-1">{p.photo_type} · {p.angle.replace("_"," ")}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12 pt-6 border-t border-[#EAE6D7] text-center text-xs text-[#5C6C62]">
          Body Lab Bali · Internal Medical Record · Confidential
        </div>
      </div>
    </div>
  );
}
