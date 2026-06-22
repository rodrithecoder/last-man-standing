import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase Client ──────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY
);

// ─── Storage Keys (legacy, kept as constants for migration if needed) ────────
const SK_BOOKINGS = "rentalpro_bookings_v1";
const SK_SETTINGS = "rentalpro_settings_v1";

// ─── Defaults ────────────────────────────────────────────────────────────────
const today = new Date().toISOString().split("T")[0];

const DEFAULT_ITEMS = [
  { id: "chairs", name: "Chairs", price: 3, inventory: 80 },
  { id: "tables_6ft", name: "6ft Tables", price: 15, inventory: 6 },
  { id: "coolers", name: "Coolers", price: 20, inventory: 2 },
];

const DEFAULT_SETTINGS = {
  items: DEFAULT_ITEMS,
  startDate: today,
  endDate: (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 4);
    d.setDate(0);
    return d.toISOString().split("T")[0];
  })(),
  investment: 0,
  startingGeneral: 0,
  startingChetos: 0,
  startingRodri: 0,
};

// ─── Supabase Persistence ─────────────────────────────────────────────────────
function bookingToDB(b) {
  return {
    id: b.id,
    name: b.name,
    sales_rep: b.salesRep,
    start_date: b.startDate,
    end_date: b.endDate,
    days: b.days,
    items: b.items || {},
    service_type: b.serviceType,
    address: b.address || "",
    notes: b.notes || "",
    phone: b.phone || "",
    email: b.email || "",
    confirmed: b.confirmed || false,
    confirm_sent: b.confirmSent || false,
    discount: b.discount || 0,
    items_total: b.itemsTotal || 0,
    delivery_fee: b.deliveryFee || 0,
    discount_amount: b.discountAmount || 0,
    total_cost: b.totalCost,
    status: b.status || "active",
  };
}
function bookingFromDB(r) {
  return {
    id: r.id,
    name: r.name,
    salesRep: r.sales_rep,
    startDate: r.start_date,
    endDate: r.end_date,
    days: r.days,
    items: r.items || {},
    serviceType: r.service_type,
    address: r.address || "",
    notes: r.notes || "",
    phone: r.phone || "",
    email: r.email || "",
    confirmed: !!r.confirmed,
    confirmSent: !!r.confirm_sent,
    discount: Number(r.discount) || 0,
    itemsTotal: Number(r.items_total) || 0,
    deliveryFee: Number(r.delivery_fee) || 0,
    discountAmount: Number(r.discount_amount) || 0,
    totalCost: Number(r.total_cost) || 0,
    status: r.status || "active",
  };
}

async function fetchAllBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("start_date", { ascending: true });
  if (error) { console.error("fetchAllBookings error:", error); return []; }
  return (data || []).map(bookingFromDB);
}

async function upsertBookingDB(b) {
  const { error } = await supabase.from("bookings").upsert(bookingToDB(b));
  if (error) console.error("upsertBookingDB error:", error);
}

async function deleteBookingDB(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) console.error("deleteBookingDB error:", error);
}

async function fetchSettings() {
  // Returns { ok: true, data: <obj-or-null> } on success.
  // Returns { ok: false, error } on failure.
  // This distinction is CRITICAL — if we can't tell "row doesn't exist"
  // from "network failed", we risk overwriting real data with defaults.
  try {
    const { data, error } = await supabase
      .from("settings").select("data").eq("id", 1).maybeSingle();
    if (error) {
      console.error("fetchSettings error:", error);
      return { ok: false, error };
    }
    return { ok: true, data: data?.data || null };
  } catch (e) {
    console.error("fetchSettings threw:", e);
    return { ok: false, error: e };
  }
}

async function saveSettingsDB(settings) {
  const { error } = await supabase
    .from("settings")
    .upsert({ id: 1, data: settings, updated_at: new Date().toISOString() });
  if (error) console.error("saveSettingsDB error:", error);
}

async function fetchAllPayments() {
  const { data, error } = await supabase
    .from("payments").select("*").order("collected_at", { ascending: true });
  if (error) { console.error("fetchAllPayments error:", error); return []; }
  return (data || []).map((r) => ({
    id: r.id,
    bookingId: r.booking_id,
    amount: Number(r.amount) || 0,
    collectedBy: r.collected_by,
    collectedAt: r.collected_at,
    note: r.note || "",
  }));
}

async function addPaymentDB(p) {
  const { error } = await supabase.from("payments").insert({
    id: p.id, booking_id: p.bookingId, amount: p.amount,
    collected_by: p.collectedBy, collected_at: p.collectedAt, note: p.note || "",
  });
  if (error) console.error("addPaymentDB error:", error);
}

async function setBookingStatusDB(id, status) {
  const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
  if (error) console.error("setBookingStatusDB error:", error);
}

async function fetchAllSettlements() {
  const { data, error } = await supabase
    .from("settlements").select("*").order("settled_at", { ascending: false });
  if (error) { console.error("fetchAllSettlements error:", error); return []; }
  return (data || []).map((r) => ({
    id: r.id,
    settledAt: r.settled_at,
    chetosAmount: Number(r.chetos_amount) || 0,
    rodriAmount: Number(r.rodri_amount) || 0,
    chetosExpenses: Number(r.chetos_expenses) || 0,
    rodriExpenses: Number(r.rodri_expenses) || 0,
    difference: Number(r.difference) || 0,
    note: r.note || "",
  }));
}

async function addSettlementDB(s) {
  const { error } = await supabase.from("settlements").insert({
    id: s.id, settled_at: s.settledAt,
    chetos_amount: s.chetosAmount, rodri_amount: s.rodriAmount,
    chetos_expenses: s.chetosExpenses || 0, rodri_expenses: s.rodriExpenses || 0,
    difference: s.difference, note: s.note || "",
  });
  if (error) console.error("addSettlementDB error:", error);
}

async function fetchAllExpenses() {
  const { data, error } = await supabase
    .from("expenses").select("*").order("created_at", { ascending: true });
  if (error) { console.error("fetchAllExpenses error:", error); return []; }
  return (data || []).map((r) => ({
    id: r.id,
    amount: Number(r.amount) || 0,
    paidBy: r.paid_by,
    concept: r.concept || "",
    isInvestment: !!r.is_investment,
    createdAt: r.created_at,
  }));
}

async function addExpenseDB(e) {
  const { error } = await supabase.from("expenses").insert({
    id: e.id, amount: e.amount, paid_by: e.paidBy,
    concept: e.concept || "", is_investment: !!e.isInvestment, created_at: e.createdAt,
  });
  if (error) console.error("addExpenseDB error:", error);
}

async function deleteExpenseDB(id) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) console.error("deleteExpenseDB error:", error);
}

// ─── Vacations DB (NEW) ───────────────────────────────────────────────────────
async function fetchAllVacations() {
  const { data, error } = await supabase
    .from("vacations").select("*").order("start_date", { ascending: true });
  if (error) { console.error("fetchAllVacations error:", error); return []; }
  return (data || []).map((r) => ({
    id: r.id,
    repName: r.rep_name,
    startDate: r.start_date,
    endDate: r.end_date,
    note: r.note || "",
  }));
}

async function upsertVacationDB(v) {
  const { error } = await supabase.from("vacations").upsert({
    id: v.id, rep_name: v.repName,
    start_date: v.startDate, end_date: v.endDate, note: v.note || "",
  });
  if (error) console.error("upsertVacationDB error:", error);
}

async function deleteVacationDB(id) {
  const { error } = await supabase.from("vacations").delete().eq("id", id);
  if (error) console.error("deleteVacationDB error:", error);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function fmtDate(ds) {
  if (!ds) return "";
  const [y, m, d] = ds.split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}
function fmtDateShort(ds) {
  if (!ds) return "";
  const [y, m, d] = ds.split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}
function getDIM(y, m) { return new Date(y, m + 1, 0).getDate(); }
function daysBetween(s, e) {
  return Math.round((new Date(e + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000) + 1;
}
function getMonths(sd, ed) {
  if (!sd || !ed) return [];
  const res = [];
  const cur = new Date(sd + "T00:00:00");
  cur.setDate(1);
  const end = new Date(ed + "T00:00:00");
  end.setDate(1);
  while (cur <= end) {
    res.push({ year: cur.getFullYear(), month: cur.getMonth() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return res;
}
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function usedOnDate(bookings, date, itemId) {
  return bookings
    .filter((b) => b.startDate <= date && b.endDate >= date)
    .reduce((s, b) => s + (b.items?.[itemId] || 0), 0);
}
function maxUsedInRange(bookings, start, end, itemId, excludeId = null) {
  let max = 0;
  const cur = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cur <= last) {
    const ds = localDateStr(cur);
    const used = bookings
      .filter((b) => b.id !== excludeId && b.startDate <= ds && b.endDate >= ds)
      .reduce((s, b) => s + (b.items?.[itemId] || 0), 0);
    max = Math.max(max, used);
    cur.setDate(cur.getDate() + 1);
  }
  return max;
}
function calcTotal(itemsMap, itemDefs, svcType, deliveryFee, discount) {
  const itemsTotal = itemDefs.reduce((s, it) => s + (itemsMap[it.id] || 0) * it.price, 0);
  const fee = svcType === "delivery" ? parseFloat(deliveryFee) || 0 : 0;
  const sub = itemsTotal + fee;
  const disc = sub * ((parseFloat(discount) || 0) / 100);
  return { itemsTotal, deliveryFee: fee, discountAmount: disc, totalCost: sub - disc };
}

// CSV export helper (bookings only — keeps existing behavior)
function bookingsToCSV(bookings, itemDefs) {
  const headers = [
    "Customer", "Sales Rep", "Start", "End", "Days",
    ...itemDefs.map((i) => i.name),
    "Service", "Address", "Subtotal", "Delivery Fee",
    "Discount %", "Discount $", "Total", "Notes", "Phone", "Email",
  ];
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = bookings.map((b) =>
    [
      b.name, b.salesRep, b.startDate, b.endDate, b.days,
      ...itemDefs.map((i) => b.items?.[i.id] || 0),
      b.serviceType, b.address || "",
      (b.itemsTotal || 0).toFixed(2),
      (b.deliveryFee || 0).toFixed(2),
      b.discount || 0,
      (b.discountAmount || 0).toFixed(2),
      b.totalCost.toFixed(2),
      b.notes || "",
      b.phone || "",
      b.email || "",
    ].map(escape).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}
function downloadCSV(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Vacations active on a given date (NEW)
function vacationsOnDate(vacations, ds) {
  return vacations.filter((v) => v.startDate <= ds && v.endDate >= ds);
}

// Build a single CSV with all data stacked in labeled sections (NEW)
function buildBackupCSV({ bookings, vacations, payments, settlements, expenses, itemDefs, settings }) {
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const section = (title, headers, rows) => {
    const out = [`# ${title}`];
    out.push(headers.map(escape).join(","));
    if (rows.length === 0) out.push("(none)");
    else rows.forEach((r) => out.push(r.map(escape).join(",")));
    return out.join("\n");
  };

  const stamp = new Date().toISOString();
  const meta = section("BACKUP META", ["Generated", "App"],
    [[stamp, "Last Man Standing — Rental Manager"]]);

  // SETTINGS as a labeled section — critical for full recovery
  const settingsRows = settings ? [
    ["startDate", settings.startDate || ""],
    ["endDate", settings.endDate || ""],
    ["investment", (settings.investment || 0).toFixed(2)],
    ["startingGeneral", (settings.startingGeneral || 0).toFixed(2)],
    ["startingChetos", (settings.startingChetos || 0).toFixed(2)],
    ["startingRodri", (settings.startingRodri || 0).toFixed(2)],
  ] : [];
  const settingsSection = section("SETTINGS", ["Key", "Value"], settingsRows);

  const itemsRows = (settings?.items || []).map((i) => [
    i.id, i.name, i.price, i.inventory,
  ]);
  const itemsSection = section("INVENTORY ITEMS",
    ["ID", "Name", "Price", "Inventory"], itemsRows);

  const bookingsSection = section("BOOKINGS",
    [
      "ID", "Customer", "Sales Rep", "Start", "End", "Days",
      ...itemDefs.map((i) => i.name),
      "Service", "Address", "Subtotal", "Delivery Fee",
      "Discount %", "Discount $", "Total", "Status", "Notes", "Phone", "Email", "Confirmed",
    ],
    bookings.map((b) => [
      b.id, b.name, b.salesRep, b.startDate, b.endDate, b.days,
      ...itemDefs.map((i) => b.items?.[i.id] || 0),
      b.serviceType, b.address || "",
      (b.itemsTotal || 0).toFixed(2),
      (b.deliveryFee || 0).toFixed(2),
      b.discount || 0,
      (b.discountAmount || 0).toFixed(2),
      (b.totalCost || 0).toFixed(2),
      b.status || "active",
      b.notes || "",
      b.phone || "",
      b.email || "",
      b.confirmed ? "yes" : "no",
    ])
  );

  const vacationsSection = section("VACATIONS",
    ["ID", "Rep Name", "Start", "End", "Note"],
    vacations.map((v) => [v.id, v.repName, v.startDate, v.endDate, v.note || ""])
  );

  const paymentsSection = section("PAYMENTS",
    ["ID", "Booking ID", "Amount", "Collected By", "Collected At", "Note"],
    payments.map((p) => [
      p.id, p.bookingId, p.amount.toFixed(2),
      p.collectedBy, p.collectedAt, p.note || "",
    ])
  );

  const expensesSection = section("EXPENSES",
    ["ID", "Amount", "Paid By", "Concept", "Investment?", "Created At"],
    expenses.map((e) => [
      e.id, e.amount.toFixed(2), e.paidBy,
      e.concept || "", e.isInvestment ? "yes" : "no", e.createdAt,
    ])
  );

  const settlementsSection = section("SETTLEMENTS",
    ["ID", "Settled At", "Chetos Collected", "Rodri Collected",
     "Chetos Expenses", "Rodri Expenses", "Difference", "Note"],
    settlements.map((s) => [
      s.id, s.settledAt,
      (s.chetosAmount || 0).toFixed(2),
      (s.rodriAmount || 0).toFixed(2),
      (s.chetosExpenses || 0).toFixed(2),
      (s.rodriExpenses || 0).toFixed(2),
      (s.difference || 0).toFixed(2),
      s.note || "",
    ])
  );

  return [meta, "", settingsSection, "", itemsSection, "",
          bookingsSection, "", vacationsSection, "",
          paymentsSection, "", expensesSection, "", settlementsSection].join("\n");
}

// Backup reminder helpers (uses localStorage — per-device reminder) (NEW)
const LAST_BACKUP_KEY = "rentalpro_last_backup_at";
function getLastBackupAt() {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}
function setLastBackupAt(iso) {
  try { localStorage.setItem(LAST_BACKUP_KEY, iso); } catch { /* ignore */ }
}

// ─── useWindowWidth ───────────────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#fafaf6",
  surface: "#ffffff",
  border: "#e4e4dc",
  borderStrong: "#cdcdbf",
  text: "#1c2620",
  textSub: "#5e6a62",
  textMuted: "#9aa39c",
  accent: "#2d6a4f",
  accentDeep: "#1f4d39",
  accentSoft: "#e3f0e7",
  sunshine: "#fbcf3c",
  sunshineSoft: "#fff4cc",
  brick: "#b73c2a",
  brickSoft: "#fbe7e3",
  danger: "#b73c2a",
  success: "#2d6a4f",
  warning: "#7a5800",
  cap50: "#cfe9d6",
  cap80: "#ffe89a",
  cap100: "#f5c2b8",
};

const T = {
  sans: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  mono: "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace",
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
const inp = (mobile) => ({
  width: "100%",
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  padding: mobile ? "10px 10px" : "7px 9px",
  color: C.text,
  fontSize: mobile ? 16 : 13,
  fontFamily: T.sans,
  boxSizing: "border-box",
  outline: "none",
  WebkitAppearance: "none",
  transition: "border-color 0.15s",
});

function Label({ children }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: "0.08em", color: C.textMuted,
      textTransform: "uppercase", fontFamily: T.sans, marginBottom: 5, fontWeight: 500,
    }}>
      {children}
    </div>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && !error && (
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: T.sans }}>{hint}</div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: C.danger, marginTop: 4, fontFamily: T.sans }}>{error}</div>
      )}
    </div>
  );
}

function Btn({ children, onClick, variant = "default", small, fullWidth, style: extra, type = "button", disabled }) {
  const base = {
    border: `1px solid ${C.borderStrong}`,
    borderRadius: 3,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: T.sans,
    fontWeight: 500,
    letterSpacing: "0.03em",
    fontSize: small ? 11 : 13,
    padding: small ? "4px 10px" : "8px 16px",
    transition: "all 0.15s",
    width: fullWidth ? "100%" : undefined,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    default: { background: C.surface, color: C.text },
    primary: { background: C.accent, color: "#fff", border: `1px solid ${C.accent}` },
    ghost: { background: "transparent", color: C.textSub, border: `1px solid transparent` },
    danger: { background: "transparent", color: C.danger, border: `1px solid ${C.danger}` },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...extra }}>
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ borderTop: `1px solid ${C.border}`, margin: "16px 0" }} />;
}

function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "20px 22px", maxWidth: 380, width: "100%", fontFamily: T.sans,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.textSub, marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
          <Btn onClick={onConfirm} variant={danger ? "danger" : "primary"}
            style={danger ? { background: C.danger, color: C.surface, borderColor: C.danger } : undefined}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel({
  isMobile, settings, settingsOpen, setSettingsOpen,
  settingsDraft, setSettingsDraft, settingsErr, setSettingsErr,
  editingItem, setEditingItem, itemDraft, setItemDraft, itemErr, setItemErr,
  saveSettings, setCalMonth,
}) {
  const inputStyle = inp(isMobile);

  function openSettings() {
    setSettingsDraft({ ...settings, items: settings.items.map((i) => ({ ...i })) });
    setSettingsOpen(true);
    setSettingsErr("");
  }
  function applySettings() {
    const d = settingsDraft;
    if (!d.startDate || !d.endDate) { setSettingsErr("Both dates required."); return; }
    if (d.startDate > d.endDate) { setSettingsErr("Start must be before end."); return; }
    if (!d.items.length) { setSettingsErr("Add at least one inventory item."); return; }
    saveSettings(d);
    setSettingsOpen(false);
    setCalMonth(0);
  }
  function startEditItem(item) {
    setEditingItem(item.id);
    setItemDraft({ name: item.name, price: item.price, inventory: item.inventory });
    setItemErr("");
  }
  function startNewItem() {
    setEditingItem("new");
    setItemDraft({ name: "", price: "", inventory: "" });
    setItemErr("");
  }
  function saveItem() {
    const price = parseFloat(itemDraft.price);
    const inv = parseInt(itemDraft.inventory);
    if (!itemDraft.name.trim()) { setItemErr("Name required."); return; }
    if (isNaN(price) || price < 0) { setItemErr("Valid price required."); return; }
    if (isNaN(inv) || inv < 1) { setItemErr("Inventory must be ≥ 1."); return; }
    if (editingItem === "new") {
      setSettingsDraft((d) => ({
        ...d,
        items: [...d.items, { id: genId(), name: itemDraft.name.trim(), price, inventory: inv }],
      }));
    } else {
      setSettingsDraft((d) => ({
        ...d,
        items: d.items.map((i) =>
          i.id === editingItem ? { ...i, name: itemDraft.name.trim(), price, inventory: inv } : i
        ),
      }));
    }
    setEditingItem(null);
  }
  function deleteItem(id) {
    setSettingsDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: 16, overflow: "hidden" }}>
      <button
        onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: "10px 14px", cursor: "pointer", fontFamily: T.sans }}
      >
        <span style={{ fontSize: 11, letterSpacing: "0.08em", color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>Settings</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>{settingsOpen ? "▲" : "▼"}</span>
      </button>

      {settingsOpen && settingsDraft && (
        <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ height: 14 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Start Date">
              <input type="date" style={inputStyle} value={settingsDraft.startDate}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, startDate: e.target.value }))} />
            </Field>
            <Field label="End Date">
              <input type="date" style={inputStyle} value={settingsDraft.endDate}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, endDate: e.target.value }))} />
            </Field>
          </div>

          <Divider />
          <Label>Inventory Items</Label>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Item", "Price", "Qty", ""].map((h) => (
                  <th key={h} style={{ padding: "5px 6px", textAlign: "left", fontSize: 10, color: C.textMuted, fontFamily: T.sans, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settingsDraft.items.map((it) =>
                editingItem === it.id ? (
                  <tr key={it.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "4px 6px" }}>
                      <input style={{ ...inp(false), fontSize: 12 }} value={itemDraft.name}
                        onChange={(e) => setItemDraft((d) => ({ ...d, name: e.target.value }))} />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="number" style={{ ...inp(false), fontSize: 12 }} value={itemDraft.price}
                        onChange={(e) => setItemDraft((d) => ({ ...d, price: e.target.value }))} />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="number" style={{ ...inp(false), fontSize: 12 }} value={itemDraft.inventory}
                        onChange={(e) => setItemDraft((d) => ({ ...d, inventory: e.target.value }))} />
                    </td>
                    <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                      <Btn small onClick={saveItem} variant="primary">Save</Btn>{" "}
                      <Btn small onClick={() => setEditingItem(null)} variant="ghost">Cancel</Btn>
                    </td>
                  </tr>
                ) : (
                  <tr key={it.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 6px", fontFamily: T.sans, fontSize: 12, color: C.text }}>{it.name}</td>
                    <td style={{ padding: "6px 6px", fontFamily: T.mono, fontSize: 12, color: C.textSub }}>${it.price}</td>
                    <td style={{ padding: "6px 6px", fontFamily: T.mono, fontSize: 12, color: C.textSub }}>{it.inventory}</td>
                    <td style={{ padding: "6px 6px", whiteSpace: "nowrap" }}>
                      <Btn small onClick={() => startEditItem(it)} variant="ghost">Edit</Btn>{" "}
                      <Btn small onClick={() => deleteItem(it.id)} variant="ghost" style={{ color: C.danger }}>Remove</Btn>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          {editingItem === "new" ? (
            <div style={{ background: C.accentSoft, border: `1px solid ${C.border}`, borderRadius: 3, padding: "10px 12px", marginBottom: 10 }}>
              <Label>New Item</Label>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input style={inputStyle} placeholder="Item name" value={itemDraft.name}
                  onChange={(e) => setItemDraft((d) => ({ ...d, name: e.target.value }))} />
                <input type="number" style={inputStyle} placeholder="Price $" value={itemDraft.price}
                  onChange={(e) => setItemDraft((d) => ({ ...d, price: e.target.value }))} />
                <input type="number" style={inputStyle} placeholder="Qty" value={itemDraft.inventory}
                  onChange={(e) => setItemDraft((d) => ({ ...d, inventory: e.target.value }))} />
              </div>
              {itemErr && <div style={{ fontSize: 11, color: C.danger, marginBottom: 6 }}>{itemErr}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={saveItem} variant="primary" small>Add Item</Btn>
                <Btn onClick={() => setEditingItem(null)} variant="ghost" small>Cancel</Btn>
              </div>
            </div>
          ) : (
            <Btn onClick={startNewItem} variant="default" small>+ Add Item</Btn>
          )}

          {settingsErr && <div style={{ fontSize: 11, color: C.danger, margin: "8px 0" }}>{settingsErr}</div>}

          <Divider />
          <Label>Starting Balances & Investment</Label>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10, fontFamily: T.sans, lineHeight: 1.4 }}>
            One-time historical values. Update these to reflect what you've collected before using the app.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Starting General ($)">
              <input type="number" step="0.01" style={inputStyle}
                value={settingsDraft.startingGeneral ?? 0}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, startingGeneral: parseFloat(e.target.value) || 0 }))} />
            </Field>
            <Field label="Investment ($)">
              <input type="number" step="0.01" style={inputStyle}
                value={settingsDraft.investment ?? 0}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, investment: parseFloat(e.target.value) || 0 }))} />
            </Field>
            <Field label="Starting Chetos ($)">
              <input type="number" step="0.01" style={inputStyle}
                value={settingsDraft.startingChetos ?? 0}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, startingChetos: parseFloat(e.target.value) || 0 }))} />
            </Field>
            <Field label="Starting Rodri ($)">
              <input type="number" step="0.01" style={inputStyle}
                value={settingsDraft.startingRodri ?? 0}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, startingRodri: parseFloat(e.target.value) || 0 }))} />
            </Field>
          </div>

          <Divider />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => setSettingsOpen(false)} variant="ghost">Cancel</Btn>
            <Btn onClick={applySettings} variant="primary">Save Settings</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Booking Form ─────────────────────────────────────────────────────────────
function BookingForm({
  isMobile, itemDefs, startDate, endDate, bookings,
  form, setForm, formErrors, successMsg,
  editingBookingId, cancelEdit, handleSubmit,
  rentalDays, getAvail, preview, formItemsMap,
}) {
  const inputStyle = inp(isMobile);

  return (
    <div style={{ padding: isMobile ? "16px" : "16px 16px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", color: C.textMuted, textTransform: "uppercase", fontFamily: T.sans, fontWeight: 600 }}>
          {editingBookingId ? "Edit Booking" : "New Booking"}
        </div>
        {editingBookingId && (
          <Btn small variant="ghost" onClick={cancelEdit}>Cancel edit</Btn>
        )}
      </div>

      {successMsg && (
        <div style={{ background: "#eaf7f0", border: `1px solid #a8d5be`, borderRadius: 3, padding: "8px 12px", color: C.success, fontSize: 12, fontFamily: T.sans, marginBottom: 14 }}>
          {successMsg}
        </div>
      )}

      <Field label="Customer Name" error={formErrors.name}>
        <input style={inputStyle} placeholder="Full name or company" value={form.name}
          onChange={(e) => setForm({ name: e.target.value })} />
      </Field>
      <Field label="Sales Rep" error={formErrors.salesRep}>
        <input style={inputStyle} placeholder="Representative name" value={form.salesRep}
          onChange={(e) => setForm({ salesRep: e.target.value })} />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Phone (SMS)">
          <input type="tel" style={inputStyle} placeholder="(831) 555-0123" value={form.phone}
            onChange={(e) => setForm({ phone: e.target.value })} />
        </Field>
        <Field label="Email (optional)">
          <input type="email" style={inputStyle} placeholder="name@email.com" value={form.email}
            onChange={(e) => setForm({ email: e.target.value })} />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div>
          <Label>Start Date</Label>
          <input type="date" style={inputStyle} min={startDate} max={endDate} value={form.startDate}
            onChange={(e) => setForm({
              startDate: e.target.value,
              endDate: form.endDate && form.endDate < e.target.value ? e.target.value : form.endDate,
            })} />
          {formErrors.startDate && <div style={{ fontSize: 11, color: C.danger, marginTop: 4 }}>{formErrors.startDate}</div>}
        </div>
        <div>
          <Label>End Date</Label>
          <input type="date" style={inputStyle} min={form.startDate || startDate} max={endDate} value={form.endDate}
            onChange={(e) => setForm({ endDate: e.target.value })} />
          {formErrors.endDate && <div style={{ fontSize: 11, color: C.danger, marginTop: 4 }}>{formErrors.endDate}</div>}
        </div>
      </div>

      {rentalDays && (
        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginBottom: 14 }}>
          Duration: <span style={{ color: C.text, fontWeight: 600 }}>{rentalDays} day{rentalDays > 1 ? "s" : ""}</span>
          <span style={{ marginLeft: 10, color: C.textMuted }}>{fmtDateShort(form.startDate)} – {fmtDateShort(form.endDate)}</span>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <Label>Items</Label>
        {formErrors.items && <div style={{ fontSize: 11, color: C.danger, marginBottom: 6 }}>{formErrors.items}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Item", "Rate", "Qty", "Avail"].map((h) => (
                <th key={h} style={{ padding: "4px 6px", textAlign: "left", fontSize: 10, color: C.textMuted, fontFamily: T.sans, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itemDefs.map((it) => {
              const avail = getAvail(it.id);
              const err = formErrors[`item_${it.id}`];
              return (
                <tr key={it.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "6px 6px", fontSize: 12, fontFamily: T.sans, color: C.text }}>{it.name}</td>
                  <td style={{ padding: "6px 6px", fontSize: 12, fontFamily: T.mono, color: C.textSub }}>${it.price}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input type="number" min={0} max={it.inventory}
                      style={{ ...inp(false), fontSize: 12, width: 60, padding: "5px 6px", borderColor: err ? C.danger : C.border }}
                      value={form.items[it.id] || ""} placeholder="0"
                      onChange={(e) => setForm({ items: { ...form.items, [it.id]: e.target.value } })} />
                    {err && <div style={{ fontSize: 10, color: C.danger }}>{err}</div>}
                  </td>
                  <td style={{ padding: "6px 6px", fontSize: 11, fontFamily: T.mono, color: avail !== null && avail <= 2 ? C.danger : C.textMuted }}>
                    {avail !== null ? avail : it.inventory}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Field label="Service Type">
        <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
          {["pickup", "delivery"].map((t) => (
            <button key={t} type="button"
              onClick={() => setForm({ serviceType: t, deliveryFee: "", address: "" })}
              style={{ flex: 1, padding: isMobile ? "10px" : "7px", border: "none", cursor: "pointer", fontFamily: T.sans, fontSize: 12, fontWeight: 600, background: form.serviceType === t ? C.accent : C.surface, color: form.serviceType === t ? "#fff" : C.textSub, transition: "all 0.15s" }}>
              {t === "pickup" ? "Pickup" : "Delivery"}
            </button>
          ))}
        </div>
      </Field>

      {form.serviceType === "delivery" && (
        <>
          <Field label="Delivery Fee ($)" error={formErrors.deliveryFee}>
            <input type="number" style={inputStyle} min={0} step="0.01" placeholder="0.00"
              value={form.deliveryFee} onChange={(e) => setForm({ deliveryFee: e.target.value })} />
          </Field>
          <Field label="Delivery Address">
            <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56, lineHeight: 1.5 }}
              placeholder="Street, City, ZIP" value={form.address}
              onChange={(e) => setForm({ address: e.target.value })} />
          </Field>
        </>
      )}

      <Field label="Discount (%)" error={formErrors.discount}>
        <input type="number" style={inputStyle} min={0} max={100} placeholder="0"
          value={form.discount} onChange={(e) => setForm({ discount: e.target.value })} />
      </Field>

      <Field label="Notes">
        <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56, lineHeight: 1.5 }}
          placeholder="Special requirements" value={form.notes}
          onChange={(e) => setForm({ notes: e.target.value })} />
      </Field>

      {preview && (
        <div style={{ background: C.accentSoft, border: `1px solid ${C.border}`, borderRadius: 3, padding: "12px 14px", marginBottom: 14 }}>
          <Label>Cost Summary</Label>
          {itemDefs.map((it) => {
            const qty = formItemsMap[it.id];
            if (!qty) return null;
            return (
              <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: T.sans, color: C.textSub, marginBottom: 4 }}>
                <span>{it.name} × {qty}</span>
                <span style={{ fontFamily: T.mono }}>${(qty * it.price).toFixed(2)}</span>
              </div>
            );
          })}
          {form.serviceType === "delivery" && preview.deliveryFee > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: T.sans, color: C.textSub, marginBottom: 4 }}>
              <span>Delivery</span>
              <span style={{ fontFamily: T.mono }}>${preview.deliveryFee.toFixed(2)}</span>
            </div>
          )}
          {preview.discountAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: T.sans, color: C.danger, marginBottom: 4 }}>
              <span>Discount ({form.discount}%)</span>
              <span style={{ fontFamily: T.mono }}>-${preview.discountAmount.toFixed(2)}</span>
            </div>
          )}
          <div style={{ borderTop: `1px solid ${C.borderStrong}`, marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 700, fontFamily: T.sans, fontSize: 14 }}>
            <span>Total</span>
            <span style={{ fontFamily: T.mono }}>${preview.totalCost.toFixed(2)}</span>
          </div>
        </div>
      )}

      <Btn onClick={handleSubmit} variant="primary" fullWidth>
        {editingBookingId ? "Update Booking" : "Save Booking"}
      </Btn>
    </div>
  );
}

// ─── Calendar (MODIFIED: accepts vacations and shows them on days) ────────────
function CalendarView({
  isMobile, months, safeMonth, setCalMonth,
  startDate, endDate, bookings, itemDefs, dayStrain, strainBg,
  vacations = [],
}) {
  const am = months[safeMonth];
  return (
    <div style={{ padding: isMobile ? "14px" : "20px 24px" }}>
      {months.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textMuted, fontFamily: T.sans, fontSize: 13 }}>
          Configure a date range in Settings.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
            {months.map((m, i) => {
              const lbl = new Date(m.year, m.month, 1).toLocaleDateString("en-US", {
                month: isMobile ? "short" : "long",
                year: "numeric",
              });
              const active = safeMonth === i;
              return (
                <button key={i} onClick={() => setCalMonth(i)}
                  style={{ padding: "4px 12px", borderRadius: 3, border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accent : C.surface, color: active ? "#fff" : C.textSub, cursor: "pointer", fontSize: 12, fontFamily: T.sans, whiteSpace: "nowrap", flexShrink: 0, fontWeight: active ? 600 : 400 }}>
                  {lbl}
                </button>
              );
            })}
          </div>

          {am && (() => {
            const { year, month } = am;
            const dim = getDIM(year, month);
            const fd = new Date(year, month, 1).getDay();
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: isMobile ? 3 : 4, marginBottom: 4 }}>
                  {(isMobile ? ["S", "M", "T", "W", "T", "F", "S"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((d, i) => (
                    <div key={i} style={{ textAlign: "center", fontSize: 10, color: C.textMuted, fontFamily: T.sans, paddingBottom: 5, letterSpacing: "0.05em" }}>{d}</div>
                  ))}
                  {Array(fd).fill(null).map((_, i) => <div key={`e${i}`} />)}
                  {Array(dim).fill(null).map((_, i) => {
                    const day = i + 1;
                    const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const oor = ds < startDate || ds > endDate;
                    const isPast = ds < today;
                    const isToday = ds === today;
                    const strain = dayStrain(ds);
                    const dayBkgs = bookings.filter((b) => b.startDate <= ds && b.endDate >= ds);
                    const dayVacs = !oor && !isPast ? vacationsOnDate(vacations, ds) : [];
                    return (
                      <div key={day} style={{
                        background: oor || isPast ? C.bg : strainBg(strain),
                        border: `${isToday ? 2 : 1}px solid ${isToday ? C.accent : C.border}`,
                        borderRadius: 2,
                        padding: isMobile ? "4px 3px" : "5px 6px",
                        minHeight: isMobile ? 52 : 68,
                        opacity: oor ? 0.3 : isPast ? 0.5 : 1,
                      }}>
                        <div style={{ fontSize: isMobile ? 11 : 12, fontWeight: isToday ? 700 : 500, color: C.text, fontFamily: T.sans, marginBottom: 3 }}>{day}</div>
                        {dayVacs.length > 0 && (
                          <div title={dayVacs.map((v) => `${v.repName} on vacation`).join(", ")}
                            style={{
                              background: C.sunshineSoft,
                              border: `1px solid ${C.sunshine}`,
                              color: C.warning,
                              fontSize: isMobile ? 9 : 10,
                              fontWeight: 700,
                              fontFamily: T.sans,
                              borderRadius: 2,
                              padding: isMobile ? "1px 3px" : "1px 4px",
                              marginBottom: 3,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              lineHeight: 1.2,
                            }}>
                            🌴 {dayVacs.map((v) => v.repName).join(", ")}
                          </div>
                        )}
                        {!oor && !isPast && strain > 0 && itemDefs.map((it) => {
                          const used = usedOnDate(bookings, ds, it.id);
                          if (!used) return null;
                          return (
                            <div key={it.id} style={{ fontSize: 9, color: C.textSub, fontFamily: T.sans, lineHeight: 1.4 }}>
                              {it.name.split(" ")[0]}: {used}
                            </div>
                          );
                        })}
                        {!isMobile && dayBkgs.slice(0, 1).map((b) => (
                          <div key={b.id} style={{ fontSize: 9, color: C.textSub, fontFamily: T.sans, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                            {b.name}
                          </div>
                        ))}
                        {!isMobile && dayBkgs.length > 1 && (
                          <div style={{ fontSize: 9, color: C.textMuted }}>+{dayBkgs.length - 1} more</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {[
                    { c: C.cap50, l: "< 50%" },
                    { c: C.cap80, l: "50–99%" },
                    { c: C.cap100, l: "Full" },
                    { c: C.surface, l: "Empty" },
                  ].map((x) => (
                    <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 10, height: 10, background: x.c, border: `1px solid ${C.border}`, borderRadius: 1 }} />
                      <span style={{ fontSize: 10, color: C.textMuted, fontFamily: T.sans }}>{x.l}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 10, height: 10, background: C.sunshineSoft, border: `1px solid ${C.sunshine}`, borderRadius: 1 }} />
                    <span style={{ fontSize: 10, color: C.textMuted, fontFamily: T.sans }}>🌴 Rep on vacation</span>
                  </div>
                  <span style={{ fontSize: 10, color: C.textMuted, fontFamily: T.sans, marginLeft: "auto" }}>
                    Color reflects highest item utilization
                  </span>
                </div>
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}

// ─── Bookings List ────────────────────────────────────────────────────────────
function BookingsList({
  isMobile, bookings, itemDefs,
  search, setSearch, filterService, setFilterService,
  filterStart, setFilterStart, filterEnd, setFilterEnd,
  filterStatus, setFilterStatus,
  startEditBooking, requestRemoveBooking, exportCSV,
  requestMarkDone,
}) {
  const inputStyle = inp(isMobile);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bookings.filter((b) => {
      const status = b.status || "active";
      if (filterStatus !== "all" && status !== filterStatus) return false;
      if (s) {
        const hay = `${b.name} ${b.salesRep} ${b.notes || ""} ${b.address || ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (filterService !== "all" && b.serviceType !== filterService) return false;
      if (filterStart && b.endDate < filterStart) return false;
      if (filterEnd && b.startDate > filterEnd) return false;
      return true;
    });
  }, [bookings, search, filterService, filterStart, filterEnd, filterStatus]);

  const totalRev = filtered.reduce((s, b) => s + b.totalCost, 0);
  const filtersActive = search || filterService !== "all" || filterStart || filterEnd || filterStatus !== "active";

  return (
    <div style={{ padding: isMobile ? "14px" : "20px 24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <Label>Search</Label>
          <input style={inputStyle} placeholder="Customer, rep, notes…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <Label>Status</Label>
          <select style={inputStyle} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <Label>Service</Label>
          <select style={inputStyle} value={filterService} onChange={(e) => setFilterService(e.target.value)}>
            <option value="all">All</option>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <Label>From</Label>
          <input type="date" style={inputStyle} value={filterStart}
            onChange={(e) => setFilterStart(e.target.value)} />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <Label>To</Label>
          <input type="date" style={inputStyle} value={filterEnd}
            onChange={(e) => setFilterEnd(e.target.value)} />
        </div>
        {filtersActive && (
          <Btn small variant="ghost" onClick={() => {
            setSearch(""); setFilterService("all"); setFilterStart(""); setFilterEnd(""); setFilterStatus("active");
          }}>Clear</Btn>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Btn small onClick={exportCSV} disabled={filtered.length === 0}>Export CSV</Btn>
        </div>
      </div>

      {bookings.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 0", color: C.textMuted, fontFamily: T.sans, fontSize: 13 }}>
          No bookings yet.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 0", color: C.textMuted, fontFamily: T.sans, fontSize: 13 }}>
          No bookings match these filters.
        </div>
      ) : (
        <>
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((b) => {
                const isDone = (b.status || "active") === "done";
                return (
                <div key={b.id} style={{
                  background: C.surface,
                  border: `1px solid ${isDone ? C.accent : C.border}`,
                  borderRadius: 3,
                  padding: "12px 14px",
                  opacity: isDone ? 0.85 : 1,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: C.text, fontFamily: T.sans }}>{b.name}</div>
                        {isDone && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: C.accent, padding: "2px 6px", borderRadius: 2, letterSpacing: "0.06em" }}>DONE</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginTop: 2 }}>
                        {b.salesRep} · {fmtDateShort(b.startDate)} – {fmtDateShort(b.endDate)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {!isDone && <Btn small variant="ghost" onClick={() => startEditBooking(b)}>Edit</Btn>}
                      <Btn small variant="ghost" onClick={() => requestRemoveBooking(b)} style={{ color: C.danger }}>Remove</Btn>
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    {itemDefs.map((it) => {
                      const qty = b.items?.[it.id];
                      if (!qty) return null;
                      return <div key={it.id} style={{ fontSize: 12, color: C.text, fontFamily: T.sans }}>{it.name}: {qty}</div>;
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, background: C.bg, border: `1px solid ${C.border}`, padding: "2px 8px", borderRadius: 2 }}>
                      {b.serviceType === "delivery" ? "Delivery" : "Pickup"}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: T.mono }}>${b.totalCost.toFixed(2)}</span>
                  </div>
                  {!isDone && (
                    <div style={{ marginTop: 10 }}>
                      <Btn variant="primary" fullWidth onClick={() => requestMarkDone(b)}>
                        ✓ Mark Done & Record Payment
                      </Btn>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: T.sans }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                    {["Customer", "Sales Rep", "Period", "Days", ...itemDefs.map((it) => it.name), "Service", "Subtotal", "Delivery", "Disc.", "Total", ""].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b, i) => {
                    const isDone = (b.status || "active") === "done";
                    return (
                    <tr key={b.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.surface : C.bg, opacity: isDone ? 0.7 : 1 }}>
                      <td style={{ padding: "9px 10px", fontWeight: 600, color: C.text }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {b.name}
                          {isDone && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: C.accent, padding: "2px 5px", borderRadius: 2, letterSpacing: "0.06em" }}>DONE</span>
                          )}
                        </div>
                        {b.notes && <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>{b.notes}</div>}
                      </td>
                      <td style={{ padding: "9px 10px", color: C.textSub }}>{b.salesRep}</td>
                      <td style={{ padding: "9px 10px", color: C.textSub, whiteSpace: "nowrap" }}>{fmtDateShort(b.startDate)} – {fmtDateShort(b.endDate)}</td>
                      <td style={{ padding: "9px 10px", color: C.textMuted, fontFamily: T.mono, textAlign: "center" }}>{b.days}</td>
                      {itemDefs.map((it) => (
                        <td key={it.id} style={{ padding: "9px 10px", color: C.text, fontFamily: T.mono, textAlign: "center" }}>{b.items?.[it.id] || "—"}</td>
                      ))}
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{ fontSize: 10, color: C.textSub, border: `1px solid ${C.border}`, padding: "2px 7px", borderRadius: 2 }}>
                          {b.serviceType === "delivery" ? "Delivery" : "Pickup"}
                        </span>
                        {b.address && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{b.address}</div>}
                      </td>
                      <td style={{ padding: "9px 10px", color: C.textSub, fontFamily: T.mono }}>${b.itemsTotal?.toFixed(2) || "—"}</td>
                      <td style={{ padding: "9px 10px", color: C.textSub, fontFamily: T.mono }}>{b.deliveryFee > 0 ? `$${b.deliveryFee.toFixed(2)}` : "—"}</td>
                      <td style={{ padding: "9px 10px", color: b.discount > 0 ? C.danger : C.textMuted, fontFamily: T.mono }}>{b.discount > 0 ? `-${b.discount}%` : "—"}</td>
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: C.text, fontFamily: T.mono }}>${b.totalCost.toFixed(2)}</td>
                      <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                        {!isDone && (
                          <Btn small variant="primary" onClick={() => requestMarkDone(b)} style={{ marginRight: 4 }}>✓ Done</Btn>
                        )}
                        {!isDone && <Btn small variant="ghost" onClick={() => startEditBooking(b)}>Edit</Btn>}
                        <Btn small variant="ghost" onClick={() => requestRemoveBooking(b)} style={{ color: C.danger }}>Remove</Btn>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 14, padding: "12px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 3, display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { l: filtersActive ? "Filtered" : "Bookings", v: filtered.length },
              ...itemDefs.map((it) => ({ l: it.name, v: filtered.reduce((s, b) => s + (b.items?.[it.id] || 0), 0) })),
              { l: "Pickup", v: filtered.filter((b) => b.serviceType === "pickup").length },
              { l: "Delivery", v: filtered.filter((b) => b.serviceType === "delivery").length },
            ].map((s) => (
              <div key={s.l}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: T.mono }}>{s.v}</div>
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: T.sans, letterSpacing: "0.06em", textTransform: "uppercase" }}>{s.l}</div>
              </div>
            ))}
            <div style={{ marginLeft: "auto" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.text, fontFamily: T.mono }}>${totalRev.toFixed(2)}</div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: T.sans, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {filtersActive ? "Filtered Revenue" : "Total Revenue"}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Mark Done Dialog ────────────────────────────────────────────────────────
function MarkDoneDialog({ open, booking, onConfirm, onCancel }) {
  const [amount, setAmount] = useState("");
  const [collectedBy, setCollectedBy] = useState("rodri");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open && booking) {
      setAmount(booking.totalCost.toFixed(2));
      setCollectedBy("rodri");
      setErr("");
    }
  }, [open, booking]);

  if (!open || !booking) return null;

  function submit() {
    const a = parseFloat(amount);
    if (isNaN(a) || a < 0) { setErr("Enter a valid amount."); return; }
    onConfirm({ amount: a, collectedBy });
  }

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "20px 22px", maxWidth: 420, width: "100%", fontFamily: T.sans,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.accentDeep, marginBottom: 4 }}>
          Mark Booking Done
        </div>
        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 16 }}>
          {booking.name} — {fmtDateShort(booking.startDate)} to {fmtDateShort(booking.endDate)}
        </div>

        <Field label="Amount Collected ($)">
          <input type="number" min="0" step="0.01" style={inp(false)}
            value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>

        <Field label="Collected By">
          <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
            {[
              { id: "chetos", label: "Chetos" },
              { id: "rodri", label: "Rodri" },
            ].map((p) => (
              <button key={p.id} type="button" onClick={() => setCollectedBy(p.id)}
                style={{
                  flex: 1, padding: "10px", border: "none", cursor: "pointer",
                  fontFamily: T.sans, fontSize: 13, fontWeight: 600,
                  background: collectedBy === p.id ? C.accent : C.surface,
                  color: collectedBy === p.id ? "#fff" : C.textSub,
                  transition: "all 0.15s",
                }}>
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        {err && <div style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
          <Btn onClick={submit} variant="primary">Mark Done</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Add Expense Dialog ──────────────────────────────────────────────────────
function AddExpenseDialog({ open, onConfirm, onCancel }) {
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("rodri");
  const [concept, setConcept] = useState("");
  const [isInvestment, setIsInvestment] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setAmount(""); setPaidBy("rodri"); setConcept("");
      setIsInvestment(false); setErr("");
    }
  }, [open]);

  if (!open) return null;

  function submit() {
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) { setErr("Enter an amount greater than zero."); return; }
    onConfirm({ amount: a, paidBy, concept: concept.trim(), isInvestment });
  }

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "20px 22px", maxWidth: 420, width: "100%", fontFamily: T.sans,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.accentDeep, marginBottom: 12 }}>
          Add Expense
        </div>

        <Field label="Amount ($)">
          <input type="number" min="0" step="0.01" placeholder="0.00" style={inp(false)}
            value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>

        <Field label="Paid By">
          <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
            {[
              { id: "chetos", label: "Chetos" },
              { id: "rodri", label: "Rodri" },
            ].map((p) => (
              <button key={p.id} type="button" onClick={() => setPaidBy(p.id)}
                style={{
                  flex: 1, padding: "10px", border: "none", cursor: "pointer",
                  fontFamily: T.sans, fontSize: 13, fontWeight: 600,
                  background: paidBy === p.id ? C.accent : C.surface,
                  color: paidBy === p.id ? "#fff" : C.textSub,
                  transition: "all 0.15s",
                }}>
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Concept (optional)" hint="e.g. gas, new chairs, repairs">
          <input type="text" placeholder="What was this for?" style={inp(false)}
            value={concept} onChange={(e) => setConcept(e.target.value)} />
        </Field>

        <div onClick={() => setIsInvestment(!isInvestment)}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px",
            background: isInvestment ? C.sunshineSoft : C.bg,
            border: `1px solid ${isInvestment ? C.sunshine : C.border}`,
            borderRadius: 3, cursor: "pointer", marginBottom: 14,
          }}>
          <div style={{
            width: 18, height: 18, borderRadius: 3,
            border: `2px solid ${isInvestment ? C.accent : C.borderStrong}`,
            background: isInvestment ? C.accent : C.surface,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>
            {isInvestment ? "✓" : ""}
          </div>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.3 }}>
            <div style={{ fontWeight: 600 }}>Add to investment</div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>
              Equipment, supplies, anything that grows the business.
            </div>
          </div>
        </div>

        {err && <div style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
          <Btn onClick={submit} variant="primary">Save Expense</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Settlement Dialog ────────────────────────────────────────────────────────
function SettlementDialog({
  open,
  chetosCollected, chetosExpensesAmt, chetosNet,
  rodriCollected, rodriExpensesAmt, rodriNet,
  onConfirm, onCancel,
}) {
  if (!open) return null;
  const diff = chetosNet - rodriNet;
  const owesAmount = Math.abs(diff) / 2;
  const whoPays =
    Math.abs(diff) < 0.005 ? "Already even"
    : diff > 0 ? "Chetos pays Rodri"
    : "Rodri pays Chetos";

  const Row = ({ label, chetos, rodri, isNet }) => (
    <div style={{ display: "flex", fontSize: 12, padding: "6px 0", borderTop: isNet ? `1px solid ${C.borderStrong}` : "none", marginTop: isNet ? 6 : 0 }}>
      <span style={{ flex: 1, color: isNet ? C.text : C.textSub, fontWeight: isNet ? 700 : 400 }}>{label}</span>
      <span style={{ width: 80, textAlign: "right", fontFamily: T.mono, color: isNet ? C.text : C.textSub, fontWeight: isNet ? 700 : 400 }}>${chetos.toFixed(2)}</span>
      <span style={{ width: 80, textAlign: "right", fontFamily: T.mono, color: isNet ? C.text : C.textSub, fontWeight: isNet ? 700 : 400 }}>${rodri.toFixed(2)}</span>
    </div>
  );

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "20px 22px", maxWidth: 460, width: "100%", fontFamily: T.sans,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.accentDeep, marginBottom: 12 }}>
          Settle Up?
        </div>

        <div style={{ background: C.accentSoft, borderRadius: 3, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ display: "flex", fontSize: 10, color: C.textMuted, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ flex: 1 }}>&nbsp;</span>
            <span style={{ width: 80, textAlign: "right" }}>Chetos</span>
            <span style={{ width: 80, textAlign: "right" }}>Rodri</span>
          </div>
          <Row label="Collected" chetos={chetosCollected} rodri={rodriCollected} />
          <Row label="Expenses (−)" chetos={chetosExpensesAmt} rodri={rodriExpensesAmt} />
          <Row label="Net" chetos={chetosNet} rodri={rodriNet} isNet />
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 3, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.textSub, marginBottom: 4 }}>{whoPays}</div>
          <div style={{ fontSize: 26, fontFamily: T.mono, fontWeight: 800, color: C.accentDeep }}>
            ${owesAmount.toFixed(2)}
          </div>
        </div>

        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 16, lineHeight: 1.5 }}>
          After settling, both balances and expense totals reset. The General account stays.
          A full record is saved in Settlement History.
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
          <Btn onClick={onConfirm} variant="primary">Confirm & Reset</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Vacations Panel (NEW) ────────────────────────────────────────────────────
function VacationsPanel({ isMobile, vacations, onAdd, onDelete }) {
  const inputStyle = inp(isMobile);
  const [open, setOpen] = useState(false);
  const [repName, setRepName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const todayDs = new Date().toISOString().split("T")[0];

  const sorted = useMemo(() => {
    const list = [...vacations];
    list.sort((a, b) => {
      const aPast = a.endDate < todayDs;
      const bPast = b.endDate < todayDs;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return a.startDate.localeCompare(b.startDate);
    });
    return list;
  }, [vacations, todayDs]);

  function reset() {
    setRepName(""); setStartDate(""); setEndDate(""); setNote(""); setErr("");
  }
  function submit() {
    const name = repName.trim();
    if (!name) { setErr("Rep name required."); return; }
    if (!startDate || !endDate) { setErr("Both dates required."); return; }
    if (startDate > endDate) { setErr("End must be on or after start."); return; }
    onAdd({ repName: name, startDate, endDate, note: note.trim() });
    reset();
    setOpen(false);
  }

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
      padding: isMobile ? "14px 14px" : "16px 18px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: T.sans, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          🌴 Sales Rep Vacations
        </div>
        <Btn small variant={open ? "ghost" : "default"} onClick={() => { setOpen(!open); if (open) reset(); }}>
          {open ? "Cancel" : "+ Add"}
        </Btn>
      </div>

      {open && (
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, padding: 12, marginBottom: 12 }}>
          <Field label="Rep Name">
            <input style={inputStyle} placeholder="Type any name" value={repName} onChange={(e) => setRepName(e.target.value)} />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button type="button" onClick={() => setRepName("Chetos")}
                style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${C.border}`, background: repName === "Chetos" ? C.accentSoft : C.surface, color: C.textSub, borderRadius: 3, cursor: "pointer", fontFamily: T.sans }}>
                Chetos
              </button>
              <button type="button" onClick={() => setRepName("Rodri")}
                style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${C.border}`, background: repName === "Rodri" ? C.accentSoft : C.surface, color: C.textSub, borderRadius: 3, cursor: "pointer", fontFamily: T.sans }}>
                Rodri
              </button>
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <Field label="Start">
              <input type="date" style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="End">
              <input type="date" style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Note (optional)">
            <input style={inputStyle} placeholder="e.g. Family trip — Rodri covering" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {err && <div style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn onClick={() => { reset(); setOpen(false); }} variant="ghost">Cancel</Btn>
            <Btn onClick={submit} variant="primary">Save Vacation</Btn>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans, padding: "8px 0" }}>
          No vacations on the books. Add one to flag coverage needs on the calendar.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((v) => {
            const isPast = v.endDate < todayDs;
            const isActive = v.startDate <= todayDs && v.endDate >= todayDs;
            return (
              <div key={v.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 3,
                background: isActive ? C.sunshineSoft : C.bg,
                border: `1px solid ${isActive ? C.sunshine : C.border}`,
                opacity: isPast ? 0.55 : 1,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: T.sans }}>
                    {v.repName}
                    {isActive && <span style={{ fontSize: 10, marginLeft: 8, padding: "1px 6px", background: C.sunshine, color: C.accentDeep, borderRadius: 2, fontWeight: 700 }}>OUT NOW</span>}
                    {isPast && <span style={{ fontSize: 10, marginLeft: 8, color: C.textMuted }}>(past)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.textSub, fontFamily: T.sans, marginTop: 1 }}>
                    {fmtDateShort(v.startDate)} – {fmtDateShort(v.endDate)}
                    {v.note && <span style={{ color: C.textMuted }}> · {v.note}</span>}
                  </div>
                </div>
                <Btn small variant="ghost" onClick={() => onDelete(v)}>✕</Btn>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Backup Panel (NEW) ───────────────────────────────────────────────────────
function BackupPanel({ isMobile, onBackup, lastBackupAt }) {
  const days = lastBackupAt
    ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000)
    : null;
  const stale = days === null || days >= 7;
  return (
    <div style={{
      background: stale ? C.sunshineSoft : C.surface,
      border: `1px solid ${stale ? C.sunshine : C.border}`,
      borderRadius: 4, padding: isMobile ? "14px" : "16px 18px",
      marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: T.sans, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            💾 Weekly Backup
          </div>
          <div style={{ fontSize: 12, color: C.textSub, fontFamily: T.sans, marginTop: 4 }}>
            {lastBackupAt
              ? <>Last backup: <strong>{fmtDate(lastBackupAt.split("T")[0])}</strong>{days != null && <> ({days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`})</>}</>
              : "No backup yet. Export now to start the weekly cycle."}
          </div>
          {stale && (
            <div style={{ fontSize: 11, color: C.warning, fontFamily: T.sans, marginTop: 6, fontWeight: 600 }}>
              ⚠ It's been 7+ days — time to back up.
            </div>
          )}
        </div>
        <Btn variant="primary" onClick={onBackup}>Export Full Backup</Btn>
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginTop: 10, lineHeight: 1.5 }}>
        Downloads a single CSV with all bookings, vacations, payments, expenses, and settlements.
        Keep these files in a safe place (Google Drive, Dropbox, email to yourself).
      </div>
    </div>
  );
}

// ─── Accounts View ────────────────────────────────────────────────────────────
function AccountsView({
  isMobile,
  settings,
  payments,
  settlements,
  expenses,
  generalBalance,
  totalCollected,
  totalExpenses,
  chetosCollected,
  chetosExpensesAmt,
  chetosNet,
  rodriCollected,
  rodriExpensesAmt,
  rodriNet,
  projectedRevenue,
  onSettle,
  onAddExpense,
  onDeleteExpense,
  onUpdateInvestment,
  settingsPanelProps,
  vacations,
  onAddVacation,
  onDeleteVacation,
  onBackup,
  lastBackupAt,
}) {
  const [editingInv, setEditingInv] = useState(false);
  const [invDraft, setInvDraft] = useState("");

  const investment = settings.investment || 0;
  const roiX = investment > 0 ? generalBalance / investment : 0;
  const roiPct = investment > 0 ? ((generalBalance - investment) / investment) * 100 : 0;
  const projectedGeneral = generalBalance + projectedRevenue;
  const projRoiX = investment > 0 ? projectedGeneral / investment : 0;
  const projRoiPct = investment > 0 ? ((projectedGeneral - investment) / investment) * 100 : 0;
  const hasProjection = projectedRevenue > 0;

  function startEdit() { setInvDraft(String(investment)); setEditingInv(true); }
  function saveInv() {
    const v = parseFloat(invDraft);
    if (isNaN(v) || v < 0) return;
    onUpdateInvestment(v);
    setEditingInv(false);
  }

  const card = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    padding: isMobile ? "14px 16px" : "18px 20px",
  };

  const canSettle = Math.abs(chetosNet) > 0.005 || Math.abs(rodriNet) > 0.005;

  return (
    <div style={{ padding: isMobile ? "14px" : "20px 24px" }}>
      {/* Top row: General + Investment + ROI */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        gap: 12, marginBottom: 14,
      }}>
        {/* General Account */}
        <div style={{ ...card, background: C.accentDeep, color: "#fff", border: `1px solid ${C.accentDeep}` }}>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: C.sunshine, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
            General Account
          </div>
          <div style={{ fontSize: isMobile ? 28 : 36, fontWeight: 800, fontFamily: T.mono, lineHeight: 1.1 }}>
            ${generalBalance.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 8, fontFamily: T.sans, lineHeight: 1.6 }}>
            Starting: <span style={{ fontFamily: T.mono }}>${(settings.startingGeneral || 0).toFixed(2)}</span>
            <span style={{ margin: "0 8px" }}>·</span>
            Collected: <span style={{ fontFamily: T.mono }}>${totalCollected.toFixed(2)}</span>
          </div>
        </div>

        {/* Investment + ROI */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>
              Investment
            </div>
            {!editingInv && (
              <Btn small variant="ghost" onClick={startEdit}>Edit</Btn>
            )}
          </div>
          {editingInv ? (
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input type="number" style={{ ...inp(false), maxWidth: 140 }} value={invDraft} autoFocus
                onChange={(e) => setInvDraft(e.target.value)} />
              <Btn small variant="primary" onClick={saveInv}>Save</Btn>
              <Btn small variant="ghost" onClick={() => setEditingInv(false)}>Cancel</Btn>
            </div>
          ) : (
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 700, fontFamily: T.mono, color: C.text, marginBottom: 12 }}>
              ${investment.toFixed(2)}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: 8, marginBottom: 6 }}>
              <span />
              <div style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                Actual
              </div>
              <div style={{ fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                Projected
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                Return
              </div>
              <div style={{ fontSize: 18, fontFamily: T.mono, fontWeight: 700, color: roiX >= 1 ? C.accent : C.textSub }}>
                {investment > 0 ? `${roiX.toFixed(2)}x` : "—"}
              </div>
              <div style={{ fontSize: 18, fontFamily: T.mono, fontWeight: 700, color: hasProjection && projRoiX >= 1 ? C.warning : C.textMuted }}>
                {investment > 0 && hasProjection ? `${projRoiX.toFixed(2)}x` : "—"}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: 8, alignItems: "baseline" }}>
              <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                Margin
              </div>
              <div style={{ fontSize: 18, fontFamily: T.mono, fontWeight: 700, color: roiPct >= 0 ? C.accent : C.danger }}>
                {investment > 0 ? `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(0)}%` : "—"}
              </div>
              <div style={{ fontSize: 18, fontFamily: T.mono, fontWeight: 700, color: hasProjection ? (projRoiPct >= 0 ? C.warning : C.danger) : C.textMuted }}>
                {investment > 0 && hasProjection ? `${projRoiPct >= 0 ? "+" : ""}${projRoiPct.toFixed(0)}%` : "—"}
              </div>
            </div>

            {hasProjection && (
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 8, fontFamily: T.sans, lineHeight: 1.4 }}>
                Projected adds <span style={{ fontFamily: T.mono, color: C.text, fontWeight: 600 }}>${projectedRevenue.toFixed(2)}</span> from active bookings.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Personal balances */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        gap: 12, marginBottom: 14,
      }}>
        {[
          { name: "Chetos", collected: chetosCollected, expensesAmt: chetosExpensesAmt, net: chetosNet, starting: settings.startingChetos || 0 },
          { name: "Rodri", collected: rodriCollected, expensesAmt: rodriExpensesAmt, net: rodriNet, starting: settings.startingRodri || 0 },
        ].map((p) => (
          <div key={p.name} style={card}>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", color: C.textMuted, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
              {p.name}
            </div>
            <div style={{ fontSize: isMobile ? 24 : 30, fontWeight: 800, fontFamily: T.mono, color: p.net >= 0 ? C.text : C.danger, lineHeight: 1.1 }}>
              {p.net < 0 ? "−" : ""}${Math.abs(p.net).toFixed(2)}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: C.textSub, fontFamily: T.sans }}>
              <span>Collected: <span style={{ fontFamily: T.mono, color: C.text }}>${p.collected.toFixed(2)}</span></span>
              <span>Expenses: <span style={{ fontFamily: T.mono, color: C.danger }}>−${p.expensesAmt.toFixed(2)}</span></span>
            </div>
            {p.starting !== 0 && (
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, fontFamily: T.sans }}>
                Starting: <span style={{ fontFamily: T.mono }}>${p.starting.toFixed(2)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Btn variant="default" onClick={onAddExpense}>+ Add Expense</Btn>
        <Btn variant="primary" onClick={onSettle} disabled={!canSettle}
          style={canSettle ? { background: C.sunshine, color: C.accentDeep, borderColor: C.sunshine, fontWeight: 700 } : undefined}>
          ⚖ Settle Up
        </Btn>
      </div>

      {/* Expenses list */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: C.textMuted, textTransform: "uppercase", fontWeight: 600 }}>
            Expenses (since last settle)
          </div>
          <div style={{ fontSize: 12, color: C.textSub, fontFamily: T.mono }}>
            {expenses.length} item{expenses.length !== 1 ? "s" : ""} · ${totalExpenses.toFixed(2)}
          </div>
        </div>
        {expenses.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans, padding: "10px 0" }}>
            No expenses logged yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: T.sans }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Date", "Concept", "Paid By", "Inv?", "Amount", ""].map((h) => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...expenses].reverse().map((e) => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 8px", color: C.textSub, whiteSpace: "nowrap" }}>
                    {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                  <td style={{ padding: "8px 8px", color: C.text }}>{e.concept || <span style={{ color: C.textMuted, fontStyle: "italic" }}>—</span>}</td>
                  <td style={{ padding: "8px 8px", color: C.textSub, textTransform: "capitalize" }}>{e.paidBy}</td>
                  <td style={{ padding: "8px 8px" }}>
                    {e.isInvestment && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.accentDeep, background: C.sunshine, padding: "2px 6px", borderRadius: 2, letterSpacing: "0.06em" }}>INV</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 8px", fontFamily: T.mono, color: C.danger, fontWeight: 600 }}>−${e.amount.toFixed(2)}</td>
                  <td style={{ padding: "4px 8px", whiteSpace: "nowrap", textAlign: "right" }}>
                    <Btn small variant="ghost" onClick={() => onDeleteExpense(e)} style={{ color: C.danger }}>Remove</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Settlement history */}
      <div style={card}>
        <div style={{ fontSize: 10, letterSpacing: "0.08em", color: C.textMuted, textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>
          Settlement History
        </div>
        {settlements.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans, padding: "10px 0" }}>
            No settlements yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: T.sans, minWidth: 480 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Date", "Chetos C/E", "Rodri C/E", "Settled"].map((h) => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, color: C.textMuted, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 8px", color: C.text, whiteSpace: "nowrap" }}>
                      {new Date(s.settledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td style={{ padding: "8px 8px", fontFamily: T.mono, color: C.textSub, whiteSpace: "nowrap" }}>
                      ${s.chetosAmount.toFixed(2)} / <span style={{ color: C.danger }}>${s.chetosExpenses.toFixed(2)}</span>
                    </td>
                    <td style={{ padding: "8px 8px", fontFamily: T.mono, color: C.textSub, whiteSpace: "nowrap" }}>
                      ${s.rodriAmount.toFixed(2)} / <span style={{ color: C.danger }}>${s.rodriExpenses.toFixed(2)}</span>
                    </td>
                    <td style={{ padding: "8px 8px", fontFamily: T.mono, color: C.accent, fontWeight: 700, whiteSpace: "nowrap" }}>
                      ${(Math.abs(s.difference) / 2).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6, fontFamily: T.sans }}>
              C/E = Collected / Expenses
            </div>
          </div>
        )}
      </div>

      {/* NEW: Vacations panel */}
      <div style={{ marginTop: 18 }}>
        <VacationsPanel
          isMobile={isMobile}
          vacations={vacations}
          onAdd={onAddVacation}
          onDelete={onDeleteVacation}
        />
      </div>

      {/* NEW: Backup panel */}
      <div style={{ marginTop: 4 }}>
        <BackupPanel isMobile={isMobile} onBackup={onBackup} lastBackupAt={lastBackupAt} />
      </div>

      {/* Settings */}
      <div style={{ marginTop: 18 }}>
        <SettingsPanel {...settingsPanelProps} />
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ isMobile, bookings, totalRevenue }) {
  return (
    <div style={{
      background: C.accentDeep,
      borderBottom: `3px solid ${C.sunshine}`,
      padding: isMobile ? "12px 16px" : "14px 24px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      color: "#fff",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, minWidth: 0 }}>
        <div style={{
          width: isMobile ? 34 : 40, height: isMobile ? 34 : 40,
          borderRadius: "50%", background: C.sunshine, color: C.accentDeep,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: isMobile ? 18 : 22, fontWeight: 800,
          flexShrink: 0, boxShadow: "0 1px 0 rgba(0,0,0,0.15)",
        }} aria-label="Last Man Standing logo">
          🪑
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: isMobile ? 15 : 19, fontWeight: 800, fontFamily: T.sans,
            letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1.1,
            color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            Last Man Standing
          </div>
          {!isMobile && (
            <div style={{
              fontSize: 11, color: C.sunshineSoft, fontFamily: T.sans,
              marginTop: 2, fontStyle: "italic", opacity: 0.95,
            }}>
              Because when the music stops, your chairs better be ready.
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: isMobile ? 14 : 24, alignItems: "center", flexShrink: 0 }}>
        {[
          { l: "Bookings", v: bookings.length },
          { l: "Revenue", v: `$${totalRevenue.toFixed(2)}` },
        ].map((s) => (
          <div key={s.l} style={{ textAlign: "right" }}>
            <div style={{ fontSize: isMobile ? 14 : 17, fontWeight: 800, color: C.sunshine, fontFamily: T.mono }}>{s.v}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontFamily: T.sans, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TabBar ───────────────────────────────────────────────────────────────────
function TabBar({ active, onChange, tabs, bottom }) {
  return (
    <div style={{
      display: "flex", background: C.surface,
      borderTop: bottom ? `1px solid ${C.border}` : "none",
      borderBottom: bottom ? "none" : `1px solid ${C.border}`,
      ...(bottom ? { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, paddingBottom: "env(safe-area-inset-bottom)" } : {}),
    }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          style={{ flex: 1, padding: bottom ? "10px 0 8px" : "9px 16px", border: "none", background: "none", cursor: "pointer", fontFamily: T.sans, fontSize: 12, color: active === t.id ? C.accent : C.textMuted, fontWeight: active === t.id ? 700 : 500, borderBottom: !bottom && active === t.id ? `2px solid ${C.accent}` : "2px solid transparent", transition: "all 0.15s", display: "flex", flexDirection: bottom ? "column" : "row", alignItems: "center", gap: 3 }}>
          {bottom && <span style={{ fontSize: 18 }}>{t.icon}</span>}
          <span style={{ fontSize: bottom ? 10 : 12, letterSpacing: bottom ? "0.04em" : 0, textTransform: bottom ? "uppercase" : "none" }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Backup Reminder Banner (NEW) ─────────────────────────────────────────────
// \u2500\u2500\u2500 Messages Hub (NEW) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const REMINDER_WINDOW = 3;
function RemindersView({ isMobile, bookings, itemDefs, onMarkSent }) {
  const t0 = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  const daysUntil = (b) => Math.round((new Date(b.startDate + "T00:00:00") - t0) / 86400000);
  const active = bookings.filter((b) => (b.status || "active") === "active" && daysUntil(b) >= 0);
  const toConfirm = active.filter((b) => !b.confirmSent).sort((a, z) => a.startDate.localeCompare(z.startDate));
  const toRemind = active.filter((b) => daysUntil(b) <= REMINDER_WINDOW && !b.confirmed).sort((a, z) => a.startDate.localeCompare(z.startDate));

  function itemsSummary(b) {
    return itemDefs.filter((it) => b.items && b.items[it.id]).map((it) => b.items[it.id] + "\u00d7 " + it.name).join(", ");
  }
  function dateLabel(b) {
    const days = daysBetween(b.startDate, b.endDate);
    return days > 1 ? fmtDate(b.startDate) + "\u2013" + fmtDate(b.endDate) : fmtDate(b.startDate);
  }
  function sms(b, msg) {
    const phone = (b.phone || "").replace(/[^\d+]/g, "");
    return "sms:" + phone + "?&body=" + encodeURIComponent(msg);
  }
  function confirmMsg(b) {
    const svc = b.serviceType === "delivery" ? "delivery to " + (b.address ? b.address : "your address") : "pickup";
    const total = (b.totalCost || 0).toFixed(0);
    return "Hi " + b.name + "! You're booked with Last Man Standing. " + itemsSummary(b) +
      " for " + dateLabel(b) + " (" + svc + "). Total $" + total +
      ". We'll text a reminder 2 days before. Reply here with any questions \u2014 thank you!";
  }
  function remindMsg(b) {
    return "Hi " + b.name + "! Reminder from Last Man Standing: your booking is coming up " +
      dateLabel(b) + " \u2014 " + itemsSummary(b) +
      ". Reply YES to confirm, or let us know if anything changed. Thank you!";
  }

  const card = (b, msg, field) => {
    const hasPhone = !!(b.phone && b.phone.trim());
    const d = daysUntil(b);
    return (
      <div key={field + b.id} style={{ background: C.surface, border: "1px solid " + C.border, borderLeft: "3px solid " + C.sunshine, borderRadius: 4, padding: "12px 14px", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{b.name}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: d <= 2 ? C.brick : C.textMuted, whiteSpace: "nowrap" }}>
            {d === 0 ? "Today" : d === 1 ? "Tomorrow" : "In " + d + " days"}
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.textSub, fontFamily: T.sans, marginTop: 3 }}>{dateLabel(b)}</div>
        <div style={{ fontSize: 12, color: C.textSub, fontFamily: T.sans, marginTop: 2 }}>{itemsSummary(b)}</div>
        <div style={{ fontSize: 12, color: hasPhone ? C.textSub : C.textMuted, fontFamily: T.mono, marginTop: 2 }}>{hasPhone ? b.phone : "No phone on file"}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          {hasPhone ? (
            <a href={sms(b, msg)} style={{ textDecoration: "none" }}>
              <span style={{ display: "inline-block", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: T.sans, padding: "7px 14px", borderRadius: 3 }}>Text customer</span>
            </a>
          ) : (
            <span style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans }}>Add a phone number to text</span>
          )}
          <button onClick={() => onMarkSent(b, field)} style={{ background: C.surface, color: C.textSub, border: "1px solid " + C.borderStrong, fontSize: 12, fontWeight: 600, fontFamily: T.sans, padding: "7px 12px", borderRadius: 3, cursor: "pointer" }}>Mark sent</button>
        </div>
      </div>
    );
  };

  const head = (title, count, sub) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.accentDeep, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}{count ? " (" + count + ")" : ""}</div>
      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ padding: isMobile ? "14px 16px" : "18px 24px", maxWidth: 720 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.accentDeep, marginBottom: 14 }}>Messages</div>

      {head("To confirm", toConfirm.length, "Send right after booking \u2014 restates the details back to the customer.")}
      {toConfirm.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans, marginBottom: 18 }}>All caught up.</div>}
      {toConfirm.map((b) => card(b, confirmMsg(b), "confirmSent"))}

      <div style={{ height: 18 }} />
      {head("To remind", toRemind.length, "Bookings within " + REMINDER_WINDOW + " days \u2014 confirm logistics.")}
      {toRemind.length === 0 && <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans, marginBottom: 18 }}>Nothing due.</div>}
      {toRemind.map((b) => card(b, remindMsg(b), "confirmed"))}

      <div style={{ height: 18 }} />
      <div style={{ opacity: 0.45 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Thank you / review</div>
        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans }}>Paused \u2014 needs your Google review link. We'll switch this on later.</div>
      </div>
    </div>
  );
}

function BackupReminderBanner({ isMobile, lastBackupAt, onBackup, onDismiss }) {
  const days = lastBackupAt
    ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000)
    : null;
  if (days !== null && days < 7) return null;
  return (
    <div style={{
      background: C.sunshineSoft,
      borderBottom: `1px solid ${C.sunshine}`,
      padding: isMobile ? "8px 14px" : "8px 24px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 10, fontFamily: T.sans,
    }}>
      <div style={{ fontSize: isMobile ? 11 : 12, color: C.warning, fontWeight: 600, minWidth: 0 }}>
        💾 {lastBackupAt ? `Last backup ${days} day${days === 1 ? "" : "s"} ago.` : "No backup yet."} Time to export.
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <Btn small variant="primary" onClick={onBackup}>Back up now</Btn>
        <Btn small variant="ghost" onClick={onDismiss}>Later</Btn>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const width = useWindowWidth();
  const isMobile = width < 640;

  const [bookings, setBookings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [vacations, setVacations] = useState([]);  // NEW
  const [lastBackupAt, setLastBackupAtState] = useState(() => getLastBackupAt());  // NEW
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(false);  // NEW
  const [settings, setSettings] = useState(() => {
    const s = { ...DEFAULT_SETTINGS };
    if (!s.items) s.items = DEFAULT_ITEMS;
    return s;
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [doneDialog, setDoneDialog] = useState(null);
  const [settleDialog, setSettleDialog] = useState(false);
  const [expenseDialog, setExpenseDialog] = useState(false);

  const [filterStatus, setFilterStatus] = useState("active");

  // Load all data from Supabase on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bks, stResult, pmts, stls, exps, vcs] = await Promise.all([
          fetchAllBookings(),
          fetchSettings(),
          fetchAllPayments(),
          fetchAllSettlements(),
          fetchAllExpenses(),
          fetchAllVacations(),
        ]);
        if (cancelled) return;

        // SAFETY: if settings fetch failed (network error, timeout, etc.),
        // do NOT initialize defaults — that would overwrite real data on the
        // next save. Instead, surface the error and stop. The user can refresh.
        if (!stResult.ok) {
          setLoadError(
            "Couldn't load settings from the database. " +
            "Refresh the page in a moment. Your data is safe — we just couldn't reach it right now."
          );
          return;
        }

        setBookings(bks);
        setPayments(pmts);
        setSettlements(stls);
        setExpenses(exps);
        setVacations(vcs);

        const st = stResult.data;
        if (st) {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...st,
            items: st.items?.length ? st.items : DEFAULT_ITEMS,
          });
        } else {
          // Settings row truly doesn't exist (first-time setup). Safe to create defaults.
          await saveSettingsDB(DEFAULT_SETTINGS);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message || "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [mobileTab, setMobileTab] = useState("calendar");
  const [desktopTab, setDesktopTab] = useState("calendar");
  const [calMonth, setCalMonth] = useState(0);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [settingsErr, setSettingsErr] = useState("");

  const [editingItem, setEditingItem] = useState(null);
  const [itemDraft, setItemDraft] = useState({ name: "", price: "", inventory: "" });
  const [itemErr, setItemErr] = useState("");

  const EMPTY_FORM = {
    name: "", salesRep: "", startDate: "", endDate: "",
    items: {}, serviceType: "pickup", deliveryFee: "", address: "",
    discount: "", notes: "", phone: "", email: "",
  };
  const [form, setFormRaw] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [successMsg, setSuccessMsg] = useState("");
  const [editingBookingId, setEditingBookingId] = useState(null);

  const [search, setSearch] = useState("");
  const [filterService, setFilterService] = useState("all");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");

  const [confirmState, setConfirmState] = useState(null);

  const setForm = useCallback((patch) => setFormRaw((p) => ({ ...p, ...patch })), []);

  const saveBookings = useCallback((newList, op) => {
    setBookings(newList);
    if (!op) return;
    if (op.type === "upsert" && op.booking) upsertBookingDB(op.booking);
    if (op.type === "delete" && op.id) deleteBookingDB(op.id);
  }, []);
  const saveSettings = useCallback((s) => {
    setSettings(s);
    saveSettingsDB(s);
  }, []);
  const markSent = useCallback((b, field) => {
    const updated = bookings.map((x) => (x.id === b.id ? { ...x, [field]: true } : x));
    const saved = updated.find((x) => x.id === b.id);
    saveBookings(updated, { type: "upsert", booking: saved });
  }, [bookings, saveBookings]);

  const { items: itemDefs, startDate, endDate } = settings;
  const months = useMemo(() => getMonths(startDate, endDate), [startDate, endDate]);
  const safeMonth = Math.min(calMonth, Math.max(0, months.length - 1));

  const rentalDays =
    form.startDate && form.endDate && form.startDate <= form.endDate
      ? daysBetween(form.startDate, form.endDate)
      : null;

  const getAvail = useCallback(
    (itemId) => {
      if (!form.startDate || !form.endDate || form.startDate > form.endDate) return null;
      const def = itemDefs.find((i) => i.id === itemId);
      if (!def) return null;
      return def.inventory - maxUsedInRange(bookings, form.startDate, form.endDate, itemId, editingBookingId);
    },
    [form.startDate, form.endDate, itemDefs, bookings, editingBookingId]
  );

  function validateForm() {
    const e = {};
    const f = form;
    if (!f.name.trim()) e.name = "Required";
    if (!f.salesRep.trim()) e.salesRep = "Required";
    if (!f.startDate) e.startDate = "Required";
    if (!f.endDate) e.endDate = "Required";
    if (f.startDate && f.endDate && f.startDate > f.endDate) e.endDate = "End must be after start";
    if (f.startDate && f.startDate < startDate) e.startDate = "Before allowed range";
    if (f.endDate && f.endDate > endDate) e.endDate = "After allowed range";
    const anyItem = itemDefs.some((it) => (parseInt(f.items[it.id]) || 0) > 0);
    if (!anyItem) e.items = "Select at least one item";
    itemDefs.forEach((it) => {
      const qty = parseInt(f.items[it.id]) || 0;
      if (qty > it.inventory) { e[`item_${it.id}`] = `Max ${it.inventory}`; return; }
      if (qty > 0 && f.startDate && f.endDate && f.startDate <= f.endDate) {
        const avail = getAvail(it.id);
        if (qty > avail) e[`item_${it.id}`] = `Only ${avail} available`;
      }
    });
    if (f.serviceType === "delivery" && f.deliveryFee !== "" && isNaN(f.deliveryFee)) e.deliveryFee = "Invalid";
    if (f.discount !== "" && (isNaN(f.discount) || +f.discount < 0 || +f.discount > 100)) e.discount = "0–100 only";
    return e;
  }

  function handleSubmit() {
    const e = validateForm();
    setFormErrors(e);
    if (Object.keys(e).length) return;
    const itemsMap = {};
    itemDefs.forEach((it) => { itemsMap[it.id] = parseInt(form.items[it.id]) || 0; });
    const costs = calcTotal(itemsMap, itemDefs, form.serviceType, form.deliveryFee, form.discount);
    const baseBooking = {
      name: form.name.trim(),
      salesRep: form.salesRep.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      days: daysBetween(form.startDate, form.endDate),
      items: itemsMap,
      serviceType: form.serviceType,
      address: form.serviceType === "delivery" ? form.address.trim() : "",
      notes: form.notes.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      discount: parseFloat(form.discount) || 0,
      ...costs,
    };

    let updated;
    let savedBooking;
    if (editingBookingId) {
      savedBooking = { ...bookings.find((b) => b.id === editingBookingId), ...baseBooking };
      updated = bookings.map((b) => (b.id === editingBookingId ? savedBooking : b));
      setSuccessMsg("Booking updated.");
    } else {
      savedBooking = { id: genId(), ...baseBooking };
      updated = [...bookings, savedBooking];
      setSuccessMsg("Booking saved.");
    }
    updated.sort((a, b) => a.startDate.localeCompare(b.startDate));
    saveBookings(updated, { type: "upsert", booking: savedBooking });
    setFormRaw(EMPTY_FORM);
    setFormErrors({});
    setEditingBookingId(null);
    setTimeout(() => setSuccessMsg(""), 3000);
    if (isMobile) setMobileTab("list");
  }

  function startEditBooking(b) {
    const itemsForm = {};
    Object.entries(b.items || {}).forEach(([k, v]) => { if (v) itemsForm[k] = String(v); });
    setFormRaw({
      name: b.name,
      salesRep: b.salesRep,
      startDate: b.startDate,
      endDate: b.endDate,
      items: itemsForm,
      serviceType: b.serviceType,
      deliveryFee: b.deliveryFee ? String(b.deliveryFee) : "",
      address: b.address || "",
      discount: b.discount ? String(b.discount) : "",
      notes: b.notes || "",
      phone: b.phone || "",
      email: b.email || "",
    });
    setFormErrors({});
    setEditingBookingId(b.id);
    if (isMobile) setMobileTab("form");
  }

  function cancelEdit() {
    setFormRaw(EMPTY_FORM);
    setFormErrors({});
    setEditingBookingId(null);
  }

  function requestRemoveBooking(b) {
    setConfirmState({
      title: "Remove booking?",
      message: `Remove the booking for ${b.name} (${fmtDateShort(b.startDate)} – ${fmtDateShort(b.endDate)})? This can't be undone.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: () => {
        if (editingBookingId === b.id) cancelEdit();
        saveBookings(bookings.filter((x) => x.id !== b.id), { type: "delete", id: b.id });
        setConfirmState(null);
      },
    });
  }

  function exportCSV() {
    const s = search.trim().toLowerCase();
    const filtered = bookings.filter((b) => {
      if (s) {
        const hay = `${b.name} ${b.salesRep} ${b.notes || ""} ${b.address || ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (filterService !== "all" && b.serviceType !== filterService) return false;
      if (filterStart && b.endDate < filterStart) return false;
      if (filterEnd && b.startDate > filterEnd) return false;
      return true;
    });
    if (!filtered.length) return;
    const csv = bookingsToCSV(filtered, itemDefs);
    const stamp = new Date().toISOString().split("T")[0];
    downloadCSV(csv, `bookings-${stamp}.csv`);
  }

  // NEW: Vacation handlers
  function addVacation({ repName, startDate: s, endDate: e, note }) {
    const v = { id: genId(), repName, startDate: s, endDate: e, note: note || "" };
    setVacations((list) => [...list, v]);
    upsertVacationDB(v);
  }
  function requestDeleteVacation(v) {
    setConfirmState({
      title: "Delete vacation?",
      message: `Remove ${v.repName}'s vacation (${fmtDateShort(v.startDate)} – ${fmtDateShort(v.endDate)})?`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        setVacations((list) => list.filter((x) => x.id !== v.id));
        deleteVacationDB(v.id);
        setConfirmState(null);
      },
    });
  }

  // NEW: Full backup
  function runFullBackup() {
    const csv = buildBackupCSV({
      bookings, vacations, payments, settlements, expenses, itemDefs, settings,
    });
    const stamp = new Date().toISOString().split("T")[0];
    downloadCSV(csv, `lms-backup-${stamp}.csv`);
    const nowIso = new Date().toISOString();
    setLastBackupAt(nowIso);
    setLastBackupAtState(nowIso);
  }

  function requestMarkDone(b) { setDoneDialog(b); }
  async function confirmMarkDone({ amount, collectedBy }) {
    const b = doneDialog;
    if (!b) return;
    const payment = {
      id: genId(),
      bookingId: b.id,
      amount,
      collectedBy,
      collectedAt: new Date().toISOString(),
      note: "",
    };
    setPayments((p) => [...p, payment]);
    setBookings((bs) => bs.map((x) => (x.id === b.id ? { ...x, status: "done" } : x)));
    setDoneDialog(null);
    await Promise.all([addPaymentDB(payment), setBookingStatusDB(b.id, "done")]);
  }

  function requestAddExpense() { setExpenseDialog(true); }
  async function confirmAddExpense({ amount, paidBy, concept, isInvestment }) {
    const expense = {
      id: genId(),
      amount, paidBy, concept, isInvestment,
      createdAt: new Date().toISOString(),
    };
    setExpenses((xs) => [...xs, expense]);
    setExpenseDialog(false);
    const writes = [addExpenseDB(expense)];
    if (isInvestment) {
      const newSettings = { ...settings, investment: (settings.investment || 0) + amount };
      setSettings(newSettings);
      writes.push(saveSettingsDB(newSettings));
    }
    await Promise.all(writes);
  }

  function requestDeleteExpense(e) {
    setConfirmState({
      title: "Remove expense?",
      message: `Remove this expense${e.concept ? ` ("${e.concept}")` : ""}? ${e.isInvestment ? "Investment will not be reduced — edit it manually if needed." : ""}`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: () => {
        setExpenses((xs) => xs.filter((x) => x.id !== e.id));
        deleteExpenseDB(e.id);
        setConfirmState(null);
      },
    });
  }

  async function confirmSettle() {
    const settlement = {
      id: genId(),
      settledAt: new Date().toISOString(),
      chetosAmount: chetosCollected,
      rodriAmount: rodriCollected,
      chetosExpenses: chetosExpensesAmt,
      rodriExpenses: rodriExpensesAmt,
      difference: chetosNet - rodriNet,
      note: "",
    };
    const newSettings = { ...settings, startingChetos: 0, startingRodri: 0 };
    setSettings(newSettings);
    setSettlements((s) => [settlement, ...s]);
    setSettleDialog(false);
    await Promise.all([addSettlementDB(settlement), saveSettingsDB(newSettings)]);
  }

  function updateInvestment(amount) {
    const newSettings = { ...settings, investment: amount };
    saveSettings(newSettings);
  }

  const formItemsMap = {};
  itemDefs.forEach((it) => { formItemsMap[it.id] = parseInt(form.items[it.id]) || 0; });
  const anyItem = itemDefs.some((it) => formItemsMap[it.id] > 0);
  const preview = anyItem
    ? calcTotal(formItemsMap, itemDefs, form.serviceType, form.deliveryFee, form.discount)
    : null;
  const totalRevenue = bookings.reduce((s, b) => s + b.totalCost, 0);

  // Account balances
  const lastSettlementAt = settlements.length > 0 ? settlements[0].settledAt : null;
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);
  const expensesSinceSettle = lastSettlementAt
    ? expenses.filter((e) => e.createdAt > lastSettlementAt)
    : expenses;
  const totalExpenses = expensesSinceSettle.reduce((s, e) => s + e.amount, 0);
  const generalBalance = (settings.startingGeneral || 0) + totalCollected;
  const paymentsSinceSettle = lastSettlementAt
    ? payments.filter((p) => p.collectedAt > lastSettlementAt)
    : payments;

  const chetosCollected = paymentsSinceSettle
    .filter((p) => p.collectedBy === "chetos")
    .reduce((s, p) => s + p.amount, 0);
  const rodriCollected = paymentsSinceSettle
    .filter((p) => p.collectedBy === "rodri")
    .reduce((s, p) => s + p.amount, 0);
  const chetosExpensesAmt = expensesSinceSettle
    .filter((e) => e.paidBy === "chetos")
    .reduce((s, e) => s + e.amount, 0);
  const rodriExpensesAmt = expensesSinceSettle
    .filter((e) => e.paidBy === "rodri")
    .reduce((s, e) => s + e.amount, 0);

  const chetosNet = (settings.startingChetos || 0) + chetosCollected - chetosExpensesAmt;
  const rodriNet = (settings.startingRodri || 0) + rodriCollected - rodriExpensesAmt;

  // Projected revenue from active bookings (preserved from your version)
  const projectedRevenue = bookings
    .filter((b) => (b.status || "active") === "active")
    .reduce((s, b) => s + b.totalCost, 0);

  const dayStrain = useCallback((ds) => {
    let max = 0;
    itemDefs.forEach((it) => {
      const used = usedOnDate(bookings, ds, it.id);
      if (it.inventory > 0) max = Math.max(max, used / it.inventory);
    });
    return max;
  }, [bookings, itemDefs]);
  function strainBg(pct) {
    if (pct === 0) return C.surface;
    if (pct < 0.5) return C.cap50;
    if (pct < 1) return C.cap80;
    return C.cap100;
  }

  const settingsPanelProps = {
    isMobile, settings, settingsOpen, setSettingsOpen,
    settingsDraft, setSettingsDraft, settingsErr, setSettingsErr,
    editingItem, setEditingItem, itemDraft, setItemDraft, itemErr, setItemErr,
    saveSettings, setCalMonth,
  };
  const remindersProps = { isMobile, bookings, itemDefs, onMarkSent: markSent };
  const _today0 = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  const pendingReminders = bookings.filter((b) => {
    if ((b.status || "active") !== "active") return false;
    const d = Math.round((new Date(b.startDate + "T00:00:00") - _today0) / 86400000);
    if (d < 0) return false;
    return !b.confirmSent || (d <= 3 && !b.confirmed);
  }).length;
  const bookingFormProps = {
    isMobile, itemDefs, startDate, endDate, bookings,
    form, setForm, formErrors, successMsg,
    editingBookingId, cancelEdit, handleSubmit,
    rentalDays, getAvail, preview, formItemsMap,
  };
  const calendarProps = {
    isMobile, months, safeMonth, setCalMonth,
    startDate, endDate, bookings, itemDefs, dayStrain, strainBg,
    vacations,  // NEW
  };
  const listProps = {
    isMobile, bookings, itemDefs,
    search, setSearch, filterService, setFilterService,
    filterStart, setFilterStart, filterEnd, setFilterEnd,
    filterStatus, setFilterStatus,
    startEditBooking, requestRemoveBooking, exportCSV,
    requestMarkDone,
  };

  const accountsProps = {
    isMobile, settings, payments, settlements, expenses,
    generalBalance, totalCollected, totalExpenses,
    chetosCollected, chetosExpensesAmt, chetosNet,
    rodriCollected, rodriExpensesAmt, rodriNet,
    projectedRevenue,
    onSettle: () => setSettleDialog(true),
    onAddExpense: requestAddExpense,
    onDeleteExpense: requestDeleteExpense,
    onUpdateInvestment: updateInvestment,
    settingsPanelProps,
    // NEW:
    vacations,
    onAddVacation: addVacation,
    onDeleteVacation: requestDeleteVacation,
    onBackup: runFullBackup,
    lastBackupAt,
  };

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: C.bg, color: C.textSub,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: T.sans, fontSize: 14,
      }}>
        Loading bookings…
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{
        minHeight: "100vh", background: C.bg, color: C.text,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: T.sans, padding: 24, textAlign: "center",
      }}>
        <div>
          <div style={{ color: C.danger, fontWeight: 700, marginBottom: 8 }}>
            Couldn't load data
          </div>
          <div style={{ fontSize: 13, color: C.textSub }}>{loadError}</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 12 }}>
            Check your internet connection and refresh.
          </div>
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, paddingBottom: 64 }}>
        <Header isMobile={isMobile} bookings={bookings} totalRevenue={totalRevenue} />
        {!backupBannerDismissed && (
          <BackupReminderBanner
            isMobile={isMobile}
            lastBackupAt={lastBackupAt}
            onBackup={runFullBackup}
            onDismiss={() => setBackupBannerDismissed(true)}
          />
        )}
        {mobileTab === "calendar" && <CalendarView {...calendarProps} />}
        {mobileTab === "list" && <BookingsList {...listProps} />}
        {mobileTab === "reminders" && <RemindersView {...remindersProps} />}
        {mobileTab === "accounts" && <AccountsView {...accountsProps} />}
        {mobileTab === "form" && <BookingForm {...bookingFormProps} />}
        <TabBar bottom active={mobileTab} onChange={setMobileTab}
          tabs={[
            { id: "calendar", label: "Cal", icon: "▦" },
            { id: "list", label: "Bookings", icon: "≡" },
            { id: "reminders", label: pendingReminders ? "Msgs " + pendingReminders : "Msgs", icon: "💬" },
            { id: "accounts", label: "$", icon: "$" },
            { id: "form", label: editingBookingId ? "Edit" : "New", icon: editingBookingId ? "✎" : "+" },
          ]} />
        <ConfirmDialog
          open={!!confirmState}
          title={confirmState?.title}
          message={confirmState?.message}
          confirmLabel={confirmState?.confirmLabel}
          danger={confirmState?.danger}
          onConfirm={confirmState?.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
        <MarkDoneDialog
          open={!!doneDialog}
          booking={doneDialog}
          onConfirm={confirmMarkDone}
          onCancel={() => setDoneDialog(null)}
        />
        <SettlementDialog
          open={settleDialog}
          chetosCollected={chetosCollected}
          chetosExpensesAmt={chetosExpensesAmt}
          chetosNet={chetosNet}
          rodriCollected={rodriCollected}
          rodriExpensesAmt={rodriExpensesAmt}
          rodriNet={rodriNet}
          onConfirm={confirmSettle}
          onCancel={() => setSettleDialog(false)}
        />
        <AddExpenseDialog
          open={expenseDialog}
          onConfirm={confirmAddExpense}
          onCancel={() => setExpenseDialog(false)}
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column" }}>
      <Header isMobile={isMobile} bookings={bookings} totalRevenue={totalRevenue} />
      {!backupBannerDismissed && (
        <BackupReminderBanner
          isMobile={isMobile}
          lastBackupAt={lastBackupAt}
          onBackup={runFullBackup}
          onDismiss={() => setBackupBannerDismissed(true)}
        />
      )}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ width: 340, minWidth: 300, background: C.bg, borderRight: `1px solid ${C.border}`, overflowY: "auto" }}>
          <BookingForm {...bookingFormProps} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.surface }}>
          <TabBar active={desktopTab} onChange={setDesktopTab}
            tabs={[
              { id: "calendar", label: "Calendar" },
              { id: "list", label: "Bookings" },
              { id: "reminders", label: pendingReminders ? "Messages (" + pendingReminders + ")" : "Messages" },
              { id: "accounts", label: "Accounts" },
            ]} />
          <div style={{ flex: 1, overflowY: "auto" }}>
            {desktopTab === "calendar" && <CalendarView {...calendarProps} />}
            {desktopTab === "list" && <BookingsList {...listProps} />}
            {desktopTab === "reminders" && <RemindersView {...remindersProps} />}
            {desktopTab === "accounts" && <AccountsView {...accountsProps} />}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        danger={confirmState?.danger}
        onConfirm={confirmState?.onConfirm}
        onCancel={() => setConfirmState(null)}
      />
      <MarkDoneDialog
        open={!!doneDialog}
        booking={doneDialog}
        onConfirm={confirmMarkDone}
        onCancel={() => setDoneDialog(null)}
      />
      <SettlementDialog
        open={settleDialog}
        chetosCollected={chetosCollected}
        chetosExpensesAmt={chetosExpensesAmt}
        chetosNet={chetosNet}
        rodriCollected={rodriCollected}
        rodriExpensesAmt={rodriExpensesAmt}
        rodriNet={rodriNet}
        onConfirm={confirmSettle}
        onCancel={() => setSettleDialog(false)}
      />
      <AddExpenseDialog
        open={expenseDialog}
        onConfirm={confirmAddExpense}
        onCancel={() => setExpenseDialog(false)}
      />
    </div>
  );
}
