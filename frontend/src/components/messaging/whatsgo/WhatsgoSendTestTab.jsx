import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { WHATSGO_TEST_VARIABLES } from "@/lib/whatsgo";

export default function WhatsgoSendTestTab() {
  const [patients, setPatients] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [patientId, setPatientId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [language, setLanguage] = useState("id");
  const [variableMapping, setVariableMapping] = useState(["patient_name", "clinic_name"]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/patients", { params: { limit: 200 } }),
      api.get("/messaging/whatsgo/templates"),
    ])
      .then(([pRes, tRes]) => {
        setPatients(pRes.data.items || pRes.data || []);
        const items = tRes.data.items || tRes.data.whatsgo_templates || [];
        setTemplates(items);
        if (items[0]?.name) setTemplateName(items[0].name);
        if (items[0]?.language) setLanguage(items[0].language);
      })
      .catch(() => toast.error("Could not load send test data"))
      .finally(() => setLoaded(true));
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.name === templateName),
    [templates, templateName],
  );

  const setVariableAt = (index, value) => {
    const next = [...variableMapping];
    while (next.length <= index) next.push("");
    next[index] = value;
    setVariableMapping(next.filter((v, i) => v || i < 6));
  };

  const preview = useMemo(() => {
    const tpl = selectedTemplate;
    const base = tpl?.preview || `Template: ${templateName || "—"}`;
    const vars = variableMapping.filter(Boolean).map((v) => `{{${v}}}`).join(", ");
    return vars ? `${base}\n\nVariables: ${vars}` : base;
  }, [selectedTemplate, templateName, variableMapping]);

  const sendTest = async () => {
    if (!patientId) {
      toast.error("Select a patient");
      return;
    }
    if (!templateName.trim()) {
      toast.error("Select a template");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/messaging/whatsgo/messages/send-test", {
        patient_id: patientId,
        template_name: templateName.trim(),
        language,
        variable_mapping: variableMapping.filter(Boolean),
      });
      toast.success(`Test message ${r.data?.status || "queued"}`);
      if (r.data?.open_conversation_url) {
        window.open(r.data.open_conversation_url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send test failed");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-3xl space-y-6" data-testid="whatsgo-send-test-tab">
      <div className="bl-card p-5 space-y-5">
        <div>
          <div className="font-display text-lg text-[#2D3A33]">Send test template</div>
          <p className="text-sm text-[#5C6C62] mt-2">
            Send an approved Whatsgo template to a patient. Syncs the contact first if needed.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label-eyebrow block mb-1.5">Patient</label>
            <select className="bl-input" value={patientId} onChange={(e) => setPatientId(e.target.value)} data-testid="whatsgo-test-patient">
              <option value="">Select patient…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} · {p.phone || "no phone"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Template</label>
            <select className="bl-input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} data-testid="whatsgo-test-template">
              <option value="">Select template…</option>
              {templates.map((t) => (
                <option key={`${t.name}-${t.language}`} value={t.name}>{t.name} ({t.language})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Language</label>
            <input className="bl-input" value={language} onChange={(e) => setLanguage(e.target.value)} data-testid="whatsgo-test-language" />
          </div>
        </div>

        <div>
          <div className="label-eyebrow mb-2">Variable mapping</div>
          <div className="space-y-2">
            {variableMapping.map((val, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-xs text-[#5C6C62] w-6">{i + 1}.</span>
                <select className="bl-input flex-1" value={val} onChange={(e) => setVariableAt(i, e.target.value)} data-testid={`whatsgo-test-var-${i}`}>
                  <option value="">—</option>
                  {WHATSGO_TEST_VARIABLES.map((v) => (
                    <option key={v.key} value={v.key}>{v.label}</option>
                  ))}
                </select>
              </div>
            ))}
            {variableMapping.length < 8 && (
              <button type="button" className="text-xs text-[#52796F] underline" onClick={() => setVariableMapping([...variableMapping, ""])}>
                Add variable slot
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="label-eyebrow mb-1.5">Preview</div>
          <pre className="bl-input min-h-[100px] text-xs whitespace-pre-wrap font-mono bg-[#F8F5EC]">{preview}</pre>
        </div>

        <button type="button" onClick={sendTest} disabled={busy} className="bl-btn-primary inline-flex items-center gap-2" data-testid="whatsgo-test-send">
          <Send className="w-4 h-4" /> Send test
        </button>
      </div>
    </div>
  );
}
