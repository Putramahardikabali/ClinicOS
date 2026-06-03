import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { formatIdr } from "@/lib/clinic";
import { useAuth, hasPermission } from "@/lib/auth";
import { useClinic, hasFeature } from "@/lib/clinic";
import { LockedNotice } from "@/components/FeatureGate";
import {
  DATE_PRESETS,
  REPORT_SECTIONS,
  buildDateParams,
  downloadReportExport,
  fetchReport,
  visibleReportSections,
} from "@/lib/reports";
import OverviewCharts from "@/components/reports/OverviewCharts";

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bl-card p-4 sm:p-5">
      <div className="label-eyebrow">{label}</div>
      <div className="font-display text-xl sm:text-2xl text-[#2D3A33] mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[#5C6C62] mt-0.5">{sub}</div>}
    </div>
  );
}

function DataTable({ columns, rows, empty = "No data for this range." }) {
  if (!rows?.length) return <p className="text-sm text-[#5C6C62] py-6 text-center">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2.5 ${c.right ? "text-right" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} className="border-t border-[#EAE6D7]">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-2.5 text-[#2D3A33] ${c.right ? "text-right tabular-nums" : ""}`}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueList({ items, valueKey = "count", labelKey = "label", money = false }) {
  if (!items?.length) return <p className="text-sm text-[#5C6C62]">No data.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item, i) => (
        <li key={item[labelKey] ?? i} className="flex justify-between gap-3">
          <span className="text-[#5C6C62] capitalize truncate">{String(item[labelKey] ?? "—").replace(/_/g, " ")}</span>
          <span className="text-[#2D3A33] tabular-nums shrink-0">
            {money ? formatIdr(item[valueKey]) : item[valueKey]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SectionBody({ section, data }) {
  if (!data) return null;
  const s = data.summary || {};

  if (section === "overview") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryCard label="Paid revenue" value={formatIdr(s.paid_revenue_idr)} sub={`${s.paid_invoices ?? 0} invoices`} />
          <SummaryCard label="Outstanding" value={formatIdr(s.outstanding_balance_idr)} />
          <SummaryCard label="Completed visits" value={String(s.completed_visits ?? 0)} />
          <SummaryCard label="New patients" value={String(s.new_patients ?? 0)} />
          <SummaryCard label="Active packages" value={String(s.active_packages ?? 0)} />
          <SummaryCard label="Package sessions used" value={String(s.package_sessions_used ?? 0)} />
          <SummaryCard label="Commission approved" value={formatIdr(s.commission_approved_idr)} />
          <SummaryCard label="Pending clinical notes" value={String(s.pending_clinical_notes ?? 0)} />
          <SummaryCard label="Pending consent" value={String(s.pending_consent ?? 0)} />
        </div>
        <p className="mt-4 text-xs text-[#5C6C62]">
          Revenue counts paid invoices only. Package usage is not included as new cash revenue.
        </p>
        <OverviewCharts charts={data.charts} />
      </>
    );
  }

  if (section === "revenue") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Total paid revenue" value={formatIdr(data.total_paid_revenue_idr)} sub="Paid invoices only" />
          <SummaryCard label="Unpaid amount" value={formatIdr(data.unpaid_amount_idr)} />
          <SummaryCard label="Partial paid" value={formatIdr(data.partial_paid_idr)} sub={`Outstanding ${formatIdr(data.partial_outstanding_idr)}`} />
          <SummaryCard label="Avg invoice" value={formatIdr(data.average_invoice_value_idr)} sub={`${data.invoice_count} invoices`} />
          <SummaryCard label="Cancelled" value={formatIdr(data.cancelled_amount_idr)} />
          <SummaryCard label="Refunded" value={formatIdr(data.refunded_amount_idr)} />
          <SummaryCard label="Package sales" value={formatIdr(data.package_purchase_revenue_idr)} />
          <SummaryCard label="Package usage value" value={formatIdr(data.package_usage_service_value_idr)} sub="Not cash revenue" />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Revenue by date</h3>
            <DataTable columns={[{ key: "date", label: "Date" }, { key: "revenue_idr", label: "Revenue", right: true, render: (r) => formatIdr(r.revenue_idr) }]} rows={data.by_date} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By payment method</h3>
            <KeyValueList items={(data.by_payment_method || []).map((r) => ({ label: r.method, count: r.revenue_idr }))} money />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By treatment</h3>
            <KeyValueList items={(data.by_treatment || []).map((r) => ({ label: r.name, count: r.revenue_idr }))} money />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By item type</h3>
            <KeyValueList items={(data.by_item_type || []).map((r) => ({ label: r.item_type, count: r.revenue_idr }))} money />
          </div>
        </div>
        <div className="mt-4 bl-card p-4">
          <h3 className="font-display text-base mb-1">Performer associated revenue</h3>
          <p className="text-xs text-[#5C6C62] mb-3">Per-line attribution — not added to clinic total (no double counting).</p>
          <DataTable
            columns={[
              { key: "performer", label: "Performer" },
              { key: "associated_revenue_idr", label: "Associated revenue", right: true, render: (r) => formatIdr(r.associated_revenue_idr) },
            ]}
            rows={data.performer_associated_revenue}
          />
        </div>
      </>
    );
  }

  if (section === "billing") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Paid" value={String(s.paid_count ?? 0)} />
          <SummaryCard label="Unpaid" value={String(s.unpaid_count ?? 0)} />
          <SummaryCard label="Partial" value={String(s.partial_count ?? 0)} />
          <SummaryCard label="Outstanding" value={formatIdr(s.outstanding_balance_idr)} />
          <SummaryCard label="Cancelled" value={String(s.cancelled_count ?? 0)} />
          <SummaryCard label="Discounts" value={formatIdr(s.discount_total_idr)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Payment methods</h3>
            <KeyValueList items={(data.by_payment_method || []).map((r) => ({ label: r.method, count: r.amount_idr }))} money />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Discount reasons</h3>
            <KeyValueList items={(data.discount_by_reason || []).map((r) => ({ label: r.reason, count: r.amount_idr }))} money />
          </div>
        </div>
        <div className="mt-4 bl-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Invoices</div>
          <DataTable
            columns={[
              { key: "invoice_number", label: "Invoice #" },
              { key: "patient_name", label: "Patient" },
              { key: "date", label: "Date" },
              { key: "total_idr", label: "Total", right: true, render: (r) => formatIdr(r.total_idr) },
              { key: "paid_idr", label: "Paid", right: true, render: (r) => formatIdr(r.paid_idr) },
              { key: "remaining_idr", label: "Remaining", right: true, render: (r) => formatIdr(r.remaining_idr) },
              { key: "status", label: "Status", render: (r) => <span className="capitalize">{r.status}</span> },
            ]}
            rows={data.invoices}
          />
        </div>
      </>
    );
  }

  if (section === "packages") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Package sales" value={formatIdr(s.package_sales_revenue_idr)} sub={`${s.package_sales_count ?? 0} sold`} />
          <SummaryCard label="Active" value={String(s.active_count ?? 0)} />
          <SummaryCard label="Partially used" value={String(s.partially_used_count ?? 0)} />
          <SummaryCard label="Used up" value={String(s.used_up_count ?? 0)} />
          <SummaryCard label="Expired" value={String(s.expired_count ?? 0)} />
          <SummaryCard label="Expiring soon" value={String(s.expiring_soon_count ?? 0)} />
          <SummaryCard label="Remaining sessions" value={String(s.remaining_sessions_total ?? 0)} />
          <SummaryCard label="Sessions used (range)" value={String(s.sessions_used_in_range ?? 0)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Usage by treatment</h3>
            <KeyValueList items={(data.usage_by_treatment || []).map((r) => ({ label: r.treatment, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Bundle component usage</h3>
            <KeyValueList items={(data.component_usage || []).map((r) => ({ label: r.component, count: r.count }))} />
          </div>
        </div>
        <div className="mt-4 bl-card p-4">
          <h3 className="font-display text-base mb-3">Expiring soon</h3>
          <DataTable
            columns={[
              { key: "name", label: "Package" },
              { key: "expiry_date", label: "Expiry" },
              { key: "remaining", label: "Remaining", right: true },
            ]}
            rows={data.expiring_soon}
          />
        </div>
      </>
    );
  }

  if (section === "wallet") {
    const s = data || {};
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Outstanding liability" value={formatIdr(s.outstanding_liability_idr)} sub={`${s.wallet_count ?? 0} wallets`} />
          <SummaryCard label="Credits issued" value={formatIdr(s.credits_issued_idr)} sub="Not new cash revenue" />
          <SummaryCard label="Credits used" value={formatIdr(s.credits_used_idr)} sub="Store credit payments" />
          <SummaryCard label="Adjustments" value={formatIdr(s.adjustments_idr)} />
        </div>
        <div className="mt-4 bl-card p-4">
          <h3 className="font-display text-base mb-3">Patient balances</h3>
          <DataTable
            columns={[
              { key: "patient_name", label: "Patient" },
              { key: "patient_phone", label: "Phone" },
              { key: "balance_idr", label: "Balance", right: true, render: (r) => formatIdr(r.balance_idr) },
            ]}
            rows={s.patient_balances || []}
            empty="No outstanding wallet balances."
          />
        </div>
        <div className="mt-4 bl-card p-4">
          <h3 className="font-display text-base mb-3">Recent transactions</h3>
          <DataTable
            columns={[
              { key: "created_at", label: "Date", render: (r) => (r.created_at || "").slice(0, 16).replace("T", " ") },
              { key: "transaction_type", label: "Type" },
              { key: "amount_idr", label: "Amount", right: true, render: (r) => formatIdr(r.amount_idr) },
              { key: "balance_after", label: "Balance after", right: true, render: (r) => formatIdr(r.balance_after) },
              { key: "reference_type", label: "Reference" },
            ]}
            rows={s.transactions || []}
            empty="No wallet activity in this range."
          />
        </div>
      </>
    );
  }

  if (section === "gift-cards") {
    const statusLabel = {
      active: "Active",
      partially_redeemed: "Partially redeemed",
      redeemed: "Redeemed",
      expired: "Expired",
      cancelled: "Cancelled",
      draft: "Draft",
    };
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Issued (range)" value={String(s.issued_in_range_count ?? 0)} sub={`${formatIdr(s.issued_in_range_value_idr)} · money collected when selling`} />
          <SummaryCard label="Redemptions (range)" value={formatIdr(s.redemptions_in_range_idr)} sub={`${s.redemptions_in_range_count ?? 0} uses · not new revenue`} />
          <SummaryCard label="Outstanding balance" value={formatIdr(s.outstanding_balance_idr)} sub={`${s.active_cards_count ?? 0} active cards`} />
          <SummaryCard label="Total issued cards" value={String(s.total_issued_cards ?? 0)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By status</h3>
            <KeyValueList
              items={(data.by_status || []).map((r) => ({
                label: statusLabel[r.status] || r.status,
                count: r.count,
              }))}
            />
          </div>
        </div>
        <div className="mt-4 bl-card p-4">
          <h3 className="font-display text-base mb-3">Redemption history</h3>
          <DataTable
            columns={[
              { key: "created_at", label: "Date", render: (r) => (r.created_at || "").slice(0, 16).replace("T", " ") },
              { key: "gift_card_code", label: "Code" },
              { key: "amount_redeemed", label: "Amount", right: true, render: (r) => formatIdr(r.amount_redeemed) },
              { key: "reference_type", label: "Reference" },
              { key: "redeemed_by_name_snapshot", label: "By" },
            ]}
            rows={data.redemptions}
            empty="No redemptions in this range."
          />
        </div>
      </>
    );
  }

  if (section === "treatments") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <SummaryCard label="Treatments performed" value={String(s.total_treatments_performed ?? 0)} />
          <SummaryCard label="Package value delivered" value={formatIdr(s.package_delivered_value_idr)} sub="Not new cash revenue" />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By category</h3>
            <KeyValueList items={(data.by_category || []).map((r) => ({ label: r.category, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By performer</h3>
            <KeyValueList items={(data.by_performer || []).map((r) => ({ label: r.performer, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By role</h3>
            <KeyValueList items={(data.by_role || []).map((r) => ({ label: r.role, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By payment type</h3>
            <KeyValueList items={(data.by_payment || []).map((r) => ({ label: r.payment, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Top by count</h3>
            <KeyValueList items={(data.top_by_count || []).map((r) => ({ label: r.name, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Top by revenue</h3>
            <KeyValueList items={(data.top_by_revenue || []).map((r) => ({ label: r.name, count: r.revenue_idr }))} money />
          </div>
        </div>
      </>
    );
  }

  if (section === "staff") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <SummaryCard label="Assistant performer count" value={String(s.assistant_performer_count ?? 0)} />
          <SummaryCard label="Nurse-assisted treatments" value={String(s.nurse_assisted_count ?? 0)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Appointments by staff</h3>
            <KeyValueList items={(data.appointments_by_staff || []).map((r) => ({ label: r.staff, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Visits by staff</h3>
            <KeyValueList items={(data.visits_by_staff || []).map((r) => ({ label: r.staff, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Treatments by staff</h3>
            <KeyValueList items={(data.treatments_by_staff || []).map((r) => ({ label: r.staff, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Commission by staff</h3>
            <KeyValueList items={(data.commission_by_staff || []).map((r) => ({ label: r.staff, count: r.commission_idr }))} money />
          </div>
        </div>
        <div className="mt-4 bl-card p-4">
          <h3 className="font-display text-base mb-1">Associated revenue by staff</h3>
          <p className="text-xs text-[#5C6C62] mb-3">Per-line attribution from invoice item performers — clinic total is deduplicated.</p>
          <DataTable
            columns={[
              { key: "staff", label: "Staff" },
              { key: "associated_revenue_idr", label: "Associated revenue", right: true, render: (r) => formatIdr(r.associated_revenue_idr) },
            ]}
            rows={data.associated_revenue_by_staff}
          />
        </div>
      </>
    );
  }

  if (section === "commission") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Earned (pending)" value={formatIdr(s.pending)} />
          <SummaryCard label="Approved" value={formatIdr(s.approved)} />
          <SummaryCard label="Paid out" value={formatIdr(s.paid_out)} />
          <SummaryCard label="Approved unpaid" value={formatIdr(s.approved_unpaid_idr)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By role</h3>
            <KeyValueList items={(data.by_role || []).map((r) => ({ label: r.role, count: r.commission_idr }))} money />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By treatment</h3>
            <KeyValueList items={(data.by_treatment || []).map((r) => ({ label: r.treatment, count: r.commission_idr }))} money />
          </div>
        </div>
        <div className="mt-4 bl-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Commission records ({s.record_count ?? 0})</div>
          <DataTable
            columns={[
              { key: "staff_name_snapshot", label: "Staff" },
              { key: "item_name_snapshot", label: "Item" },
              { key: "commission_amount", label: "Amount", right: true, render: (r) => formatIdr(r.commission_amount) },
              { key: "status", label: "Status", render: (r) => <span className="capitalize">{r.status?.replace(/_/g, " ")}</span> },
              { key: "created_at", label: "Date", render: (r) => (r.created_at || "").slice(0, 10) },
            ]}
            rows={data.records}
          />
        </div>
      </>
    );
  }

  if (section === "appointments") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Total appointments" value={String(s.total_appointments ?? 0)} />
          <SummaryCard label="Completed" value={String(s.completed ?? 0)} />
          <SummaryCard label="Cancelled" value={String(s.cancelled ?? 0)} />
          <SummaryCard label="No-show" value={String(s.no_show ?? 0)} />
          <SummaryCard label="Rescheduled" value={String(s.rescheduled ?? 0)} />
          <SummaryCard label="Visits completed" value={String(s.visits_completed ?? 0)} />
          <SummaryCard label="Visits in progress" value={String(s.visits_in_progress ?? 0)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By status</h3>
            <KeyValueList items={(data.by_status || []).map((r) => ({ label: r.status, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By treatment</h3>
            <KeyValueList items={(data.by_treatment || []).map((r) => ({ label: r.treatment, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By performer</h3>
            <KeyValueList items={(data.by_performer || []).map((r) => ({ label: r.performer, count: r.count }))} />
          </div>
        </div>
      </>
    );
  }

  if (section === "patients") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="New patients" value={String(s.new_patients ?? 0)} />
          <SummaryCard label="Returning visits" value={String(s.returning_visit_count ?? 0)} />
          <SummaryCard label="Total active patients" value={String(s.total_active_patients ?? 0)} />
          <SummaryCard label="Active packages" value={String(s.patients_with_active_packages ?? 0)} />
          <SummaryCard label="Expired packages" value={String(s.patients_with_expired_packages ?? 0)} />
          <SummaryCard label="Follow-up notes" value={String(s.follow_up_notes_count ?? 0)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">New patients</h3>
            <DataTable
              columns={[
                { key: "name", label: "Name" },
                { key: "source", label: "Source", render: (r) => r.source || "—" },
                { key: "date", label: "Date" },
              ]}
              rows={data.new_patients}
            />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Top spending (range)</h3>
            <DataTable
              columns={[
                { key: "patient_name", label: "Patient" },
                { key: "spent_idr", label: "Spent", right: true, render: (r) => formatIdr(r.spent_idr) },
              ]}
              rows={data.top_spending}
            />
          </div>
        </div>
      </>
    );
  }

  if (section === "consent") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Consent signed" value={String(s.consent_signed ?? 0)} />
          <SummaryCard label="Pending consent" value={String(s.consent_pending ?? 0)} />
          <SummaryCard label="Expired consent" value={String(s.consent_expired ?? 0)} />
          <SummaryCard label="Notes completed" value={String(s.clinical_notes_completed ?? 0)} />
          <SummaryCard label="Locked notes" value={String(s.locked_notes ?? 0)} />
          <SummaryCard label="Edited after lock" value={String(s.notes_edited_after_lock ?? 0)} />
          <SummaryCard label="Visits missing notes" value={String(s.visits_missing_notes ?? 0)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Consent by status</h3>
            <KeyValueList items={(data.consent_by_status || []).map((r) => ({ label: r.status, count: r.count }))} />
          </div>
          <div className="bl-card p-4 overflow-hidden">
            <h3 className="font-display text-base mb-3">Recent consent forms</h3>
            <DataTable
              columns={[
                { key: "patient_name", label: "Patient", render: (r) => r.patient_name || r.patient_id || "—" },
                { key: "template_name_snapshot", label: "Template", render: (r) => r.template_name_snapshot || "—" },
                { key: "status", label: "Status", render: (r) => <span className="capitalize">{r.status}</span> },
                { key: "created_at", label: "Date", render: (r) => (r.created_at || "").slice(0, 10) },
              ]}
              rows={data.consent_forms}
            />
          </div>
        </div>
      </>
    );
  }

  if (section === "inventory") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Usage records" value={String(data.total_usage_records ?? 0)} />
          <SummaryCard label="Low stock products" value={String((data.low_stock_products || []).length)} />
          <SummaryCard label="Out of stock" value={String((data.out_of_stock_products || []).length)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Usage by date</h3>
            <DataTable
              columns={[
                { key: "date", label: "Date" },
                { key: "quantity", label: "Qty used", right: true },
              ]}
              rows={data.usage_by_date}
              empty="No product usage in this range."
            />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Usage by treatment</h3>
            <DataTable
              columns={[
                { key: "treatment", label: "Treatment" },
                { key: "quantity", label: "Qty used", right: true },
              ]}
              rows={data.usage_by_treatment}
              empty="No usage by treatment."
            />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Usage by staff / performer</h3>
            <DataTable
              columns={[
                { key: "staff", label: "Staff" },
                { key: "quantity", label: "Qty used", right: true },
              ]}
              rows={data.usage_by_staff}
              empty="No usage by staff."
            />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">Low stock products</h3>
            <DataTable
              columns={[
                { key: "name", label: "Product" },
                { key: "current_stock", label: "Stock", right: true, render: (r) => `${r.current_stock} ${r.unit || ""}`.trim() },
                { key: "minimum_stock", label: "Min", right: true },
              ]}
              rows={data.low_stock_products}
              empty="No low stock products."
            />
          </div>
        </div>
        <div className="mt-4 bl-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Out of stock products</div>
          <DataTable
            columns={[
              { key: "name", label: "Product" },
              { key: "unit", label: "Unit" },
            ]}
            rows={data.out_of_stock_products}
            empty="No out-of-stock products."
          />
        </div>
      </>
    );
  }

  if (section === "audit") {
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <SummaryCard label="Total events" value={String(s.total_events ?? 0)} />
        </div>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By module</h3>
            <KeyValueList items={(data.by_module || []).map((r) => ({ label: r.module, count: r.count }))} />
          </div>
          <div className="bl-card p-4">
            <h3 className="font-display text-base mb-3">By user</h3>
            <KeyValueList items={(data.by_user || []).map((r) => ({ label: r.user, count: r.count }))} />
          </div>
        </div>
        <div className="mt-4 bl-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Audit log</div>
          <DataTable
            columns={[
              { key: "created_at", label: "Time", render: (r) => (r.created_at || "").replace("T", " ").slice(0, 19) },
              { key: "user_email", label: "User" },
              { key: "action", label: "Action" },
              { key: "module", label: "Module" },
              { key: "record_id", label: "Record" },
            ]}
            rows={data.logs}
          />
        </div>
      </>
    );
  }

  if (section === "online-booking-payments") {
    const summary = data.summary || {};
    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryCard label="Pending" value={String(summary.pending ?? 0)} />
          <SummaryCard label="Successful" value={String(summary.success ?? 0)} />
          <SummaryCard label="Failed" value={String(summary.failed ?? 0)} />
          <SummaryCard label="Expired" value={String(summary.expired ?? 0)} />
          <SummaryCard label="Total records" value={String(data.count ?? 0)} />
        </div>
        <div className="mt-6 bl-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Online booking payments</div>
          <DataTable
            columns={[
              { key: "created_at", label: "Created", render: (r) => (r.created_at || "").replace("T", " ").slice(0, 16) },
              { key: "status", label: "Status", render: (r) => String(r.status || "—").replace(/_/g, " ") },
              { key: "provider", label: "Provider" },
              { key: "payment_requirement", label: "Type", render: (r) => String(r.payment_requirement || "—").replace(/_/g, " ") },
              { key: "amount_due", label: "Amount due", right: true, render: (r) => formatIdr(r.amount_due) },
              { key: "amount_paid", label: "Paid", right: true, render: (r) => formatIdr(r.amount_paid) },
              { key: "booking_id", label: "Booking" },
            ]}
            rows={data.items}
            empty="No online booking payments yet."
          />
        </div>
      </>
    );
  }

  return null;
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { clinic, loading: clinicLoading } = useClinic();
  const tabs = useMemo(() => visibleReportSections(user), [user]);
  const [active, setActive] = useState("overview");
  const [preset, setPreset] = useState("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const foBillingOnly = user?.role === "fo" && !hasPermission(user, "reports.view");
  const hasReportsFeature = hasFeature(clinic, "reports");
  const hasBillingFeature = hasFeature(clinic, "billing");

  useEffect(() => {
    if (tabs.length && !tabs.find((t) => t.id === active)) {
      setActive(tabs[0].id);
    }
  }, [tabs, active]);

  const dateParams = useMemo(() => buildDateParams(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    const tab = REPORT_SECTIONS.find((t) => t.id === active);
    if (!tab) return;
    setLoading(true);
    setError("");
    try {
      const params = tab.noDate ? {} : dateParams;
      const result = await fetchReport(tab.endpoint, params);
      setData(result);
    } catch (e) {
      setData(null);
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => d.msg || JSON.stringify(d)).join("; ")
          : detail?.message || e?.message || "Failed to load report";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [active, dateParams]);

  useEffect(() => {
    if (clinicLoading || !tabs.length) return;
    load();
  }, [load, tabs.length, clinicLoading]);

  const handleExport = async () => {
    const tab = REPORT_SECTIONS.find((t) => t.id === active);
    if (!tab?.export || !data) return;
    setExporting(true);
    try {
      if (tab.exportCsv) {
        const res = await api.get(tab.export, { params: dateParams, responseType: "blob" });
        const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${active}-report.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        await downloadReportExport(tab.export, dateParams, `${active}-report.xlsx`);
      }
    } catch (e) {
      setError(e?.response?.data?.detail || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (clinicLoading) {
    return (
      <div className="p-10 text-center text-[#5C6C62]">Loading reports…</div>
    );
  }
  if (foBillingOnly && !hasBillingFeature) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-2xl mx-auto">
        <LockedNotice feature="billing" />
      </div>
    );
  }
  if (!foBillingOnly && !hasReportsFeature) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-2xl mx-auto">
        <LockedNotice feature="reports" />
      </div>
    );
  }
  if (!tabs.length) {
    return (
      <div className="p-10 text-center text-[#5C6C62]">You do not have permission to view reports.</div>
    );
  }

  const rangeLabel = data?.range ? `${data.range.from} — ${data.range.to}` : "";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="reports-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-eyebrow">Insights</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Reports</h1>
          <p className="mt-2 text-[#5C6C62]">
            Business, operational, and clinical summaries from existing records.
            {rangeLabel && <span className="block mt-1 text-xs">Period: {rangeLabel}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="bl-btn-secondary text-sm inline-flex items-center gap-1.5" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button type="button" onClick={handleExport} className="bl-btn-primary text-sm inline-flex items-center gap-1.5" disabled={loading || !data || exporting}>
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-1 bg-[#F3F1EB] rounded-xl p-1">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={preset === p.key ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#5C6C62" }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs text-[#5C6C62] mb-1">From</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="bl-input" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[#5C6C62] mb-1">To</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="bl-input" />
          </label>
          <button type="button" onClick={load} className="bl-btn-primary text-sm">Apply</button>
        </div>
      )}

      <div className="mt-5 flex gap-1 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0"
            style={active === t.id ? { background: "#52796F", color: "white" } : { background: "#F3F1EB", color: "#5C6C62" }}
            data-testid={`report-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-6 bl-card p-5 text-[#B14A2C]" data-testid="reports-error">{error}</div>
      )}

      {!error && (
        <div className="mt-6">
          {loading ? (
            <div className="bl-card p-10 text-center text-[#5C6C62]">Loading report…</div>
          ) : (
            <SectionBody section={active} data={data} />
          )}
        </div>
      )}
    </div>
  );
}
