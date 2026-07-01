import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { toast } from "sonner";
import PosCustomerBar from "@/components/pos/PosCustomerBar";
import PosItemPicker, { emptyDraft } from "@/components/pos/PosItemPicker";
import PosCartTable from "@/components/pos/PosCartTable";
import PosPaymentPanel from "@/components/pos/PosPaymentPanel";
import PosReceiptBar from "@/components/pos/PosReceiptBar";
import PosReceiptDocument from "@/components/pos/PosReceiptDocument";
import PosSaleGiftCardsPrint from "@/components/pos/PosSaleGiftCardsPrint";
import { saleHasGiftCardItems } from "@/lib/posGiftCardSale";
import { printPosReceipt } from "@/lib/posReceipt";
import PosDayClosingSnippet from "@/components/pos/PosDayClosingSnippet";
import { buildGiftCardCartLine } from "@/lib/posGiftCard";
import { buildPrepaidCartLine } from "@/lib/posPrepaid";
import { resolveGiftCardRedemption } from "@/lib/giftCardRedemption";
import { computeInvoiceDiscount, lineTotal, parseIdr, receiptPhone } from "@/lib/posUtils";
import { isCashPayment } from "@/lib/paymentAmountQuickFill";

export default function PosNewSaleTab({ onSaleCompleted, closingRefreshKey = 0 }) {
  const { user } = useAuth();
  const { branding } = useSettings();
  const canCreate = hasPermission(user, "pos.create");
  const canRedeemGiftCard = hasPermission(user, "gift_cards.redeem");
  const canUseWallet = hasPermission(user, "wallet.use");
  const canMessaging =
    hasPermission(user, "messaging.send") || hasPermission(user, "messaging.manage");

  const [walkIn, setWalkIn] = useState(true);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientOptions, setPatientOptions] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [activeTab, setActiveTab] = useState("product");
  const [draft, setDraft] = useState(emptyDraft("product"));
  const [cart, setCart] = useState([]);
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [taxTotal, setTaxTotal] = useState("0");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardAmount, setGiftCardAmount] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [overpaymentToWallet, setOverpaymentToWallet] = useState(false);
  const [giftLookup, setGiftLookup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [messagingEnabled, setMessagingEnabled] = useState(false);
  const clinicName = branding?.clinic_name || "Clinic";

  useEffect(() => {
    api.get("/settings/messaging").then((r) => setMessagingEnabled(!!r.data?.automation_active)).catch(() => {});
  }, []);

  useEffect(() => {
    setDraft(emptyDraft(activeTab));
  }, [activeTab]);

  const searchPatients = useCallback(async (q) => {
    if (!q?.trim()) {
      setPatientOptions([]);
      return;
    }
    try {
      const r = await api.get("/patients", { params: { q: q.trim(), page: 1, page_size: 10 } });
      const items = Array.isArray(r.data) ? r.data : r.data?.items || [];
      setPatientOptions(items);
    } catch {
      setPatientOptions([]);
    }
  }, []);

  const subtotal = useMemo(() => cart.reduce((s, ln) => s + lineTotal(ln), 0), [cart]);
  const discountAmount = useMemo(
    () => computeInvoiceDiscount(subtotal, discountType, discountValue),
    [subtotal, discountType, discountValue],
  );
  const tax = parseInt(taxTotal, 10) || 0;
  const total = useMemo(() => Math.max(0, subtotal - discountAmount + tax), [subtotal, discountAmount, tax]);
  const giftRedemption = useMemo(
    () => resolveGiftCardRedemption({
      card: giftLookup?.card,
      lineItems: cart,
      patientId: selectedPatient?.id,
      amountDue: total,
      userEnteredAmount: giftCardAmount,
    }),
    [giftLookup, cart, selectedPatient?.id, total, giftCardAmount],
  );
  const gcApplied = giftRedemption.standaloneRedeem ? 0 : parseIdr(giftCardAmount);
  const walletApplied = parseIdr(walletAmount);
  const cashDue = Math.max(0, total - gcApplied - walletApplied);
  const paid = amountPaid === "" ? cashDue : parseIdr(amountPaid);
  const balanceDue = Math.max(0, total - gcApplied - walletApplied - paid);
  const cartHasPackage = cart.some((ln) => ln.item_type === "package");
  const cartHasPrepaid = cart.some((ln) => ln.item_type === "prepaid");

  const updateCartLine = (key, patch) => {
    setCart((prev) => prev.map((ln) => (ln.key === key ? { ...ln, ...patch } : ln)));
  };

  const addToCart = () => {
    const qty = parseFloat(draft.qty) || 1;
    const unitPrice = parseIdr(draft.unitPrice);
    const lineDisc = parseInt(draft.discount, 10) || 0;
    let line = null;

    if (activeTab === "product") {
      if (!draft.selectedProduct) {
        toast.error("Select a product");
        return;
      }
      const p = draft.selectedProduct;
      line = {
        key: crypto.randomUUID(),
        item_type: "product",
        product_id: p.id,
        name_snapshot: p.name,
        qty: String(qty),
        unit_price: String(unitPrice || p.sale_price_idr || ""),
        discount: String(lineDisc),
        price_not_set: !p.sale_price_idr && !unitPrice,
      };
    } else if (activeTab === "package") {
      if (!draft.selectedPackage) {
        toast.error("Select a package");
        return;
      }
      const p = draft.selectedPackage;
      line = {
        key: crypto.randomUUID(),
        item_type: "package",
        package_catalog_id: p.id,
        name_snapshot: p.name,
        qty: String(qty),
        unit_price: String(unitPrice || p.price_idr || ""),
        discount: String(lineDisc),
      };
    } else if (activeTab === "service") {
      if (!draft.selectedService) {
        toast.error("Select a treatment");
        return;
      }
      const t = draft.selectedService;
      line = {
        key: crypto.randomUUID(),
        item_type: "service",
        treatment_catalog_id: t.id,
        name_snapshot: t.name,
        qty: String(qty),
        unit_price: String(unitPrice || t.price_idr || ""),
        discount: String(lineDisc),
      };
    } else if (activeTab === "gift_card") {
      const built = buildGiftCardCartLine(draft);
      if (built.error) {
        toast.error(built.error);
        return;
      }
      line = built.line;
    } else if (activeTab === "prepaid") {
      const built = buildPrepaidCartLine(draft);
      if (built.error) {
        toast.error(built.error);
        return;
      }
      line = built.line;
    } else {
      if (!draft.customName.trim()) {
        toast.error("Enter line name");
        return;
      }
      if (!unitPrice) {
        toast.error("Enter unit price");
        return;
      }
      line = {
        key: crypto.randomUUID(),
        item_type: "custom",
        name_snapshot: draft.customName.trim(),
        qty: String(qty),
        unit_price: String(unitPrice),
        discount: String(lineDisc),
        metadata: { notes: draft.customNotes.trim() || undefined },
      };
    }

    if (line?.price_not_set && !String(line.unit_price).trim()) {
      toast.error("Set unit price");
      return;
    }
    setCart((prev) => [...prev, line]);
    setDraft(emptyDraft(activeTab));
  };

  const buildItems = () =>
    cart.map((ln) => ({
      item_type: ln.item_type,
      product_id: ln.product_id || undefined,
      package_catalog_id: ln.package_catalog_id || undefined,
      treatment_catalog_id: ln.treatment_catalog_id || undefined,
      name_snapshot: ln.name_snapshot,
      qty: parseFloat(ln.qty) || 1,
      unit_price: parseIdr(ln.unit_price),
      discount: parseInt(ln.discount, 10) || 0,
      metadata: ln.metadata,
    }));

  const validateCustomer = () => {
    if (cartHasPackage && !selectedPatient) {
      toast.error("Select a patient — packages create a patient package after payment");
      return false;
    }
    if (cartHasPrepaid && !selectedPatient) {
      toast.error("Select a patient — prepaid is issued to the patient after payment");
      return false;
    }
    if (!walkIn && !selectedPatient) {
      toast.error("Enable walk-in or select a patient");
      return false;
    }
    if (walkIn && !selectedPatient && !customerName.trim()) {
      toast.error("Enter walk-in customer name");
      return false;
    }
    for (const ln of cart) {
      if (ln.price_not_set && !String(ln.unit_price).trim()) {
        toast.error(`Set price for ${ln.name_snapshot}`);
        return false;
      }
    }
    return true;
  };

  const salePayload = (complete) => ({
    patient_id: selectedPatient?.id,
    customer_name: walkIn && !selectedPatient ? customerName.trim() : undefined,
    customer_phone: (customerPhone || selectedPatient?.phone || "").trim() || undefined,
    customer_email: (customerEmail || selectedPatient?.email || "").trim() || undefined,
    is_walk_in: walkIn && !selectedPatient,
    items: buildItems(),
    discount_type: discountType,
    discount_value: discountType === "percentage" ? parseFloat(discountValue) || 0 : parseIdr(discountValue),
    tax_total: tax,
    payment_method: paymentMethod === "gift_card" ? "cash" : paymentMethod,
    amount_paid: paid,
    gift_card_code: gcApplied > 0 && giftCardCode.trim() ? giftCardCode.trim() : undefined,
    gift_card_amount_idr: gcApplied > 0 ? gcApplied : undefined,
    wallet_amount_idr: walletApplied > 0 ? walletApplied : undefined,
    overpayment_to_wallet: overpaymentToWallet,
    coupon_code: couponCode.trim() || undefined,
    complete,
  });

  const resetAfterSale = () => {
    setCart([]);
    setDiscountType("none");
    setDiscountValue("");
    setTaxTotal("0");
    setAmountPaid("");
    setGiftCardCode("");
    setGiftCardAmount("");
    setWalletAmount("");
    setOverpaymentToWallet(false);
    setGiftLookup(null);
    if (walkIn) {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
    }
  };

  const completeSale = async () => {
    if (!cart.length) {
      toast.error("Cart is empty");
      return;
    }
    if (!validateCustomer()) return;
    if (giftLookup?.posBlocked) {
      toast.error(
        "Treatment and package gift cards must be redeemed when creating a booking so availability can be checked.",
      );
      return;
    }
    if (gcApplied > 0 || (giftCardCode.trim() && giftLookup?.card)) {
      if (!giftCardCode.trim()) {
        toast.error("Enter gift card code");
        return;
      }
      if (giftRedemption.validationError) {
        toast.error(giftRedemption.validationError);
        return;
      }
      if (!giftRedemption.canSubmit && giftRedemption.showAmountInput) {
        toast.error("Enter amount to redeem");
        return;
      }
      if (gcApplied > total) {
        toast.error("Redemption cannot exceed sale total");
        return;
      }
    }
    if (walletApplied > 0 && !selectedPatient?.id) {
      toast.error("Select a patient to use store credit from wallet");
      return;
    }
    if (!isCashPayment(paymentMethod) && amountPaid !== "" && paid > cashDue) {
      toast.error("Amount cannot exceed balance due for this payment method");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/pos/sales", salePayload(true));
      setLastSale(r.data);
      toast.success(`Sale ${r.data.sale_number} completed`);
      resetAfterSale();
      onSaleCompleted?.(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not complete sale");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!cart.length) {
      toast.error("Cart is empty");
      return;
    }
    if (!validateCustomer()) return;
    setBusy(true);
    try {
      const r = await api.post("/pos/sales", salePayload(false));
      toast.success(`Draft ${r.data.sale_number} saved`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save draft");
    } finally {
      setBusy(false);
    }
  };

  const customerPhoneForReceipt = receiptPhone(lastSale, selectedPatient) || customerPhone;

  return (
    <>
    <div
      className="pos-screen no-print p-3 sm:p-6 md:p-8 max-w-[1400px] mx-auto"
      style={{ "--pos-safe-bottom": "5rem" }}
      data-testid="pos-page"
    >
      {lastSale?.status === "paid" && (
        <div className="mb-4">
          <PosReceiptBar
            sale={lastSale}
            clinicName={clinicName}
            messagingEnabled={messagingEnabled}
            canSendMessaging={canMessaging}
            customerPhone={customerPhoneForReceipt}
            onPrint={printPosReceipt}
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <PosCustomerBar
            user={user}
            walkIn={walkIn}
            onWalkInChange={(v) => {
              setWalkIn(v);
              if (v) {
                setSelectedPatient(null);
                setPatientQuery("");
                setPatientOptions([]);
              }
            }}
            patientQuery={patientQuery}
            onPatientQueryChange={setPatientQuery}
            patientOptions={patientOptions}
            onPatientOptionsChange={setPatientOptions}
            selectedPatient={selectedPatient}
            onSelectPatient={(p) => {
              setSelectedPatient(p);
              setPatientQuery("");
              setWalkIn(false);
              if (p.phone) setCustomerPhone(p.phone);
            }}
            onClearPatient={() => setSelectedPatient(null)}
            customerName={customerName}
            onCustomerNameChange={setCustomerName}
            customerPhone={customerPhone}
            onCustomerPhoneChange={setCustomerPhone}
            customerEmail={customerEmail}
            onCustomerEmailChange={setCustomerEmail}
            searchPatients={searchPatients}
          />

          <PosItemPicker
            activeTab={activeTab}
            onTabChange={setActiveTab}
            draft={draft}
            onDraftChange={setDraft}
            onAddToCart={addToCart}
            packageRequiresPatient={cartHasPackage && !selectedPatient}
          />

          <div className="bl-card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="label-eyebrow">Cart ({cart.length})</div>
            </div>
            <PosCartTable cart={cart} onUpdateLine={updateCartLine} onRemoveLine={(key) => setCart((p) => p.filter((l) => l.key !== key))} />
          </div>
        </div>

        <div className="xl:col-span-4 space-y-4">
          <PosPaymentPanel
            canCreate={canCreate}
            canRedeemGiftCard={canRedeemGiftCard}
            busy={busy}
            cartEmpty={!cart.length}
            subtotal={subtotal}
            discountAmount={discountAmount}
            discountType={discountType}
            onDiscountTypeChange={setDiscountType}
            discountValue={discountValue}
            onDiscountValueChange={setDiscountValue}
            couponCode={couponCode}
            onCouponCodeChange={setCouponCode}
            tax={taxTotal}
            onTaxChange={setTaxTotal}
            total={total}
            amountPaid={amountPaid}
            onAmountPaidChange={setAmountPaid}
            balanceDue={balanceDue}
            cashDue={cashDue}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            onComplete={completeSale}
            onSaveDraft={saveDraft}
            giftCardCode={giftCardCode}
            onGiftCardCodeChange={setGiftCardCode}
            giftCardAmount={giftCardAmount}
            onGiftCardAmountChange={setGiftCardAmount}
            giftLookup={giftLookup}
            onGiftLookup={setGiftLookup}
            giftLineItems={cart}
            giftPatientId={selectedPatient?.id}
            canUseWallet={canUseWallet}
            walletPatientId={selectedPatient?.id}
            walletAmount={walletAmount}
            onWalletAmountChange={setWalletAmount}
            walletApplied={walletApplied}
            overpaymentToWallet={overpaymentToWallet}
            onOverpaymentToWalletChange={setOverpaymentToWallet}
          />
          <PosDayClosingSnippet key={closingRefreshKey} />
        </div>
      </div>
    </div>

    {lastSale?.status === "paid" && (
      <>
        <div className="pos-receipt-print-area" aria-hidden="true" data-testid="pos-receipt-print-area">
          <PosReceiptDocument sale={lastSale} clinicName={clinicName} />
        </div>
        {saleHasGiftCardItems(lastSale) && (
          <div className="pos-gift-card-print-area" aria-hidden="true" data-testid="pos-gift-card-print-area">
            <PosSaleGiftCardsPrint sale={lastSale} clinicName={clinicName} />
          </div>
        )}
      </>
    )}
    </>
  );
}
