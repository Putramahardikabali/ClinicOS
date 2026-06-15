import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  serializeItemPerformers,
  CLINICAL_PERFORMER_ROLES,
} from "@/lib/performerUtils";
import InvoiceItemPerformers from "@/components/invoices/InvoiceItemPerformers";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { resolveLineQuantity, formatQuantityDisplay, parseQuantityInput, lineGrossIdr } from "@/lib/invoiceLineQuantity";
import { toast } from "sonner";
import { ArrowLeft, Plus, Printer, Trash2, CheckCircle2, Package } from "lucide-react";
import GiftCardPaymentFields from "@/components/giftcards/GiftCardPaymentFields";
import { resolveGiftCardRedemption } from "@/lib/giftCardRedemption";
import { hasPermission } from "@/lib/auth";
import PaymentAmountQuickFill from "@/components/payments/PaymentAmountQuickFill";
import { computeChangeDue, isCashPayment } from "@/lib/paymentAmountQuickFill";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "qris", label: "QRIS" },
  { value: "gift_card", label: "Gift Card" },
  { value: "store_credit", label: "Store Credit" },
  { value: "package", label: "Package" },
  { value: "mixed", label: "Mixed" },
  { value: "other", label: "Other" },
];

const emptyItem = (defaultPerformer) => ({
  item_type: "custom",
  catalog_id: null,
  name: "",
  unit_price_idr: 0,
  quantity: 1,
  performer_id: defaultPerformer?.performer_id || "",
  performer_name_snapshot: defaultPerformer?.performer_name_snapshot || "",
  performer_role_snapshot: defaultPerformer?.performer_role_snapshot || "",
});

const serializeItems = (items) => items.map((it) => {
  const { line_total_idr, performer_name_snapshot, performer_role_snapshot, ...rest } = it;
  return serializeItemPerformers(rest);
});

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const visitFromQuery = search.get("visit");
  const nav = useNavigate();
  const { user } = useAuth();
  const canEdit = hasPermission(user, "billing.edit") || hasPermission(user, "billing.create");

  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardAmount, setGiftCardAmount] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletBalance, setWalletBalance] = useState(0);
  const [giftLookup, setGiftLookup] = useState(null);
  const [busy, setBusy] = useState(false);
  const canRedeemGiftCard = hasPermission(user, "gift_cards.redeem");
  const canVoidPayment = hasPermission(user, "payments.void") || hasPermission(user, "billing.edit");
  const canRecordRefund = hasPermission(user, "refunds.create");
  const canUseWallet = hasPermission(user, "wallet.use");

  const [treatments, setTreatments] = useState([]);
  const [packages, setPackages] = useState([]);
  const [products, setProducts] = useState([]);
  const [performers, setPerformers] = useState([]);
  const [pickType, setPickType] = useState("treatment");
  const [pickId, setPickId] = useState("");
  const [patientPackages, setPatientPackages] = useState([]);
  const [eligibleByItem, setEligibleByItem] = useState({});
  const [packagePick, setPackagePick] = useState({});
  const [packageBusy, setPackageBusy] = useState(null);

  const loadCatalogs = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([
        api.get("/treatments-catalog"),
        api.get("/packages-catalog"),
      ]);
      setTreatments(t.data || []);
      setPackages(p.data || []);
    } catch { /* optional */ }
    try {
      const pr = await api.get("/products-catalog");
      setProducts(pr.data || []);
    } catch { setProducts([]); }
    try {
      const u = await api.get("/users");
      setPerformers((u.data || []).filter((x) => CLINICAL_PERFORMER_ROLES.includes(x.role)));
    } catch { setPerformers([]); }
  }, []);

  const applyInvoice = (inv) => {
    setInvoice(inv);
    setItems((inv.items || []).map((it) => ({
      ...it,
      quantity: resolveLineQuantity(it),
    })));
    setDiscountType(inv.discount_type || "none");
    setDiscountValue(inv.discount_value || 0);
    setDiscountReason(inv.discount_reason || "");
    setNotes(inv.notes || "");
    setPaymentMethod(inv.payment_method || "cash");
    setPaymentReference(inv.payment_reference || "");
    setAmountReceived("");
    setSelectedCampaignId(inv.campaign_id || "");
  };

  const load = useCallback(async () => {
    if (visitFromQuery && !id) {
      const r = await api.post(`/invoices/visit/${visitFromQuery}`);
      nav(`/invoices/${r.data.id}`, { replace: true });
      return;
    }
    const r = await api.get(`/invoices/${id}`);
    applyInvoice(r.data);
  }, [id, visitFromQuery, nav]);

  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);
  useEffect(() => { load().catch(() => toast.error("Invoice not found")); }, [load]);

  useEffect(() => {
    if (!canEdit) return;
    const invoiceDate = (invoice?.created_at || "").slice(0, 10);
    api.get("/campaigns/active", { params: invoiceDate ? { date: invoiceDate } : {} })
      .then((r) => setCampaigns(r.data || []))
      .catch(() => setCampaigns([]));
  }, [canEdit, invoice?.created_at]);

  const appliedCampaign = useMemo(() => {
    if (!invoice?.campaign_id) return null;
    return campaigns.find((c) => c.id === invoice.campaign_id) || {
      id: invoice.campaign_id,
      name: invoice.campaign_name_snapshot,
      code: invoice.campaign_code_snapshot,
      discount_type: invoice.discount_type_snapshot,
      discount_value: invoice.discount_value_snapshot,
      start_date: null,
      end_date: null,
      applies_to: "all",
    };
  }, [invoice, campaigns]);

  const applyCampaign = async (campaignId) => {
    if (!invoice?.id) return;
    setCampaignBusy(true);
    try {
      const r = await api.post(`/invoices/${invoice.id}/apply-campaign`, {
        campaign_id: campaignId || null,
      });
      applyInvoice(r.data);
      setSelectedCampaignId(r.data.campaign_id || "");
      toast.success(campaignId ? "Campaign applied" : "Campaign removed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to apply campaign");
    } finally {
      setCampaignBusy(false);
    }
  };

  useEffect(() => {
    if (!invoice?.patient_id || !canUseWallet) {
      setWalletBalance(0);
      return undefined;
    }
    api.get("/wallet/balance", { params: { patient_id: invoice.patient_id } })
      .then((r) => setWalletBalance(Number(r.data?.balance_idr) || 0))
      .catch(() => setWalletBalance(0));
    return undefined;
  }, [invoice?.patient_id, canUseWallet]);

  useEffect(() => {
    if (!invoice?.patient_id) {
      setPatientPackages([]);
      setEligibleByItem({});
      return;
    }
    api.get(`/patients/${invoice.patient_id}/patient-packages`)
      .then((r) => setPatientPackages((r.data || []).filter((p) => ["active", "partially_used"].includes(p.status) && p.remaining_sessions > 0)))
      .catch(() => setPatientPackages([]));
  }, [invoice?.patient_id, invoice?.updated_at]);

  useEffect(() => {
    if (!invoice?.patient_id || !items.length) {
      setEligibleByItem({});
      return;
    }
    const loadEligible = async () => {
      const next = {};
      await Promise.all(items.map(async (it) => {
        if (it.paid_by === "package" || !["treatment", "custom"].includes(it.item_type)) return;
        try {
          const r = await api.post(`/patients/${invoice.patient_id}/patient-packages/eligible`, {
            treatment_id: it.item_type === "treatment" ? it.catalog_id : undefined,
            treatment_name: it.name,
            visit_id: invoice.visit_id,
          });
          next[it.id] = r.data || [];
        } catch {
          next[it.id] = [];
        }
      }));
      setEligibleByItem(next);
    };
    loadEligible();
  }, [invoice?.patient_id, invoice?.visit_id, items]);

  const defaultPerformer = useMemo(() => {
    if (!invoice) return null;
    if (invoice.default_performer?.performer_id) return invoice.default_performer;
    const u = invoice.visit?.assigned_user;
    if (u?.id) {
      return {
        performer_id: u.id,
        performer_name_snapshot: u.name || "",
        performer_role_snapshot: u.role || "",
      };
    }
    return null;
  }, [invoice]);

  const preview = useMemo(() => {
    const cashDue = (it) => {
      if (it.paid_by === "package") return 0;
      return lineGrossIdr(it);
    };
    const serviceValue = (it) => {
      if (it.original_treatment_value != null) return Number(it.original_treatment_value) || 0;
      return lineGrossIdr(it);
    };
    const subtotal = items.reduce((s, it) => s + cashDue(it), 0);
    const serviceSubtotal = items.reduce((s, it) => s + serviceValue(it), 0);
    const packageCovered = items
      .filter((it) => it.paid_by === "package")
      .reduce((s, it) => s + serviceValue(it), 0);
    let discountAmount = 0;
    if (discountType === "percentage") discountAmount = Math.round(subtotal * Number(discountValue || 0) / 100);
    else if (discountType === "fixed") discountAmount = Number(discountValue || 0);
    discountAmount = Math.max(0, Math.min(discountAmount, subtotal));
    const total = subtotal - discountAmount;
    const alreadyPaid = Number(invoice?.amount_paid || 0);
    const received = parseInt(String(amountReceived).replace(/\D/g, ""), 10) || 0;
    const outstanding = Math.max(0, total - alreadyPaid);
    const hasPackageCovered = items.some((it) => it.paid_by === "package");
    let status = "unpaid";
    if (total === 0 && hasPackageCovered) status = "paid";
    else if (alreadyPaid + received >= total && total > 0) status = "paid";
    else if (alreadyPaid + received > 0) status = "partial";
    return {
      subtotal,
      serviceSubtotal,
      packageCovered,
      discountAmount,
      total,
      alreadyPaid,
      outstanding,
      remaining: Math.max(0, outstanding - received),
      status,
    };
  }, [items, discountType, discountValue, amountReceived, invoice?.amount_paid]);

  const giftRedemption = useMemo(
    () => resolveGiftCardRedemption({
      card: giftLookup?.card,
      lineItems: items,
      patientId: invoice?.patient_id,
      amountDue: preview.outstanding,
      userEnteredAmount: giftCardAmount,
    }),
    [giftLookup, items, invoice?.patient_id, preview.outstanding, giftCardAmount],
  );

  const saveInvoice = async () => {
    if (preview.discountAmount > 0 && !discountReason.trim() && !invoice?.campaign_id) {
      toast.error("Discount reason is required");
      return;
    }
    setBusy(true);
    try {
      const r = await api.put(`/invoices/${invoice.id}`, {
        items: serializeItems(items),
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
        discount_reason: discountReason,
        notes,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
      });
      applyInvoice(r.data);
      toast.success("Invoice saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const savePayment = async (markPaid = false) => {
    if (preview.discountAmount > 0 && !discountReason.trim()) {
      toast.error("Discount reason is required");
      return;
    }
    const gcApplied = giftRedemption.standaloneRedeem
      ? 0
      : parseInt(String(giftCardAmount).replace(/\D/g, ""), 10) || 0;
    if (paymentMethod === "gift_card") {
      if (!giftCardCode.trim()) {
        toast.error("Enter gift card code");
        return;
      }
      if (giftRedemption.validationError) {
        toast.error(giftRedemption.validationError);
        return;
      }
      if (!giftRedemption.canSubmit) {
        if (giftRedemption.showAmountInput) {
          toast.error("Enter amount to redeem");
        }
        return;
      }
      if (!giftRedemption.standaloneRedeem && gcApplied > preview.outstanding && !markPaid) {
        toast.error("Redemption cannot exceed balance due");
        return;
      }
    }
    const received = parseInt(String(amountReceived).replace(/\D/g, ""), 10) || 0;
    if (!markPaid && paymentMethod !== "gift_card" && paymentMethod !== "store_credit") {
      if (received <= 0) {
        toast.error("Enter amount received");
        return;
      }
      if (!isCashPayment(paymentMethod) && received > preview.outstanding) {
        toast.error("Amount cannot exceed balance due for this payment method");
        return;
      }
    }
    setBusy(true);
    try {
      await api.put(`/invoices/${invoice.id}`, {
        items: serializeItems(items),
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
        discount_reason: discountReason,
        notes,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
      });
      const r = await api.put(`/invoices/${invoice.id}/payment`, {
        amount_paid: paymentMethod === "gift_card" ? undefined : (markPaid ? undefined : received),
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        notes,
        mark_paid: markPaid,
        gift_card_code: (paymentMethod === "gift_card" || gcApplied > 0 || giftRedemption.standaloneRedeem)
          && giftCardCode.trim()
          ? giftCardCode.trim()
          : undefined,
        gift_card_amount_idr: gcApplied > 0 ? gcApplied : undefined,
        wallet_amount_idr: (() => {
          const w = parseInt(String(walletAmount).replace(/\D/g, ""), 10) || 0;
          return w > 0 ? w : (paymentMethod === "store_credit" ? preview.outstanding : undefined);
        })(),
      });
      applyInvoice(r.data);
      toast.success(markPaid ? "Marked as paid" : "Payment updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const closeVisitIfPaid = async () => {
    if (invoice?.visit_id && preview.status === "paid" && invoice.visit?.status !== "completed") {
      try {
        await api.put(`/visits/${invoice.visit_id}/status`, { status: "completed" });
        toast.success("Treatment session closed");
        await load();
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not close treatment session");
      }
    }
  };

  const addCatalogLine = async () => {
    if (!pickId) return;
    setBusy(true);
    try {
      const r = await api.post(`/invoices/${invoice.id}/items/catalog`, {
        item_type: pickType,
        catalog_id: pickId,
        quantity: 1,
      });
      applyInvoice(r.data);
      setPickId("");
      toast.success("Item added");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add item");
    } finally {
      setBusy(false);
    }
  };

  const setItemPerformers = (idx, built) => {
    const enriched = built.map((p) => {
      const person = performers.find((s) => s.id === p.staff_id);
      return {
        ...p,
        staff_name_snapshot: person?.name || p.staff_name_snapshot || "",
        staff_role_snapshot: person?.role || p.staff_role_snapshot || "",
      };
    });
    const primary = enriched.find((p) => p.performer_type === "primary") || enriched[0];
    updateItem(idx, {
      performers: enriched,
      performer_id: primary?.staff_id || "",
      performer_name_snapshot: primary?.staff_name_snapshot || "",
      performer_role_snapshot: primary?.staff_role_snapshot || "",
    });
  };

  const addCustomLine = () => setItems([...items, emptyItem(defaultPerformer)]);
  const updateItem = (idx, patch) => {
    setItems(items.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      if (it.paid_by === "package") return it;
      if ("unit_price_idr" in patch || "quantity" in patch) {
        delete next.amount_charged;
      }
      return next;
    }));
  };
  const removeItem = (idx) => {
    const it = items[idx];
    if (it?.paid_by === "package") {
      toast.error("Reverse package usage before removing this line");
      return;
    }
    setItems(items.filter((_, i) => i !== idx));
  };

  const payLineWithPackage = async (item) => {
    const pickVal = packagePick[item.id];
    if (!pickVal) {
      toast.error("Select a package");
      return;
    }
    const [pkgId, componentId] = pickVal.includes(":") ? pickVal.split(":") : [pickVal, null];
    const eligible = eligibleByItem[item.id] || [];
    const pkg = eligible.find((p) => p.id === pkgId) || patientPackages.find((p) => p.id === pkgId);
    const comp = pkg?.eligible_component;
    const label = item.name || "this treatment";
    const compLabel = comp?.treatment_name_snapshot ? ` (${comp.treatment_name_snapshot})` : "";
    if (!window.confirm(`Use 1 from "${pkg?.package_name_snapshot}"${compLabel} for ${label}?`)) return;
    setPackageBusy(item.id);
    try {
      const r = await api.post(`/invoices/${invoice.id}/items/${item.id}/pay-with-package`, {
        patient_package_id: pkgId,
        patient_package_component_id: componentId || comp?.id || undefined,
        used_sessions_count: 1,
      });
      applyInvoice(r.data);
      setPackagePick((prev) => ({ ...prev, [item.id]: "" }));
      const pr = await api.get(`/patients/${invoice.patient_id}/patient-packages`);
      setPatientPackages((pr.data || []).filter((p) => ["active", "partially_used"].includes(p.status) && p.remaining_sessions > 0));
      toast.success("Paid by package");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not apply package");
    } finally {
      setPackageBusy(null);
    }
  };

  const eligibleOptionsForItem = (it) => eligibleByItem[it.id] || [];

  const lineDisplayAmount = (it) => {
    if (it.paid_by === "package") return 0;
    return lineGrossIdr(it);
  };

  const lineServiceValue = (it) => {
    if (it.original_treatment_value != null) return Number(it.original_treatment_value) || 0;
    return lineGrossIdr(it);
  };

  const catalogOptions = pickType === "treatment" ? treatments : pickType === "package" ? packages : products;

  if (!invoice) return <div className="p-10 text-[#5C6C62]">Loading invoice…</div>;

  const readOnly = !canEdit || invoice.payment_status === "cancelled";
  const closed = invoice.payment_status === "paid";
  const closingLocked = invoice.closing_locked;
  const readOnlyPayment = readOnly || closingLocked;

  const voidPayment = async (paymentId) => {
    const reason = window.prompt("Void reason (required):");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await api.post(`/invoices/${invoice.id}/payments/${paymentId}/void`, { reason: reason.trim() });
      applyInvoice(r.data);
      toast.success("Payment voided");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not void payment");
    } finally {
      setBusy(false);
    }
  };

  const recordRefund = async () => {
    const max = invoice.amount_paid || 0;
    const amountStr = window.prompt(`Refund amount (IDR, max ${max}):`, String(max));
    if (!amountStr) return;
    const amount = parseInt(String(amountStr).replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) return;
    const reason = window.prompt("Refund reason (required):");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api.post(`/invoices/${invoice.id}/refund`, {
        amount_idr: amount,
        method: invoice.payment_method || "cash",
        reason: reason.trim(),
      });
      toast.success("Refund recorded");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not record refund");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-6xl mx-auto" data-testid="invoice-detail-page">
      <Link to="/invoices" className="text-sm text-[#5C6C62] inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="w-4 h-4" /> All invoices
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-eyebrow">Invoice</div>
          <h1 className="font-display text-3xl text-[#2D3A33]">{invoice.invoice_number}</h1>
          <p className="text-sm text-[#5C6C62] mt-1">
            {invoice.patient?.full_name || "Patient"}
            {invoice.visit_id && (
              <> · <Link to={`/visits/${invoice.visit_id}`} className="underline">Session record</Link></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`bl-chip ${preview.status === "paid" ? "success" : preview.status === "partial" ? "info" : "warning"}`}>
            {preview.status}
          </span>
          <Link to={`/print/invoice/${invoice.id}`} target="_blank" className="bl-btn-ghost text-sm inline-flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </Link>
        </div>
      </div>

      {invoice?.patient_id && patientPackages.length > 0 && !readOnly && (
        <p className="mt-4 text-sm text-[#5C6C62]">
          Active packages available — use &quot;Pay with package&quot; on eligible treatment lines below.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
      <div className="bl-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-display text-lg text-[#2D3A33]">Line items</div>
          <span className="text-xs text-[#5C6C62]">{items.length} item{items.length === 1 ? "" : "s"}</span>
        </div>
        {items.length === 0 && <p className="text-sm text-[#5C6C62]">No items yet — add from catalog or enter a custom line.</p>}
        {items.map((it, idx) => (
          <div key={it.id || idx} className="rounded-xl border border-[#EAE6D7] p-4 space-y-3 bg-[#FDFBF7]/50">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-4">
              <label className="label-eyebrow block mb-1">Name</label>
              <input className="bl-input text-sm" disabled={readOnly || it.paid_by === "package"} value={it.name} onChange={(e) => updateItem(idx, { name: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label-eyebrow block mb-1">Price</label>
              <input type="number" min="0" className="bl-input text-sm font-mono" disabled={readOnly || it.paid_by === "package"} value={it.unit_price_idr} onChange={(e) => updateItem(idx, { unit_price_idr: Number(e.target.value) })} />
            </div>
            <div className="sm:col-span-1">
              <label className="label-eyebrow block mb-1">Qty</label>
              <input
                type="text"
                inputMode="decimal"
                className="bl-input text-sm font-mono"
                disabled={readOnly || it.paid_by === "package"}
                value={formatQuantityDisplay(it)}
                data-testid={`invoice-line-qty-${it.id || idx}`}
                onChange={(e) => updateItem(idx, { quantity: parseQuantityInput(e.target.value) })}
              />
            </div>
            <div className="sm:col-span-2 text-sm font-medium pt-6 text-right">
              {it.paid_by === "package" ? (
                <span className="text-[#5C6C62] line-through text-xs">{fmtIDR(lineServiceValue(it))}</span>
              ) : (
                fmtIDR(lineDisplayAmount(it))
              )}
            </div>
            {!readOnly && it.paid_by !== "package" && (
              <button type="button" onClick={() => removeItem(idx)} className="sm:col-span-1 p-2 text-[#B14A2C] justify-self-end" aria-label="Remove">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            </div>
            <div className="sm:col-span-full">
              <label className="label-eyebrow block mb-1">
                Assigned staff{it.item_type === "treatment" ? " *" : ""}
              </label>
              <InvoiceItemPerformers
                item={it}
                staff={performers}
                readOnly={readOnly || it.paid_by === "package"}
                onPerformersChange={(built) => setItemPerformers(idx, built)}
              />
            </div>
            {it.paid_by === "package" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="bl-chip success inline-flex items-center gap-1">
                  <Package className="w-3.5 h-3.5" /> Paid by Package
                </span>
                <span className="text-[#5C6C62]">
                  Service value {fmtIDR(lineServiceValue(it))} · due {fmtIDR(0)}
                </span>
              </div>
            )}
            {!readOnly && canEdit && it.paid_by !== "package" && ["treatment", "custom"].includes(it.item_type) && eligibleOptionsForItem(it).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-1" data-testid={`pay-with-package-${it.id}`}>
                <select
                  className="bl-input text-sm w-auto min-w-[220px]"
                  value={packagePick[it.id] || ""}
                  onChange={(e) => setPackagePick((prev) => ({ ...prev, [it.id]: e.target.value }))}
                >
                  <option value="">Use package…</option>
                  {eligibleOptionsForItem(it).map((p) => {
                    const comp = p.eligible_component;
                    const val = comp?.id ? `${p.id}:${comp.id}` : p.id;
                    const compName = comp?.treatment_name_snapshot;
                    const rem = comp?.remaining_quantity ?? p.remaining_sessions;
                    return (
                      <option key={val} value={val}>
                        {p.package_name_snapshot}{compName ? ` · ${compName}` : ""} ({rem} left)
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  disabled={packageBusy === it.id || !packagePick[it.id]}
                  onClick={() => payLineWithPackage(it)}
                  className="bl-btn-ghost text-sm disabled:opacity-50"
                >
                  {packageBusy === it.id ? "Applying…" : "Confirm use session"}
                </button>
              </div>
            )}
          </div>
        ))}

        {!readOnly && (
          <>
            {defaultPerformer && (
              <p className="text-xs text-[#5C6C62]">
                Default assigned staff from treatment session: {defaultPerformer.performer_name_snapshot} ({defaultPerformer.performer_role_snapshot})
              </p>
            )}
            <div className="pt-2 flex flex-wrap gap-2">
              <button type="button" onClick={addCustomLine} className="bl-btn-ghost text-sm inline-flex items-center gap-1">
                <Plus className="w-4 h-4" /> Custom line
              </button>
            <select className="bl-input w-auto text-sm" value={pickType} onChange={(e) => { setPickType(e.target.value); setPickId(""); }}>
              <option value="treatment">Treatment</option>
              <option value="package">Package</option>
              <option value="product">Product</option>
            </select>
            <select className="bl-input flex-1 min-w-[160px] text-sm" value={pickId} onChange={(e) => setPickId(e.target.value)}>
              <option value="">Add from catalog…</option>
              {catalogOptions.map((c) => (
                <option key={c.id || c.key} value={c.id || c.key}>{c.name}</option>
              ))}
            </select>
            <button type="button" disabled={!pickId || busy} onClick={addCatalogLine} className="bl-btn-ghost text-sm">Add</button>
            </div>
          </>
        )}

        <div className="pt-3 space-y-1.5 text-sm bl-card p-4 bg-[#F8F5EC]/60">
          <div className="flex justify-between"><span className="text-[#5C6C62]">Cash due (subtotal)</span><span>{fmtIDR(preview.subtotal)}</span></div>
          {preview.packageCovered > 0 && (
            <div className="flex justify-between text-[#5C6C62]">
              <span>Covered by package (service value)</span>
              <span>{fmtIDR(preview.packageCovered)}</span>
            </div>
          )}
          {preview.discountAmount > 0 && (
            <div className="flex justify-between text-[#B14A2C]">
              <span>{invoice?.campaign_id ? "Campaign discount" : "Discount"}</span>
              <span>−{fmtIDR(preview.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-display text-lg pt-2 border-t border-[#EAE6D7]">
            <span>Total due</span><span data-testid="invoice-total">{fmtIDR(preview.total)}</span>
          </div>
        </div>
      </div>
        </div>

        <div className="space-y-6">
      <div className="bl-card p-5 space-y-3">
        <div className="font-display text-lg text-[#2D3A33]">Campaign</div>
        <select
          className="bl-input"
          disabled={readOnly || campaignBusy}
          value={selectedCampaignId}
          onChange={(e) => setSelectedCampaignId(e.target.value)}
          data-testid="invoice-campaign-select"
        >
          <option value="">{campaigns.length ? "Select active campaign" : "No active campaigns available"}</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
          ))}
        </select>
        {!readOnly && (
          <button
            type="button"
            className="bl-btn-ghost text-sm"
            disabled={campaignBusy || (!selectedCampaignId && !invoice?.campaign_id)}
            onClick={() => applyCampaign(selectedCampaignId || null)}
            data-testid="invoice-apply-campaign"
          >
            {campaignBusy ? "Applying…" : selectedCampaignId ? "Apply campaign" : "Clear campaign"}
          </button>
        )}
        {appliedCampaign && (
          <div className="text-sm text-[#5C6C62] space-y-1 rounded-lg bg-[#F8F5EC] p-3" data-testid="invoice-campaign-details">
            <div className="font-medium text-[#2D3A33]">{appliedCampaign.name}</div>
            <div>
              {appliedCampaign.discount_type === "percent" || appliedCampaign.discount_type === "percentage"
                ? `${appliedCampaign.discount_value}% off`
                : `${fmtIDR(appliedCampaign.discount_value)} off`}
            </div>
            {(appliedCampaign.start_date || appliedCampaign.end_date) && (
              <div className="text-xs">
                Valid: {(appliedCampaign.start_date || "—").slice(0, 10)} → {(appliedCampaign.end_date || "—").slice(0, 10)}
              </div>
            )}
            <div className="text-xs capitalize">Applies to: {(appliedCampaign.applies_to || "all").replace("_", " ")}</div>
          </div>
        )}
      </div>

      <div className="bl-card p-5 space-y-3">
        <div className="font-display text-lg text-[#2D3A33]">Manual discount</div>
        <p className="text-xs text-[#5C6C62]">For ad-hoc adjustments not covered by a campaign.</p>
          <select className="bl-input" disabled={readOnly} value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
            <option value="none">None</option>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed amount (IDR)</option>
          </select>
          {discountType !== "none" && (
            <>
              <input type="number" min="0" className="bl-input font-mono" disabled={readOnly} value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))} />
              <input className="bl-input" disabled={readOnly} placeholder="Reason (required if discount applied)" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} data-testid="discount-reason" />
            </>
          )}
        </div>

        <div className="bl-card p-5 space-y-3">
          <div className="font-display text-lg text-[#2D3A33]">Payment</div>
          {closingLocked && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              This invoice is included in a closed daily closing. Reopen the closing or record a refund/adjustment.
            </p>
          )}
          {(invoice.payments || []).length > 0 && (
            <div className="rounded-lg border border-[#EAE6D7] p-3 space-y-2" data-testid="invoice-payment-history">
              <p className="label-eyebrow">Payment history</p>
              {(invoice.payments || []).map((p) => (
                <div key={p.id} className="flex justify-between gap-2 text-sm">
                  <div>
                    <span className="capitalize">{p.method || "—"}</span>
                    {" · "}
                    <span className="font-mono">{fmtIDR(p.amount_idr)}</span>
                    {p.voided && <span className="text-[#B14A2C] ml-1">(voided)</span>}
                    <div className="text-xs text-[#5C6C62]">
                      {p.created_at ? new Date(p.created_at).toLocaleString() : ""}
                    </div>
                  </div>
                  {canVoidPayment && !p.voided && !closingLocked && (
                    <button type="button" className="text-xs text-[#B14A2C]" onClick={() => voidPayment(p.id)}>
                      Void
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {(invoice.refunds || []).length > 0 && (
            <div className="rounded-lg border border-[#EAE6D7] p-3 space-y-1">
              <p className="label-eyebrow">Refunds recorded</p>
              {invoice.refunds.map((r) => (
                <div key={r.id} className="text-sm flex justify-between">
                  <span className="font-mono">{fmtIDR(r.amount_idr)}</span>
                  <span className="text-xs text-[#5C6C62] capitalize">{r.method}</span>
                </div>
              ))}
            </div>
          )}
          <select
            className="bl-input"
            disabled={readOnlyPayment}
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value);
              if (e.target.value !== "gift_card") setGiftLookup(null);
            }}
            data-testid="invoice-payment-method"
          >
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {paymentMethod === "gift_card" && canRedeemGiftCard && !readOnlyPayment && (
            <GiftCardPaymentFields
              amountDue={preview.outstanding}
              lineItems={items}
              patientId={invoice?.patient_id}
              giftCardCode={giftCardCode}
              onGiftCardCodeChange={setGiftCardCode}
              giftCardAmount={giftCardAmount}
              onGiftCardAmountChange={setGiftCardAmount}
              onLookup={setGiftLookup}
              lookup={giftLookup}
              loading={busy}
              disabled={closed}
              testIdPrefix="invoice-gift"
            />
          )}
          {paymentMethod === "store_credit" && canUseWallet && invoice?.patient_id && !readOnlyPayment && (
            <div className="text-sm space-y-2 rounded-lg border border-[#EAE6D7] p-3">
              <div className="flex justify-between">
                <span className="text-[#5C6C62]">Wallet balance</span>
                <span className="font-mono">{fmtIDR(walletBalance)}</span>
              </div>
              <input
                className="bl-input font-mono"
                placeholder={`Max ${Math.min(walletBalance, preview.outstanding).toLocaleString("id-ID")}`}
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value.replace(/\D/g, ""))}
                data-testid="invoice-wallet-amount"
              />
            </div>
          )}
          <input className="bl-input" disabled={readOnlyPayment} placeholder="Reference (optional)" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
          {paymentMethod !== "gift_card" && paymentMethod !== "store_credit" && (
            <div>
              <label className="label-eyebrow block mb-1">Amount received (IDR)</label>
              <input
                type="text"
                inputMode="numeric"
                className="bl-input font-mono"
                disabled={readOnlyPayment || closed}
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value.replace(/\D/g, ""))}
                data-testid="invoice-amount-received"
              />
              <PaymentAmountQuickFill
                balanceDue={preview.outstanding}
                paymentMethod={paymentMethod}
                disabled={readOnlyPayment || closed}
                onSelectAmount={(amount) => setAmountReceived(String(amount))}
                onClear={() => setAmountReceived("")}
                testIdPrefix="invoice-payment-quick"
              />
            </div>
          )}
          <div className="text-sm text-[#5C6C62] space-y-1">
            {preview.alreadyPaid > 0 && (
              <div>Already paid: {fmtIDR(preview.alreadyPaid)}</div>
            )}
            <div>Balance: {fmtIDR(preview.outstanding)}</div>
            {isCashPayment(paymentMethod) && computeChangeDue(amountReceived, preview.outstanding) > 0 && (
              <div data-testid="invoice-change-due">
                Change due: {fmtIDR(computeChangeDue(amountReceived, preview.outstanding))}
              </div>
            )}
            {preview.remaining > 0 && preview.remaining < preview.outstanding && (
              <div>Remaining after payment: {fmtIDR(preview.remaining)}</div>
            )}
          </div>
          <textarea className="bl-input min-h-[72px]" disabled={readOnlyPayment} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

      {canEdit && invoice.payment_status !== "cancelled" && (
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy || readOnlyPayment} onClick={saveInvoice} className="bl-btn-primary w-full disabled:opacity-50">Save invoice</button>
          <button type="button" disabled={busy || readOnlyPayment} onClick={() => savePayment(false)} className="bl-btn-ghost w-full disabled:opacity-50">Update payment</button>
          {!closed && !closingLocked && (
            <button type="button" disabled={busy} onClick={() => savePayment(true)} className="bl-btn-ghost w-full inline-flex items-center justify-center gap-2 disabled:opacity-50" data-testid="mark-paid-button">
              <CheckCircle2 className="w-4 h-4" /> Mark as paid
            </button>
          )}
          {canRecordRefund && (invoice.amount_paid || 0) > 0 && (
            <button type="button" disabled={busy} onClick={recordRefund} className="bl-btn-ghost w-full text-sm" data-testid="invoice-record-refund">
              Record refund
            </button>
          )}
          {closed && invoice.visit?.status !== "completed" && (
            <button type="button" onClick={closeVisitIfPaid} className="bl-btn-ghost w-full">Close treatment session</button>
          )}
        </div>
      )}
        </div>
      </div>

      {!canEdit && (
        <p className="mt-6 text-sm text-[#5C6C62]">Billing view only — contact front office to collect payment.</p>
      )}
    </div>
  );
}
