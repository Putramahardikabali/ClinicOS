import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  serializeItemPerformers,
  CLINICAL_PERFORMER_ROLES,
} from "@/lib/performerUtils";
import InvoiceLineItemRow from "@/components/invoices/InvoiceLineItemRow";
import InvoiceAddItemBar from "@/components/invoices/InvoiceAddItemBar";
import InvoiceCheckoutPanel from "@/components/invoices/InvoiceCheckoutPanel";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { resolveLineQuantity, lineGrossIdr } from "@/lib/invoiceLineQuantity";
import { toast } from "sonner";
import { ArrowLeft, Printer } from "lucide-react";
import { resolveGiftCardRedemption } from "@/lib/giftCardRedemption";
import { hasPermission } from "@/lib/auth";
import { isCashPayment } from "@/lib/paymentAmountQuickFill";

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
  const [selectedPrepaidId, setSelectedPrepaidId] = useState("");
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [giftLookup, setGiftLookup] = useState(null);
  const [busy, setBusy] = useState(false);
  const canRedeemGiftCard = hasPermission(user, "gift_cards.redeem");
  const canRedeemPrepaid = hasPermission(user, "prepaid.redeem");
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
  const [editingItem, setEditingItem] = useState(null);
  const [addMode, setAddMode] = useState(null);

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
    if (!canEdit || !invoice?.id) return;
    const invoiceDate = (invoice?.created_at || "").slice(0, 10);
    api.get("/campaigns/active", {
      params: {
        ...(invoiceDate ? { date: invoiceDate } : {}),
        invoice_id: invoice.id,
      },
    })
      .then((r) => setCampaigns(r.data || []))
      .catch(() => setCampaigns([]));
  }, [canEdit, invoice?.id, invoice?.created_at, items]);

  const appliedCampaign = useMemo(() => {
    if (!invoice?.campaign_id) return null;
    return campaigns.find((c) => c.id === invoice.campaign_id) || {
      id: invoice.campaign_id,
      name: invoice.campaign_name_snapshot,
      code: invoice.campaign_code_snapshot,
      discount_type: invoice.discount_type_snapshot,
      discount_value: invoice.discount_value_snapshot,
      applies_to: invoice.applies_to_snapshot,
      eligible_summary_snapshot: invoice.eligible_summary_snapshot,
      start_date: null,
      end_date: null,
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
    const prepaidApply = parseInt(String(prepaidAmount).replace(/\D/g, ""), 10) || 0;
    const outstanding = Math.max(0, total - alreadyPaid);
    const cashDueAfterPrepaid = Math.max(0, outstanding - prepaidApply);
    const hasPackageCovered = items.some((it) => it.paid_by === "package");
    let status = "unpaid";
    if (total === 0 && hasPackageCovered) status = "paid";
    else if (alreadyPaid + received + prepaidApply >= total && total > 0) status = "paid";
    else if (alreadyPaid + received + prepaidApply > 0) status = "partial";
    return {
      subtotal,
      serviceSubtotal,
      packageCovered,
      discountAmount,
      total,
      alreadyPaid,
      outstanding,
      cashDueAfterPrepaid,
      remaining: Math.max(0, cashDueAfterPrepaid - received),
      status,
    };
  }, [items, discountType, discountValue, amountReceived, prepaidAmount, invoice?.amount_paid]);

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
    const prepaidApply = parseInt(String(prepaidAmount).replace(/\D/g, ""), 10) || 0;
    if (!markPaid && paymentMethod !== "gift_card" && paymentMethod !== "store_credit") {
      if (received <= 0 && prepaidApply <= 0) {
        toast.error("Enter amount received or apply prepaid");
        return;
      }
      if (prepaidApply > preview.outstanding) {
        toast.error("Prepaid cannot exceed balance due");
        return;
      }
      if (!isCashPayment(paymentMethod) && received > preview.cashDueAfterPrepaid) {
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
        prepaid_id: prepaidApply > 0 && selectedPrepaidId ? selectedPrepaidId : undefined,
        prepaid_amount_idr: prepaidApply > 0 ? prepaidApply : undefined,
      });
      applyInvoice(r.data);
      setSelectedPrepaidId("");
      setPrepaidAmount("");
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

  const addCustomLine = () => {
    const nextIdx = items.length;
    setItems([...items, emptyItem(defaultPerformer)]);
    setEditingItem({ idx: nextIdx, mode: "item" });
    setAddMode(null);
  };
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

  const clearAdjustments = async () => {
    setDiscountType("none");
    setDiscountValue(0);
    setDiscountReason("");
    setSelectedCampaignId("");
    if (invoice?.campaign_id) {
      await applyCampaign(null);
    }
  };

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
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="invoice-detail-page">
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
        <div className="flex flex-wrap gap-2 items-center">
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
          Active packages available — edit a treatment line to pay with package.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <div className="bl-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-display text-lg text-[#2D3A33]">Invoice items</div>
              <span className="text-xs text-[#5C6C62]">{items.length} item{items.length === 1 ? "" : "s"}</span>
            </div>

            {items.length > 0 && (
              <div className="hidden md:grid grid-cols-[minmax(0,2fr)_auto_auto_auto_minmax(0,1.2fr)_auto] gap-3 px-4 text-xs uppercase tracking-widest text-[#5C6C62]">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit</span>
                <span className="text-right">Total</span>
                <span>Staff</span>
                <span className="text-right">Actions</span>
              </div>
            )}

            {items.length === 0 && (
              <p className="text-sm text-[#5C6C62] py-4 text-center">
                No items yet — add from catalog or enter a custom line.
              </p>
            )}

            <div className="space-y-2">
              {items.map((it, idx) => (
                <InvoiceLineItemRow
                  key={it.id || idx}
                  item={it}
                  idx={idx}
                  readOnly={readOnly}
                  performers={performers}
                  editing={editingItem}
                  onEdit={() => setEditingItem({ idx, mode: "item" })}
                  onEditStaff={() => setEditingItem({ idx, mode: "staff" })}
                  onCancelEdit={() => setEditingItem(null)}
                  onUpdate={(patch) => updateItem(idx, patch)}
                  onRemove={() => removeItem(idx)}
                  onPerformersChange={(built) => setItemPerformers(idx, built)}
                  lineDisplayAmount={lineDisplayAmount}
                  lineServiceValue={lineServiceValue}
                  eligibleOptions={
                    !readOnly && canEdit && it.paid_by !== "package" && ["treatment", "custom"].includes(it.item_type)
                      ? eligibleOptionsForItem(it)
                      : []
                  }
                  packagePick={packagePick[it.id]}
                  onPackagePickChange={(val) => setPackagePick((prev) => ({ ...prev, [it.id]: val }))}
                  onPayWithPackage={() => payLineWithPackage(it)}
                  packageBusy={packageBusy === it.id}
                />
              ))}
            </div>

            <InvoiceAddItemBar
              readOnly={readOnly}
              defaultPerformer={defaultPerformer}
              pickType={pickType}
              pickId={pickId}
              catalogOptions={catalogOptions}
              busy={busy}
              addMode={addMode}
              onSetAddMode={setAddMode}
              onPickTypeChange={(v) => { setPickType(v); setPickId(""); }}
              onPickIdChange={setPickId}
              onAddCatalog={addCatalogLine}
              onAddCustom={addCustomLine}
            />
          </div>
        </div>

        <div className="lg:sticky lg:top-6 space-y-4">
          <InvoiceCheckoutPanel
            invoice={{ ...invoice, items }}
            preview={preview}
            appliedCampaign={appliedCampaign}
            campaigns={campaigns}
            selectedCampaignId={selectedCampaignId}
            onCampaignSelect={setSelectedCampaignId}
            onApplyCampaign={applyCampaign}
            campaignBusy={campaignBusy}
            discountType={discountType}
            discountValue={discountValue}
            discountReason={discountReason}
            onDiscountTypeChange={setDiscountType}
            onDiscountValueChange={setDiscountValue}
            onDiscountReasonChange={setDiscountReason}
            onClearAdjustments={clearAdjustments}
            paymentMethod={paymentMethod}
            paymentReference={paymentReference}
            amountReceived={amountReceived}
            notes={notes}
            onPaymentMethodChange={(v) => {
              setPaymentMethod(v);
              if (v !== "gift_card") setGiftLookup(null);
            }}
            onPaymentReferenceChange={setPaymentReference}
            onAmountReceivedChange={setAmountReceived}
            onNotesChange={setNotes}
            giftCardCode={giftCardCode}
            giftCardAmount={giftCardAmount}
            walletAmount={walletAmount}
            walletBalance={walletBalance}
            giftLookup={giftLookup}
            onGiftCardCodeChange={setGiftCardCode}
            onGiftCardAmountChange={setGiftCardAmount}
            onGiftLookup={setGiftLookup}
            onWalletAmountChange={setWalletAmount}
            canRedeemGiftCard={canRedeemGiftCard}
            canRedeemPrepaid={canRedeemPrepaid}
            selectedPrepaidId={selectedPrepaidId}
            onSelectedPrepaidIdChange={setSelectedPrepaidId}
            prepaidAmount={prepaidAmount}
            onPrepaidAmountChange={setPrepaidAmount}
            prepaidAppliedPreview={parseInt(String(prepaidAmount).replace(/\D/g, ""), 10) || 0}
            canUseWallet={canUseWallet}
            canVoidPayment={canVoidPayment}
            canRecordRefund={canRecordRefund}
            canEdit={canEdit}
            readOnly={readOnly}
            readOnlyPayment={readOnlyPayment}
            closed={closed}
            closingLocked={closingLocked}
            busy={busy}
            onSaveInvoice={saveInvoice}
            onSavePayment={() => savePayment(false)}
            onMarkPaid={() => savePayment(true)}
            onVoidPayment={voidPayment}
            onRecordRefund={recordRefund}
            onCloseVisit={closeVisitIfPaid}
          />
        </div>
      </div>

      {!canEdit && (
        <p className="mt-6 text-sm text-[#5C6C62]">Billing view only — contact front office to collect payment.</p>
      )}
    </div>
  );
}
