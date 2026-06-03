import { useCallback, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import PosNewSaleTab from "@/components/pos/PosNewSaleTab";
import PosTodaySalesTab from "@/components/pos/PosTodaySalesTab";
import PosSalesHistoryTab from "@/components/pos/PosSalesHistoryTab";
import PosSaleDetailModal from "@/components/pos/PosSaleDetailModal";
import PosReceiptDocument from "@/components/pos/PosReceiptDocument";
import PosSaleGiftCardsPrint from "@/components/pos/PosSaleGiftCardsPrint";
import { saleHasGiftCardItems } from "@/lib/posGiftCardSale";
import { printPosReceipt } from "@/lib/posReceipt";

const PAGE_TABS = [
  { id: "new", label: "New Sale", perm: "pos.create" },
  { id: "today", label: "Today Sales", perm: "pos.view" },
  { id: "history", label: "Sales History", perm: "pos.view" },
];

export default function POSPage() {
  const { user } = useAuth();
  const { branding } = useSettings();
  const canCreate = hasPermission(user, "pos.create");
  const canView = hasPermission(user, "pos.view");
  const canCancel = hasPermission(user, "pos.cancel");
  const canRefund = hasPermission(user, "refunds.create");
  const visibleTabs = PAGE_TABS.filter((t) => hasPermission(user, t.perm));
  const defaultTab = visibleTabs.find((t) => t.id === "new")?.id
    || visibleTabs.find((t) => t.id === "today")?.id
    || visibleTabs[0]?.id
    || "new";

  const [pageTab, setPageTab] = useState(defaultTab);
  const [detailSaleId, setDetailSaleId] = useState(null);
  const [printSale, setPrintSale] = useState(null);
  const [closingRefreshKey, setClosingRefreshKey] = useState(0);
  const [refreshTodayKey, setRefreshTodayKey] = useState(0);

  const clinicName = branding?.clinic_name || "Clinic";

  const handleSaleCompleted = useCallback(() => {
    setClosingRefreshKey((k) => k + 1);
    setRefreshTodayKey((k) => k + 1);
  }, []);

  const handlePrintSale = useCallback(async (saleId) => {
    try {
      const r = await api.get(`/pos/sales/${saleId}`);
      setPrintSale(r.data);
      requestAnimationFrame(() => printPosReceipt());
    } catch {
      window.alert("Could not load sale for printing");
    }
  }, []);

  const handlePrintFromDetail = useCallback((sale) => {
    setPrintSale(sale);
    requestAnimationFrame(() => printPosReceipt());
  }, []);

  return (
    <>
      <div
        className="pos-screen no-print p-3 sm:p-6 md:p-8 max-w-[1400px] mx-auto"
        style={{ "--pos-safe-bottom": "5rem" }}
        data-testid="pos-page"
      >
        <div className="mb-4 sm:mb-6">
          <div className="label-eyebrow">Cashier</div>
          <h1 className="font-display text-2xl sm:text-3xl text-[#2D3A33] mt-1">POS</h1>
        </div>

        <div className="flex flex-wrap gap-1 mb-6 border-b border-[#EAE6D7] pb-0">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPageTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                pageTab === tab.id
                  ? "border-[var(--bl-primary)] text-[var(--bl-primary)]"
                  : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"
              }`}
              data-testid={`pos-page-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {pageTab === "new" && canCreate && (
          <PosNewSaleTab onSaleCompleted={handleSaleCompleted} closingRefreshKey={closingRefreshKey} />
        )}
        {pageTab === "today" && canView && (
          <PosTodaySalesTab
            key={refreshTodayKey}
            onViewSale={setDetailSaleId}
            onPrintSale={handlePrintSale}
          />
        )}
        {pageTab === "history" && canView && (
          <PosSalesHistoryTab onViewSale={setDetailSaleId} onPrintSale={handlePrintSale} />
        )}
      </div>

      {detailSaleId && (
        <PosSaleDetailModal
          saleId={detailSaleId}
          clinicName={clinicName}
          onClose={() => setDetailSaleId(null)}
          onPrint={handlePrintFromDetail}
          canCancel={canCancel}
          canRefund={canRefund}
          onCancelled={() => {
            setDetailSaleId(null);
            setRefreshTodayKey((k) => k + 1);
            setClosingRefreshKey((k) => k + 1);
          }}
        />
      )}

      {printSale?.status === "paid" && (
        <>
          <div className="pos-receipt-print-area" aria-hidden="true">
            <PosReceiptDocument sale={printSale} clinicName={clinicName} />
          </div>
          {saleHasGiftCardItems(printSale) && (
            <div className="pos-gift-card-print-area" aria-hidden="true">
              <PosSaleGiftCardsPrint sale={printSale} clinicName={clinicName} />
            </div>
          )}
        </>
      )}
    </>
  );
}
