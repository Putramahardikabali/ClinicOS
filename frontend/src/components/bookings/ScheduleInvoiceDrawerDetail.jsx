import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import api from "@/lib/api";
import { formatIdr } from "@/lib/clinic";
import { hasPermission, useAuth } from "@/lib/auth";
import {
  CLINICAL_PERFORMER_ROLES,
} from "@/lib/performerUtils";
import InvoiceLineItemRow from "@/components/invoices/InvoiceLineItemRow";
import InvoiceAddItemBar from "@/components/invoices/InvoiceAddItemBar";
import InvoiceCheckoutPanel from "@/components/invoices/InvoiceCheckoutPanel";
import { resolveLineQuantity, lineGrossIdr } from "@/lib/invoiceLineQuantity";
import { buildInvoicePaymentPreview } from "@/lib/invoicePaymentPreview";
import {
  canEditInvoiceItems,
  emptyInvoiceItem,
  invoiceItemsSnapshot,
  mapInvoiceItemsForEdit,
  serializeInvoiceItems,
} from "@/lib/invoiceItemEditing";
import { resolveGiftCardRedemption } from "@/lib/giftCardRedemption";
import { isCashPayment } from "@/lib/paymentAmountQuickFill";
import { toast } from "sonner";

const fmtIDR = (n) => formatIdr(n);

function statusChipClass(status) {
  if (status === "paid") return "success";
  if (status === "partial") return "info";
  return "warning";
}

function lineDisplayAmount(it) {
  if (it.paid_by === "package") return 0;
  return lineGrossIdr(it);
}

function lineServiceValue(it) {
  if (it.original_treatment_value != null) return Number(it.original_treatment_value) || 0;
  return lineGrossIdr(it);
}

export function ScheduleInvoiceDrawerDetail({
  invoiceId,
  onBack,
  onPaymentSuccess,
  onDirtyChange,
  visitId,
  canCreateInvoice = false,
}) {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "billing.edit") || hasPermission(user, "billing.create");
  const canRedeemGiftCard = hasPermission(user, "gift_cards.redeem");
  const canRedeemPrepaid = hasPermission(user, "prepaid.redeem");
  const canUseWallet = hasPermission(user, "wallet.use");
  const canVoidPayment = hasPermission(user, "payments.void") || hasPermission(user, "billing.edit");
  const canRecordRefund = hasPermission(user, "refunds.create");

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [resolvedId, setResolvedId] = useState(invoiceId);
  const [viewMode, setViewMode] = useState("detail");
  const [editItems, setEditItems] = useState([]);
  const editBaselineRef = useRef("");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
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
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");

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

  const applyInvoice = useCallback((inv) => {
    setInvoice(inv);
    setDiscountType(inv.discount_type || "none");
    setDiscountValue(inv.discount_value || 0);
    setDiscountReason(inv.discount_reason || "");
    setNotes(inv.notes || "");
    setPaymentMethod(inv.payment_method || "cash");
    setPaymentReference(inv.payment_reference || "");
    setAmountReceived("");
    setSelectedCampaignId(inv.campaign_id || "");
  }, []);

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

  useEffect(() => {
    setResolvedId(invoiceId);
  }, [invoiceId]);

  const load = useCallback(async () => {
    if (!resolvedId) return;
    setLoading(true);
    try {
      const r = await api.get(`/invoices/${resolvedId}`);
      applyInvoice(r.data);
    } catch {
      toast.error("Invoice not found");
      onBack?.();
    } finally {
      setLoading(false);
    }
  }, [resolvedId, applyInvoice, onBack]);

  useEffect(() => {
    load();
  }, [load]);

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
      return;
    }
    api.get(`/patients/${invoice.patient_id}/patient-packages`)
      .then((r) => setPatientPackages((r.data || []).filter((p) => ["active", "partially_used"].includes(p.status) && p.remaining_sessions > 0)))
      .catch(() => setPatientPackages([]));
  }, [invoice?.patient_id, invoice?.updated_at]);

  const readOnlyItems = invoice
    ? mapInvoiceItemsForEdit(invoice.items || [])
    : [];
  const activeItems = viewMode === "edit-items" ? editItems : readOnlyItems;

  const itemsDirty = viewMode === "edit-items"
    && invoiceItemsSnapshot(editItems) !== editBaselineRef.current;

  useEffect(() => {
    onDirtyChange?.(itemsDirty);
  }, [itemsDirty, onDirtyChange]);

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

  const preview = useMemo(
    () => buildInvoicePaymentPreview({
      items: activeItems,
      discountType,
      discountValue,
      amountReceived,
      prepaidAmount,
      amountPaid: invoice?.amount_paid,
    }),
    [activeItems, discountType, discountValue, amountReceived, prepaidAmount, invoice?.amount_paid],
  );

  const giftRedemption = useMemo(
    () => resolveGiftCardRedemption({
      card: giftLookup?.card,
      lineItems: activeItems,
      patientId: invoice?.patient_id,
      amountDue: preview.outstanding,
      userEnteredAmount: giftCardAmount,
    }),
    [giftLookup, activeItems, invoice?.patient_id, preview.outstanding, giftCardAmount],
  );

  const appliedCampaign = useMemo(() => {
    if (!invoice?.campaign_id) return null;
    return campaigns.find((c) => c.id === invoice.campaign_id) || {
      id: invoice.campaign_id,
      name: invoice.campaign_name_snapshot,
    };
  }, [invoice, campaigns]);

  const closingLocked = invoice?.closing_locked;
  const closed = invoice?.payment_status === "paid";
  const itemsEditable = canEditInvoiceItems({
    canEdit,
    paymentStatus: invoice?.payment_status,
    closingLocked,
  });

  const confirmDiscard = () => {
    if (!itemsDirty) return true;
    return window.confirm("Discard unsaved changes?");
  };

  const handleBack = () => {
    if (!confirmDiscard()) return;
    setViewMode("detail");
    setEditItems([]);
    setEditingItem(null);
    setAddMode(null);
    onBack?.();
  };

  const startEditItems = () => {
    const mapped = mapInvoiceItemsForEdit(invoice?.items || []);
    setEditItems(mapped);
    editBaselineRef.current = invoiceItemsSnapshot(mapped);
    setViewMode("edit-items");
    setEditingItem(null);
    setAddMode(null);
    loadCatalogs();
  };

  const cancelEditItems = () => {
    if (!confirmDiscard()) return;
    setViewMode("detail");
    setEditItems([]);
    setEditingItem(null);
    setAddMode(null);
  };

  const updateItem = (idx, patch) => {
    setEditItems((prev) => prev.map((it, i) => {
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
    const it = editItems[idx];
    if (it?.paid_by === "package") {
      toast.error("Reverse package usage before removing this line");
      return;
    }
    if (it?.package_usage_id || it?.patient_package_id) {
      if (!window.confirm("Removing this line may affect package benefits. Continue?")) return;
    }
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
    setEditingItem(null);
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
    const nextIdx = editItems.length;
    setEditItems((prev) => [...prev, emptyInvoiceItem(defaultPerformer)]);
    setEditingItem({ idx: nextIdx, mode: "item" });
    setAddMode(null);
  };

  const addCatalogLine = async () => {
    if (!pickId || !invoice?.id) return;
    setBusy(true);
    try {
      const r = await api.post(`/invoices/${invoice.id}/items/catalog`, {
        item_type: pickType,
        catalog_id: pickId,
        quantity: 1,
      });
      applyInvoice(r.data);
      const mapped = mapInvoiceItemsForEdit(r.data.items || []);
      setEditItems(mapped);
      editBaselineRef.current = invoiceItemsSnapshot(mapped);
      setPickId("");
      toast.success("Item added");
      onPaymentSuccess?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add item");
    } finally {
      setBusy(false);
    }
  };

  const saveItems = async () => {
    if (!invoice?.id) return;
    if (preview.discountAmount > 0 && !discountReason.trim() && !invoice?.campaign_id) {
      toast.error("Discount reason is required");
      return;
    }
    if ((invoice.amount_paid || 0) > preview.total) {
      toast.warning("Paid amount exceeds invoice total. Please create adjustment/refund.");
    }
    setBusy(true);
    try {
      const r = await api.put(`/invoices/${invoice.id}`, {
        items: serializeInvoiceItems(editItems),
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
        discount_reason: discountReason,
        notes,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
      });
      applyInvoice(r.data);
      setViewMode("detail");
      setEditItems([]);
      setEditingItem(null);
      setAddMode(null);
      editBaselineRef.current = "";
      toast.success("Invoice updated.");
      onPaymentSuccess?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const savePayment = async (markPaid = false) => {
    if (!invoice?.id) return;
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
        if (giftRedemption.showAmountInput) toast.error("Enter amount to redeem");
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
      onPaymentSuccess?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const createInvoiceFromVisit = async () => {
    if (!visitId || !canCreateInvoice) return;
    setCreateBusy(true);
    try {
      const r = await api.post(`/invoices/visit/${visitId}`);
      setResolvedId(r.data.id);
      applyInvoice(r.data);
      toast.success("Invoice created");
      onPaymentSuccess?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create invoice");
    } finally {
      setCreateBusy(false);
    }
  };

  const catalogOptions = pickType === "treatment" ? treatments : pickType === "package" ? packages : products;

  if (!resolvedId && !visitId) {
    return (
      <div className="p-6 text-sm text-[#5C6C62]">
        <button type="button" onClick={handleBack} className="text-[#52796F] hover:underline inline-flex items-center gap-1 mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to invoices
        </button>
        Invoice not available.
      </div>
    );
  }

  if (!resolvedId && visitId && canCreateInvoice) {
    return (
      <div className="flex flex-col h-full min-h-0" data-testid="schedule-invoice-create-prompt">
        <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0 flex items-center gap-2">
          <button type="button" onClick={handleBack} className="text-sm text-[#52796F] hover:text-[#2D3A33] inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to invoices
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-4 py-6 text-center space-y-4">
          <p className="text-sm text-[#5C6C62]">This appointment has no invoice yet.</p>
          <button
            type="button"
            className="bl-btn-primary"
            disabled={createBusy}
            onClick={createInvoiceFromVisit}
            data-testid="schedule-invoice-create"
          >
            {createBusy ? "Creating…" : "Create invoice"}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !invoice) {
    return (
      <div className="p-6 text-sm text-[#5C6C62]" data-testid="schedule-invoice-detail-loading">
        Loading invoice…
      </div>
    );
  }

  const readOnly = !canEdit || invoice.payment_status === "cancelled";
  const readOnlyPayment = readOnly || closingLocked;
  const paymentStatus = invoice.payment_status || preview.status;
  const createdLabel = (invoice.created_at || "").slice(0, 16).replace("T", " ");
  const editingItems = viewMode === "edit-items";

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="schedule-invoice-detail">
      <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0 space-y-2">
        <button
          type="button"
          onClick={handleBack}
          className="text-sm text-[#52796F] hover:text-[#2D3A33] inline-flex items-center gap-1"
          data-testid="schedule-invoice-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back to invoices
        </button>
        <div className="flex items-start justify-between gap-2 pr-8">
          <div className="min-w-0">
            <h2 className="font-display text-lg text-[#2D3A33] truncate">{invoice.invoice_number}</h2>
            <p className="text-sm text-[#5C6C62] truncate">
              {invoice.patient?.full_name || invoice.patient_name || "Patient"}
            </p>
            <p className="text-xs text-[#A89F8B] mt-0.5">{createdLabel}</p>
          </div>
          <span className={`bl-chip shrink-0 ${statusChipClass(paymentStatus)}`}>
            {paymentStatus}
          </span>
        </div>
        {editingItems && (
          <p className="text-xs text-[#52796F] font-medium">Editing items</p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-4">
        <div className="rounded-lg border border-[#EAE6D7] bg-white overflow-hidden">
          <div className="px-3 py-2 bg-[#F8F5EC] flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-widest text-[#5C6C62]">Line items</span>
            {!editingItems && itemsEditable && (
              <button
                type="button"
                className="text-xs text-[#52796F] hover:text-[#2D3A33] inline-flex items-center gap-1 font-medium"
                onClick={startEditItems}
                data-testid="schedule-invoice-edit-items"
              >
                <Pencil className="w-3 h-3" /> Edit items
              </button>
            )}
          </div>

          {closed && !editingItems && (
            <p className="px-3 py-3 text-xs text-[#5C6C62] border-b border-[#EAE6D7]">
              Paid invoices cannot be edited directly. Use adjustment/refund or reopen the business day if permitted.
            </p>
          )}

          {editingItems ? (
            <div className="p-3 space-y-2">
              {editItems.length === 0 && (
                <p className="text-sm text-[#5C6C62] py-2 text-center">No items — add from catalog or custom line.</p>
              )}
              {editItems.map((it, idx) => (
                <InvoiceLineItemRow
                  key={it.id || `new-${idx}`}
                  item={it}
                  idx={idx}
                  readOnly={false}
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
                  eligibleOptions={[]}
                  packagePick={packagePick[it.id]}
                  onPackagePickChange={(val) => setPackagePick((prev) => ({ ...prev, [it.id]: val }))}
                  onPayWithPackage={() => {}}
                  packageBusy={packageBusy === it.id}
                />
              ))}
              <InvoiceAddItemBar
                readOnly={false}
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
          ) : activeItems.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[#5C6C62]">No line items.</p>
          ) : (
            <ul className="divide-y divide-[#EAE6D7]">
              {activeItems.map((it) => (
                <li key={it.id} className="px-3 py-2.5 text-sm flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-[#2D3A33] truncate">{it.name}</div>
                    <div className="text-xs text-[#5C6C62]">
                      {resolveLineQuantity(it)} × {fmtIDR(it.unit_price_idr ?? it.price_idr ?? 0)}
                      {it.paid_by === "package" && " · Package"}
                    </div>
                  </div>
                  <span className="font-mono shrink-0">{fmtIDR(lineDisplayAmount(it))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-[#EAE6D7] bg-white p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Subtotal</span>
            <span className="font-mono">{fmtIDR(preview.subtotal)}</span>
          </div>
          {preview.discountAmount > 0 && (
            <div className="flex justify-between text-[#B14A2C]">
              <span>Discount{invoice.campaign_name_snapshot ? ` (${invoice.campaign_name_snapshot})` : ""}</span>
              <span className="font-mono">−{fmtIDR(preview.discountAmount)}</span>
            </div>
          )}
          {(invoice.prepaid_payment_total_idr || 0) > 0 && (
            <div className="flex justify-between text-[#52796F]">
              <span>Prepaid applied</span>
              <span className="font-mono">−{fmtIDR(invoice.prepaid_payment_total_idr)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium pt-1 border-t border-[#EAE6D7]">
            <span>Total</span>
            <span className="font-mono">{fmtIDR(preview.total)}</span>
          </div>
          <div className="flex justify-between text-[#52796F]">
            <span>Amount paid</span>
            <span className="font-mono">{fmtIDR(preview.alreadyPaid)}</span>
          </div>
          <div className="flex justify-between font-display text-base text-[#2D3A33] pt-1">
            <span>Balance</span>
            <span className="font-mono">{fmtIDR(closed ? 0 : preview.outstanding)}</span>
          </div>
          {(invoice.amount_paid || 0) > preview.total && (
            <p className="text-xs text-[#B14A2C] pt-1">
              Paid amount exceeds invoice total. Please create adjustment/refund.
            </p>
          )}
        </div>

        {editingItems ? (
          <div className="flex flex-wrap gap-2 sticky bottom-0 bg-[#FDFBF7] py-2 border-t border-[#EAE6D7] -mx-4 px-4">
            <button
              type="button"
              className="bl-btn-primary flex-1 min-w-[120px]"
              disabled={busy}
              onClick={saveItems}
              data-testid="schedule-invoice-save-items"
            >
              {busy ? "Saving…" : "Save invoice"}
            </button>
            <button
              type="button"
              className="bl-btn-ghost flex-1 min-w-[120px]"
              disabled={busy}
              onClick={cancelEditItems}
              data-testid="schedule-invoice-cancel-items"
            >
              Cancel changes
            </button>
          </div>
        ) : (
          <InvoiceCheckoutPanel
            compact
            invoice={{ ...invoice, items: activeItems }}
            preview={preview}
            appliedCampaign={appliedCampaign}
            campaigns={campaigns}
            selectedCampaignId={selectedCampaignId}
            onCampaignSelect={setSelectedCampaignId}
            onApplyCampaign={() => {}}
            campaignBusy={false}
            discountType={discountType}
            discountValue={discountValue}
            discountReason={discountReason}
            onDiscountTypeChange={() => {}}
            onDiscountValueChange={() => {}}
            onDiscountReasonChange={() => {}}
            onClearAdjustments={() => {}}
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
            onSaveInvoice={() => {}}
            onSavePayment={() => savePayment(false)}
            onMarkPaid={() => savePayment(true)}
            onVoidPayment={async (paymentId) => {
              const reason = window.prompt("Void reason (required):");
              if (!reason || reason.trim().length < 3) return;
              setBusy(true);
              try {
                const r = await api.post(`/invoices/${invoice.id}/payments/${paymentId}/void`, { reason: reason.trim() });
                applyInvoice(r.data);
                toast.success("Payment voided");
                onPaymentSuccess?.(r.data);
              } catch (e) {
                toast.error(e?.response?.data?.detail || "Could not void payment");
              } finally {
                setBusy(false);
              }
            }}
            onRecordRefund={() => {}}
            onCloseVisit={() => {}}
          />
        )}

        {!canEdit && !editingItems && (
          <p className="text-xs text-[#5C6C62]">View only — you do not have permission to edit or collect payment.</p>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[#EAE6D7] bg-[#FAFAF7]">
        <a
          href={`/invoices/${invoice.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[#52796F] hover:underline"
          data-testid="schedule-invoice-open-full"
        >
          Open full invoice page
        </a>
      </div>
    </div>
  );
}
