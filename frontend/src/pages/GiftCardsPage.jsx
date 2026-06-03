import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { fmtIDR } from "@/lib/posUtils";
import { formatGiftCardRemaining } from "@/lib/giftCardDisplay";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Copy, Download, Eye, History,
  MoreHorizontal, Printer, X,
} from "lucide-react";
import SearchInput from "@/components/ui/SearchInput";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/lib/settings";
import GiftCardDetailPanel from "@/components/giftcards/GiftCardDetailPanel";
import GiftCardPrintDocument from "@/components/giftcards/GiftCardPrintDocument";
import { printGiftCard } from "@/lib/giftCardPrint";
import {
  EMPTY_GIFT_CARD_FILTERS,
  GIFT_CARD_TABS,
  GIFT_CARD_TYPE_LABELS,
  giftCardListParams,
  STATUS_LABELS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
} from "@/lib/giftCards";

const PAGE_SIZE = 25;

function SummaryCard({ label, value }) {
  return (
    <div className="bl-card p-4">
      <div className="text-xs text-[#5C6C62]">{label}</div>
      <div className="font-display text-xl mt-1">{value}</div>
    </div>
  );
}

function RecipientCell({ row }) {
  if (!row.recipient_name && !row.recipient_phone) return "—";
  return (
    <div>
      <div>{row.recipient_name || "—"}</div>
      {row.recipient_phone && <div className="text-xs text-[#5C6C62]">{row.recipient_phone}</div>}
    </div>
  );
}

export default function GiftCardsPage() {
  const { user } = useAuth();
  const { branding } = useSettings();
  const clinicName = branding?.clinic_name || "Clinic";
  const canCancel = hasPermission(user, "gift_cards.cancel");
  const canRedeem = hasPermission(user, "gift_cards.redeem");
  const role = (user?.role || "").toLowerCase();
  const canReleaseReservation =
    canRedeem && ["owner", "manager", "fo", "front_office"].includes(role);

  const [filters, setFilters] = useState({ ...EMPTY_GIFT_CARD_FILTERS });
  const [applied, setApplied] = useState({ ...EMPTY_GIFT_CARD_FILTERS });
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, summary: null });
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printCard, setPrintCard] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = giftCardListParams(applied, { page, pageSize: PAGE_SIZE });
      const r = await api.get("/gift-cards", { params });
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load gift cards");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id) => {
    setDetailId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await api.get(`/gift-cards/${id}`);
      setDetail(r.data);
    } catch {
      toast.error("Could not load gift card");
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
  };

  const applyFilters = () => {
    setApplied({ ...filters });
    setPage(1);
  };

  const resetFilters = () => {
    const next = { ...EMPTY_GIFT_CARD_FILTERS, tab: filters.tab };
    setFilters(next);
    setApplied(next);
    setPage(1);
  };

  const setTab = (tab) => {
    const next = { ...filters, tab, status: "" };
    setFilters(next);
    setApplied({ ...applied, tab, status: "" });
    setPage(1);
  };

  const copyCode = (code, e) => {
    e?.stopPropagation();
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => toast.success("Code copied"),
      () => toast.error("Could not copy"),
    );
  };

  const handlePrint = async (row, e) => {
    e?.stopPropagation();
    try {
      const r = await api.get(`/gift-cards/${row.id}`);
      setPrintCard(r.data);
      setTimeout(() => printGiftCard(), 100);
    } catch {
      toast.error("Could not load gift card for printing");
    }
  };

  const handlePrintDetail = () => {
    if (detail) {
      setPrintCard(detail);
      setTimeout(() => printGiftCard(), 100);
    }
  };

  const scrollToRedemptions = () => {
    document.getElementById("gift-card-redemptions")?.scrollIntoView({ behavior: "smooth" });
  };

  const promptCancelReason = () => {
    const reason = window.prompt("Cancellation reason (required, min. 3 characters):");
    if (reason === null) return null;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error("Please enter a cancellation reason (at least 3 characters)");
      return null;
    }
    return trimmed;
  };

  const cancelCard = async (id) => {
    const reason = promptCancelReason();
    if (!reason) return;
    if (!window.confirm("Cancel this gift card? Remaining balance will be voided.")) return;
    try {
      await api.post(`/gift-cards/${id}/cancel`, { reason });
      toast.success("Gift card cancelled");
      closeDetail();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel");
    }
  };

  const releaseReservation = async (id) => {
    if (!window.confirm("Release this gift card reservation? It will become active again for a new booking.")) {
      return;
    }
    try {
      const r = await api.post(`/gift-cards/${id}/release-reservation`);
      setDetail(r.data);
      toast.success("Reservation released");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not release reservation");
    }
  };

  const exportCsv = async () => {
    try {
      const params = giftCardListParams(applied, { page: 1, pageSize: PAGE_SIZE });
      delete params.page;
      delete params.page_size;
      const r = await api.get("/gift-cards/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gift-cards.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  const summary = data.summary || {};
  const totalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));

  return (
    <div className="p-3 sm:p-6 md:p-8 max-w-[1280px] mx-auto" data-testid="gift-cards-page">
      <div className="mb-6 flex flex-wrap justify-between gap-3 items-start">
        <div>
          <div className="label-eyebrow">Retail</div>
          <h1 className="font-display text-2xl sm:text-3xl text-[#2D3A33] mt-1">Gift cards</h1>
          <p className="text-sm text-[#5C6C62] mt-1">
            Issued from paid POS sales · redeem as payment on POS or invoices
          </p>
        </div>
        <button type="button" className="bl-btn-ghost text-sm inline-flex items-center gap-2" onClick={exportCsv}>
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-6">
        <SummaryCard label="Outstanding balance" value={fmtIDR(summary.outstanding_balance_idr)} />
        <SummaryCard label="Active cards" value={String(summary.active_cards_count || 0)} />
        <SummaryCard label="Value cards issued" value={String(summary.issued_value_cards_count || 0)} />
        <SummaryCard label="Total redeemed" value={fmtIDR(summary.total_redeemed_idr)} />
      </div>

      <div className="flex flex-wrap gap-1 mb-4 border-b border-[#EAE6D7]">
        {GIFT_CARD_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              applied.tab === t.id
                ? "border-[var(--bl-primary)] text-[var(--bl-primary)]"
                : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"
            }`}
            data-testid={`gift-cards-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bl-card p-4 mb-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <SearchInput
            className="flex-1 min-w-[200px]"
            placeholder="Search by code…"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            data-testid="gift-cards-search"
          />
          <button type="button" className="bl-btn-ghost text-sm" onClick={() => setShowFilters((v) => !v)}>
            {showFilters ? "Hide filters" : "More filters"}
          </button>
          <button type="button" className="bl-btn-primary text-sm" onClick={applyFilters}>
            Apply
          </button>
          <button type="button" className="bl-btn-ghost text-sm" onClick={resetFilters}>
            Reset
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-[#EAE6D7]">
            <label className="block text-xs text-[#5C6C62]">
              Recipient name
              <input
                className="bl-input w-full mt-1"
                value={filters.recipient_name}
                onChange={(e) => setFilters((f) => ({ ...f, recipient_name: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Recipient phone
              <input
                className="bl-input w-full mt-1"
                value={filters.recipient_phone}
                onChange={(e) => setFilters((f) => ({ ...f, recipient_phone: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Purchaser name
              <input
                className="bl-input w-full mt-1"
                value={filters.purchaser_name}
                onChange={(e) => setFilters((f) => ({ ...f, purchaser_name: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Purchaser phone
              <input
                className="bl-input w-full mt-1"
                value={filters.purchaser_phone}
                onChange={(e) => setFilters((f) => ({ ...f, purchaser_phone: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Status
              <select
                className="bl-input w-full mt-1"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Gift card type
              <select
                className="bl-input w-full mt-1"
                value={filters.gift_card_type}
                onChange={(e) => setFilters((f) => ({ ...f, gift_card_type: e.target.value }))}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Issued from
              <input
                type="date"
                className="bl-input w-full mt-1"
                value={filters.issued_from}
                onChange={(e) => setFilters((f) => ({ ...f, issued_from: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Issued to
              <input
                type="date"
                className="bl-input w-full mt-1"
                value={filters.issued_to}
                onChange={(e) => setFilters((f) => ({ ...f, issued_to: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Expiry from
              <input
                type="date"
                className="bl-input w-full mt-1"
                value={filters.expiry_from}
                onChange={(e) => setFilters((f) => ({ ...f, expiry_from: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-[#5C6C62]">
              Expiry to
              <input
                type="date"
                className="bl-input w-full mt-1"
                value={filters.expiry_to}
                onChange={(e) => setFilters((f) => ({ ...f, expiry_to: e.target.value }))}
              />
            </label>
          </div>
        )}
      </div>

      <div className="bl-card overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="text-left text-xs text-[#5C6C62] border-b uppercase tracking-wide">
              <th className="p-3">Code</th>
              <th className="p-3">Type</th>
              <th className="p-3">Recipient</th>
              <th className="p-3 text-right">Original value</th>
              <th className="p-3 text-right">Remaining</th>
              <th className="p-3">Status</th>
              <th className="p-3">Expiry</th>
              <th className="p-3">Issued</th>
              <th className="p-3 w-12" />
            </tr>
          </thead>
          <tbody>
            {(data.items || []).map((row) => (
              <tr key={row.id} className="border-b border-[#EAE6D7] hover:bg-[#F8F5EC]">
                <td className="p-3 font-mono font-medium">
                  <button
                    type="button"
                    className="hover:underline text-left"
                    onClick={() => openDetail(row.id)}
                  >
                    {row.code}
                  </button>
                </td>
                <td className="p-3">{GIFT_CARD_TYPE_LABELS[row.gift_card_type] || row.gift_card_type}</td>
                <td className="p-3"><RecipientCell row={row} /></td>
                <td className="p-3 text-right font-mono">{fmtIDR(row.original_value ?? row.initial_value_idr)}</td>
                <td className="p-3 text-right font-mono" data-testid="gift-card-remaining">
                  {formatGiftCardRemaining(row)}
                </td>
                <td className="p-3">{STATUS_LABELS[row.status] || row.status}</td>
                <td className="p-3 text-[#5C6C62]">{(row.expiry_date || row.expires_at || "—").slice(0, 10)}</td>
                <td className="p-3 text-[#5C6C62]">{(row.issued_at || "").slice(0, 10)}</td>
                <td className="p-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="p-2 rounded-lg hover:bg-[#F3F1EB]"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Actions"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[200px]">
                      <DropdownMenuItem className="cursor-pointer" onSelect={() => openDetail(row.id)}>
                        <Eye className="w-4 h-4 mr-2" /> View detail
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer" onSelect={() => handlePrint(row)}>
                        <Printer className="w-4 h-4 mr-2" /> Print gift card
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer" onSelect={() => copyCode(row.code)}>
                        <Copy className="w-4 h-4 mr-2" /> Copy code
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onSelect={() => {
                          openDetail(row.id);
                          setTimeout(scrollToRedemptions, 400);
                        }}
                      >
                        <History className="w-4 h-4 mr-2" /> View redemption history
                      </DropdownMenuItem>
                      {canCancel && ["active", "partially_redeemed"].includes(row.status) && (
                        <DropdownMenuItem
                          className="cursor-pointer text-[#B14A2C]"
                          onSelect={() => cancelCard(row.id)}
                        >
                          <X className="w-4 h-4 mr-2" /> Cancel gift card
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-6 text-sm text-[#5C6C62]">Loading…</p>}
        {!loading && !(data.items || []).length && (
          <p className="p-6 text-sm text-[#5C6C62] text-center">No gift cards found.</p>
        )}
      </div>

      {!loading && (data.total || 0) > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-[#5C6C62]">
            Page {page} of {totalPages} · {data.total} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="bl-btn-ghost p-2"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="bl-btn-ghost p-2"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {detailId && (
        <GiftCardDetailPanel
          detail={detail}
          loading={detailLoading}
          clinicName={clinicName}
          canManage={canCancel}
          canReleaseReservation={canReleaseReservation && detail?.status === "reserved"}
          onClose={closeDetail}
          onCancel={cancelCard}
          onReleaseReservation={releaseReservation}
          onShowRedemptions={scrollToRedemptions}
          onPrint={handlePrintDetail}
        />
      )}

      <div className="gift-card-print-area" aria-hidden="true" data-testid="gift-card-print-area">
        <GiftCardPrintDocument card={printCard} clinicName={clinicName} />
      </div>
    </div>
  );
}
