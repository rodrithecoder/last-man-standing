import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
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

const UNCATEGORIZED = "Other";
// Seed list only. The live list lives in settings.categories and is edited in Settings.
const DEFAULT_CATEGORIES = ["Furniture", "Decoration", "Backdrop", "Cake Towers"];

// An explicit [] means the user cleared the list and we respect that; a missing
// key means these settings predate categories, so fall back to the seed list.
function settingsCategories(settings) {
  return Array.isArray(settings && settings.categories) ? settings.categories : DEFAULT_CATEGORIES;
}

const DEFAULT_ITEMS = [
  { id: "chairs", name: "Chairs", price: 3, inventory: 80, category: "Furniture" },
  { id: "tables_6ft", name: "6ft Tables", price: 15, inventory: 6, category: "Furniture" },
  { id: "coolers", name: "Coolers", price: 20, inventory: 2, category: "Furniture" },
];

// An item with no category is shown under "Other" rather than a blank heading.
function itemCategory(it) {
  const c = (it && it.category ? String(it.category) : "").trim();
  return c || UNCATEGORIZED;
}
// Every category in use, plus the suggestions, for the picker. "Other" last.
function allCategories(itemDefs, cats) {
  const seen = new Map();
  // Managed list first, in the order the user arranged it; then anything still
  // attached to an item but no longer on the list, so nothing silently vanishes.
  [...(cats || []), ...(itemDefs || []).map(itemCategory)].forEach((c) => {
    const k = String(c).toLowerCase();
    if (c !== UNCATEGORIZED && !seen.has(k)) seen.set(k, c);
  });
  return [...seen.values()];
}
// Typing "backdrop" when "Backdrop" exists should not create a second category.
function snapCategory(raw, itemDefs, cats) {
  const c = String(raw || "").trim();
  if (!c) return "";
  const match = allCategories(itemDefs, cats).find((x) => x.toLowerCase() === c.toLowerCase());
  return match || c;
}
// Items grouped for display, in category order, each group keeping item order.
function groupByCategory(itemDefs, cats) {
  const groups = new Map();
  (itemDefs || []).forEach((it) => {
    const c = itemCategory(it);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(it);
  });
  // Display order follows the user's category list; categories not on the list
  // come after it alphabetically, and "Other" always sits last.
  const order = (cats || []).map((c) => String(c).toLowerCase());
  const rank = (name) => {
    if (name === UNCATEGORIZED) return [2, ""];
    const i = order.indexOf(String(name).toLowerCase());
    return i === -1 ? [1, String(name).toLowerCase()] : [0, String(i).padStart(4, "0")];
  };
  return [...groups.entries()].sort((a, b) => {
    const [ga, ka] = rank(a[0]); const [gb, kb] = rank(b[0]);
    return ga !== gb ? ga - gb : ka.localeCompare(kb);
  });
}

const DEFAULT_MESSAGE_TEMPLATES = {
  confirm: "Hi {name}! You're booked with EasyPartyKit.ca. {items} for {date} ({service}). Total ${total}. We'll text a reminder 2 days before. Reply here with any questions — thank you!",
  remind: "Hi {name}! Reminder from EasyPartyKit.ca: your booking is coming up {date} — {items}. Reply YES to confirm, or let us know if anything changed. Thank you!",
};

const DEFAULT_BUSINESS = {
  name: "EasyPartyKit.ca",
  phone: "",
  email: "",
  website: "easypartykit.ca",
  address: "",
  gstNumber: "",
  taxLabel: "GST",
  taxRate: 0,          // percent. 0 = no tax line at all.
  dueDays: 14,
  paymentInstructions: "",
  terms: "",
};
function businessInfo(settings) {
  return { ...DEFAULT_BUSINESS, ...((settings && settings.business) || {}) };
}
// 369 -> "00369"
function invoiceNoLabel(n) {
  return n == null ? "" : String(n).padStart(5, "0");
}

const DEFAULT_SETTINGS = {
  items: DEFAULT_ITEMS,
  categories: DEFAULT_CATEGORIES,
  business: DEFAULT_BUSINESS,
  messageTemplates: DEFAULT_MESSAGE_TEMPLATES,
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
    discount_mode: b.discountMode || "pct",
    invoice_no: b.invoiceNo != null ? b.invoiceNo : null,
    invoice_issued_at: b.invoiceIssuedAt || null,
    items_total: b.itemsTotal || 0,
    delivery_fee: b.deliveryFee || 0,
    discount_amount: b.discountAmount || 0,
    total_cost: b.totalCost,
    status: b.status || "active",
    eta_out: b.etaOut || null,
    eta_back: b.etaBack || null,
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
    discountMode: r.discount_mode === "amt" ? "amt" : "pct",
    invoiceNo: r.invoice_no != null ? Number(r.invoice_no) : null,
    invoiceIssuedAt: r.invoice_issued_at || null,
    itemsTotal: Number(r.items_total) || 0,
    deliveryFee: Number(r.delivery_fee) || 0,
    discountAmount: Number(r.discount_amount) || 0,
    totalCost: Number(r.total_cost) || 0,
    status: r.status || "active",
    etaOut: r.eta_out || "",
    etaBack: r.eta_back || "",
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

// One number per booking, claimed once and kept. The sequence lives in Postgres
// so two phones can never be handed the same number.
async function claimInvoiceNoDB(bookingId) {
  const { data, error } = await supabase.rpc("next_invoice_no");
  if (error || data == null) {
    console.error("next_invoice_no error:", error);
    return null;
  }
  const n = Number(data);
  const issuedAt = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("bookings").update({ invoice_no: n, invoice_issued_at: issuedAt }).eq("id", bookingId);
  if (upErr) { console.error("invoice number save error:", upErr); return null; }
  return { invoiceNo: n, invoiceIssuedAt: issuedAt };
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
// "19:00" -> "7:00 PM". Times are stored as plain 24h strings, no timezone.
function fmtTime(t) {
  if (!t) return "";
  const [hRaw, mRaw] = String(t).split(":");
  const h = Number(hRaw), m = Number(mRaw);
  if (isNaN(h)) return t;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(isNaN(m) ? 0 : m).padStart(2, "0")} ${ap}`;
}
// One pair of labels for both service types — each names both directions,
// so it reads correctly whether the gear is dropped off or collected.
function etaLabels() {
  return { out: "Pickup/Dropoff ETA", back: "Return/Collect ETA" };
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// Gear that's still marked "out" hasn't come back, whatever the end date says.
// It keeps occupying inventory through today — so today's availability is honest —
// but not into the future, so an overdue return doesn't block next month's bookings.
function effectiveEnd(b) {
  if ((b.status || "active") !== "out") return b.endDate;
  const today = localDateStr(new Date());
  return b.endDate >= today ? b.endDate : today;
}
function occupiesOn(b, date) {
  return b.startDate <= date && effectiveEnd(b) >= date;
}
function isOverdue(b) {
  return (b.status || "active") === "out" && b.endDate < localDateStr(new Date());
}
function daysOverdue(b) {
  if (!isOverdue(b)) return 0;
  const end = new Date(b.endDate + "T00:00:00");
  const today = new Date(localDateStr(new Date()) + "T00:00:00");
  return Math.round((today - end) / 86400000);
}

function usedOnDate(bookings, date, itemId) {
  return bookings
    .filter((b) => occupiesOn(b, date))
    .reduce((s, b) => s + (b.items?.[itemId] || 0), 0);
}
function maxUsedInRange(bookings, start, end, itemId, excludeId = null) {
  let max = 0;
  const cur = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cur <= last) {
    const ds = localDateStr(cur);
    const used = bookings
      .filter((b) => b.id !== excludeId && occupiesOn(b, ds))
      .reduce((s, b) => s + (b.items?.[itemId] || 0), 0);
    max = Math.max(max, used);
    cur.setDate(cur.getDate() + 1);
  }
  return max;
}
// discountMode: "pct" (default, back-compatible) or "amt" for a flat dollar discount.
function calcTotal(itemsMap, itemDefs, svcType, deliveryFee, discount, discountMode) {
  const itemsTotal = itemDefs.reduce((s, it) => s + (itemsMap[it.id] || 0) * it.price, 0);
  const fee = svcType === "delivery" ? parseFloat(deliveryFee) || 0 : 0;
  const sub = itemsTotal + fee;
  const d = parseFloat(discount) || 0;
  // Never let a discount push the total below zero.
  const disc = discountMode === "amt" ? Math.min(Math.max(d, 0), sub) : sub * (d / 100);
  return { itemsTotal, deliveryFee: fee, discountAmount: disc, totalCost: sub - disc };
}
// "10%" or "$25.00" — one place, so the form, the table and the receipt agree.
function discountLabel(b) {
  const d = Number(b && b.discount) || 0;
  if (!d) return "";
  return (b.discountMode === "amt") ? "$" + d.toFixed(2) : d + "%";
}

// CSV export helper (bookings only — keeps existing behavior)
function bookingsToCSV(bookings, itemDefs) {
  const headers = [
    "Customer", "Sales Rep", "Start", "End", "Days",
    ...itemDefs.map((i) => i.name),
    "Service", "Address", "Subtotal", "Delivery Fee",
    "Discount", "Discount $", "Total", "Notes", "Phone", "Email",
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
      discountLabel(b),
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
    [[stamp, "EasyPartyKit.ca — Rental Manager"]]);

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
      "Discount", "Discount $", "Total", "Status", "Notes", "Phone", "Email", "Confirmed",
    ],
    bookings.map((b) => [
      b.id, b.name, b.salesRep, b.startDate, b.endDate, b.days,
      ...itemDefs.map((i) => b.items?.[i.id] || 0),
      b.serviceType, b.address || "",
      (b.itemsTotal || 0).toFixed(2),
      (b.deliveryFee || 0).toFixed(2),
      discountLabel(b),
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
// Add / rename / reorder / remove the category list. Renaming carries the items
// with it; removing is confirmed inline and states how many items it moves.
// A plain select over the managed list. An item whose category was removed keeps
// showing its own value as an option, so editing it doesn't silently reassign it.
function CategorySelect({ cats, value, onChange, style }) {
  const opts = value && !cats.some((c) => c === value) ? [value, ...cats] : cats;
  return (
    <select style={style || { ...inp(false), fontSize: 12 }} value={value || ""}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">{UNCATEGORIZED}</option>
      {opts.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

function CategoryEditor({ categories, items, onChange }) {
  const [adding, setAdding] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [removeIdx, setRemoveIdx] = useState(null);
  const [err, setErr] = useState("");

  const countFor = (c) => (items || []).filter((i) => itemCategory(i) === c).length;
  const clash = (name, skip) =>
    categories.some((c, i) => i !== skip && c.toLowerCase() === name.toLowerCase());

  function add() {
    const v = adding.trim();
    if (!v) return;
    if (v.toLowerCase() === UNCATEGORIZED.toLowerCase()) { setErr(`“${UNCATEGORIZED}” is built in — items with no category go there already.`); return; }
    if (clash(v, -1)) { setErr(`“${v}” is already on the list.`); return; }
    setErr(""); setAdding("");
    onChange([...categories, v]);
  }
  function commitRename() {
    const v = editVal.trim();
    const from = categories[editIdx];
    if (!v) { setErr("Category name can't be empty."); return; }
    if (clash(v, editIdx)) { setErr(`“${v}” is already on the list.`); return; }
    setErr(""); setEditIdx(null);
    if (v === from) return;
    onChange(categories.map((c, i) => (i === editIdx ? v : c)), { [from]: v });
  }
  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= categories.length) return;
    const next = [...categories];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function confirmRemove(i) {
    const name = categories[i];
    setRemoveIdx(null); setErr("");
    // Items keep existing; they just fall back to "Other".
    onChange(categories.filter((_, k) => k !== i), { [name]: "" });
  }

  const rowStyle = { display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: `1px solid ${C.border}` };
  const iconBtn = { background: "none", border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer", fontSize: 11, lineHeight: 1, padding: "4px 6px", color: C.textSub, fontFamily: T.sans };

  return (
    <div style={{ marginBottom: 10 }}>
      {categories.length === 0 && (
        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, padding: "6px 0" }}>
          No categories yet — every item will show under “{UNCATEGORIZED}”. Add one below.
        </div>
      )}
      {categories.map((c, i) => (
        <div key={c + i} style={rowStyle}>
          {editIdx === i ? (
            <>
              <input autoFocus style={{ ...inp(false), fontSize: 12, flex: 1 }} value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setEditIdx(null); setErr(""); } }} />
              <Btn small variant="primary" onClick={commitRename}>Save</Btn>
              <Btn small variant="ghost" onClick={() => { setEditIdx(null); setErr(""); }}>Cancel</Btn>
            </>
          ) : removeIdx === i ? (
            <>
              <span style={{ flex: 1, fontSize: 11, fontFamily: T.sans, color: C.danger }}>
                Remove “{c}”?{countFor(c) > 0 ? ` ${countFor(c)} item${countFor(c) > 1 ? "s" : ""} will move to ${UNCATEGORIZED}.` : " No items use it."}
              </span>
              <Btn small variant="primary" onClick={() => confirmRemove(i)}>Remove</Btn>
              <Btn small variant="ghost" onClick={() => setRemoveIdx(null)}>Cancel</Btn>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 12, fontFamily: T.sans, color: C.text }}>{c}</span>
              <span style={{ fontSize: 10, fontFamily: T.mono, color: C.textMuted }}>{countFor(c)}</span>
              <button type="button" style={iconBtn} title="Move up" disabled={i === 0}
                onClick={() => move(i, -1)}>▲</button>
              <button type="button" style={iconBtn} title="Move down" disabled={i === categories.length - 1}
                onClick={() => move(i, 1)}>▼</button>
              <Btn small variant="ghost" onClick={() => { setEditIdx(i); setEditVal(c); setErr(""); }}>Rename</Btn>
              <Btn small variant="ghost" style={{ color: C.danger }} onClick={() => { setRemoveIdx(i); setErr(""); }}>Remove</Btn>
            </>
          )}
        </div>
      ))}
      {err && <div style={{ fontSize: 11, color: C.danger, fontFamily: T.sans, marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input style={{ ...inp(false), fontSize: 12, flex: 1 }} placeholder="New category" value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Btn small onClick={add} disabled={!adding.trim()}>Add</Btn>
      </div>
    </div>
  );
}

function SettingsPanel({
  isMobile, settings, settingsOpen, setSettingsOpen,
  settingsDraft, setSettingsDraft, settingsErr, setSettingsErr,
  editingItem, setEditingItem, itemDraft, setItemDraft, itemErr, setItemErr,
  saveSettings, setCalMonth,
}) {
  const inputStyle = inp(isMobile);

  // settingsDraft is null until the panel is first opened, and this runs on every
  // render — above the guard — so it must tolerate null.
  const draftCats = Array.isArray(settingsDraft && settingsDraft.categories)
    ? settingsDraft.categories
    : DEFAULT_CATEGORIES;

  function openSettings() {
    setSettingsDraft({ ...settings, items: settings.items.map((i) => ({ ...i })), categories: [...settingsCategories(settings)] });
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
    setItemDraft({ name: item.name, price: item.price, inventory: item.inventory, category: item.category || "" });
    setItemErr("");
  }
  function startNewItem() {
    setEditingItem("new");
    setItemDraft({ name: "", price: "", inventory: "", category: "" });
    setItemErr("");
  }
  function saveItem() {
    const price = parseFloat(itemDraft.price);
    const inv = parseInt(itemDraft.inventory);
    if (!itemDraft.name.trim()) { setItemErr("Name required."); return; }
    if (isNaN(price) || price < 0) { setItemErr("Valid price required."); return; }
    if (isNaN(inv) || inv < 1) { setItemErr("Inventory must be ≥ 1."); return; }
    const cat = snapCategory(itemDraft.category, settingsDraft.items, settingsDraft.categories);
    if (editingItem === "new") {
      setSettingsDraft((d) => ({
        ...d,
        items: [...d.items, { id: genId(), name: itemDraft.name.trim(), price, inventory: inv, category: cat }],
      }));
    } else {
      setSettingsDraft((d) => ({
        ...d,
        items: d.items.map((i) =>
          i.id === editingItem ? { ...i, name: itemDraft.name.trim(), price, inventory: inv, category: cat } : i
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
          <Label>Item Categories</Label>
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginBottom: 8 }}>
            Categories group items on the booking form and the receipt, in the order listed here.
            Items with no category show under “{UNCATEGORIZED}”.
          </div>
          <CategoryEditor
            categories={draftCats}
            items={settingsDraft.items}
            onChange={(next, renames) => setSettingsDraft((d) => ({
              ...d,
              categories: next,
              items: renames
                ? d.items.map((i) => (renames[itemCategory(i)] !== undefined ? { ...i, category: renames[itemCategory(i)] } : i))
                : d.items,
            }))}
          />

          <Divider />
          <Label>Inventory Items</Label>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Item", "Category", "Price", "Qty", ""].map((h) => (
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
                      <CategorySelect cats={allCategories(settingsDraft.items, draftCats)}
                        value={itemDraft.category}
                        onChange={(v) => setItemDraft((d) => ({ ...d, category: v }))} />
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
                    <td style={{ padding: "6px 6px", fontFamily: T.sans, fontSize: 11, color: it.category ? C.textSub : C.textMuted }}>{itemCategory(it)}</td>
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
              <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input style={inputStyle} placeholder="Item name" value={itemDraft.name}
                  onChange={(e) => setItemDraft((d) => ({ ...d, name: e.target.value }))} />
                <CategorySelect cats={allCategories(settingsDraft.items, draftCats)}
                  value={itemDraft.category} style={inputStyle}
                  onChange={(v) => setItemDraft((d) => ({ ...d, category: v }))} />
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

          <Divider />
          <Label>Business Details (receipts &amp; invoices)</Label>
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginBottom: 8 }}>
            Printed at the top of every receipt. Leave a field blank and it is left off the document.
          </div>
          {(() => {
            const biz = { ...DEFAULT_BUSINESS, ...(settingsDraft.business || {}) };
            const setBiz = (patch) => setSettingsDraft((d) => ({ ...d, business: { ...biz, ...patch } }));
            const F = ({ k, label, type, ph, area }) => (
              <div style={{ marginBottom: 8 }}>
                <Label>{label}</Label>
                {area ? (
                  <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 48, lineHeight: 1.4 }}
                    placeholder={ph} value={biz[k] ?? ""} onChange={(e) => setBiz({ [k]: e.target.value })} />
                ) : (
                  <input type={type || "text"} style={inputStyle} placeholder={ph}
                    value={biz[k] ?? ""} onChange={(e) => setBiz({ [k]: type === "number" ? e.target.value : e.target.value })} />
                )}
              </div>
            );
            return (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                  <F k="name" label="Business Name" ph="EasyPartyKit.ca" />
                  <F k="website" label="Website" ph="easypartykit.ca" />
                  <F k="phone" label="Phone" ph="(604) 555-0123" />
                  <F k="email" label="Email" ph="hello@easypartykit.ca" />
                </div>
                <F k="address" label="Address" ph="Street, City, BC  Postal" area />
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "2fr 1fr 1fr 1fr", gap: 10 }}>
                  <F k="gstNumber" label="GST/HST Number" ph="not registered" />
                  <F k="taxLabel" label="Tax Label" ph="GST" />
                  <div style={{ marginBottom: 8 }}>
                    <Label>Tax Rate (%)</Label>
                    <input type="number" min={0} max={100} step="0.01" style={inputStyle} placeholder="0"
                      value={biz.taxRate ?? 0} onChange={(e) => setBiz({ taxRate: e.target.value === "" ? 0 : parseFloat(e.target.value) })} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Label>Payment Due (days)</Label>
                    <input type="number" min={0} step="1" style={inputStyle} placeholder="14"
                      value={biz.dueDays ?? 14} onChange={(e) => setBiz({ dueDays: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginBottom: 8 }}>
                  {Number(biz.taxRate) > 0
                    ? `Receipts will show a ${biz.taxLabel || "tax"} line at ${biz.taxRate}%.`
                    : "Tax rate is 0, so no tax line appears. Set it when you register for GST."}
                </div>
                <F k="paymentInstructions" label="Payment Instructions" ph="e-Transfer to hello@easypartykit.ca" area />
                <F k="terms" label="Terms / Footer Note" ph="Deposit non-refundable within 48 hours of the event." area />
              </div>
            );
          })()}

          <Divider />
          <Label>Text Message Templates</Label>
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, margin: "-4px 0 8px", lineHeight: 1.5 }}>
            Used by the Messages tab. These placeholders auto-fill: {"{name} {items} {date} {service} {total} {etaOut} {etaBack}"}
            <div style={{ marginTop: 3 }}>
              {"{etaOut}"} and {"{etaBack}"} always write out as “approximately 7:00 PM”, never an exact promise — and as “at a time we’ll confirm” when no ETA is set.
            </div>
          </div>
          {[{ key: "confirm", label: "Booking confirmation" }, { key: "remind", label: "2-day reminder" }].map((tpl) => (
            <div key={tpl.key} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textSub, fontFamily: T.sans }}>{tpl.label}</span>
                <button type="button" onClick={() => setSettingsDraft((d) => ({ ...d, messageTemplates: { ...(d.messageTemplates || {}), [tpl.key]: DEFAULT_MESSAGE_TEMPLATES[tpl.key] } }))}
                  style={{ border: "none", background: "none", color: C.accent, fontSize: 11, fontFamily: T.sans, cursor: "pointer" }}>Reset</button>
              </div>
              <textarea rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.4, fontFamily: T.sans }}
                value={settingsDraft.messageTemplates && settingsDraft.messageTemplates[tpl.key] != null ? settingsDraft.messageTemplates[tpl.key] : DEFAULT_MESSAGE_TEMPLATES[tpl.key]}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, messageTemplates: { ...(d.messageTemplates || {}), [tpl.key]: e.target.value } }))} />
            </div>
          ))}

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
  isMobile, itemDefs, categories, startDate, endDate, bookings,
  form, setForm, formErrors, successMsg,
  editingBookingId, cancelEdit, handleSubmit,
  rentalDays, getAvail, preview, formItemsMap,
}) {
  const inputStyle = inp(isMobile);
  const itemGroups = useMemo(() => groupByCategory(itemDefs, categories), [itemDefs, categories]);

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div>
          <Label>{etaLabels().out}</Label>
          <input type="time" style={inputStyle} value={form.etaOut}
            onChange={(e) => setForm({ etaOut: e.target.value })} />
        </div>
        <div>
          <Label>{etaLabels().back}</Label>
          <input type="time" style={inputStyle} value={form.etaBack}
            onChange={(e) => setForm({ etaBack: e.target.value })} />
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
            {itemGroups.map(([cat, items]) => (
            <Fragment key={cat}>
              {itemGroups.length > 1 && (
                <tr>
                  <td colSpan={4} style={{ padding: "10px 6px 3px", fontSize: 10, fontFamily: T.sans, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent }}>
                    {cat}
                  </td>
                </tr>
              )}
              {items.map((it) => {
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
            </Fragment>
            ))}
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

      <Field label="Discount" error={formErrors.discount}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden", flex: "0 0 auto" }}>
            {[{ id: "pct", label: "%" }, { id: "amt", label: "$" }].map((m) => (
              <button key={m.id} type="button"
                onClick={() => setForm({ discountMode: m.id })}
                aria-pressed={form.discountMode === m.id}
                title={m.id === "pct" ? "Percentage off the subtotal" : "Flat dollar amount off"}
                style={{
                  width: isMobile ? 46 : 38, padding: isMobile ? "10px 0" : "7px 0", border: "none", cursor: "pointer",
                  fontFamily: T.sans, fontSize: 13, fontWeight: 700,
                  background: form.discountMode === m.id ? C.accent : C.surface,
                  color: form.discountMode === m.id ? "#fff" : C.textSub, transition: "all 0.15s",
                }}>
                {m.label}
              </button>
            ))}
          </div>
          <input type="number" style={{ ...inputStyle, flex: 1 }} min={0}
            max={form.discountMode === "pct" ? 100 : undefined}
            step={form.discountMode === "pct" ? 1 : 0.01}
            placeholder={form.discountMode === "pct" ? "0" : "0.00"}
            value={form.discount} onChange={(e) => setForm({ discount: e.target.value })} />
        </div>
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
              <span>Discount ({form.discountMode === "amt" ? `$${form.discount}` : `${form.discount}%`})</span>
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

// ─── Address Link (taps through to Google Maps) ──────────────────────────────
function AddressLink({ address, size = 12, compact }) {
  if (!address) return null;
  const href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "flex-start",
        gap: 4,
        fontSize: size,
        lineHeight: 1.35,
        fontFamily: T.sans,
        color: C.accent,
        textDecoration: "none",
        borderBottom: `1px solid ${C.accentSoft}`,
        padding: compact ? 0 : "1px 0",
        wordBreak: "break-word",
      }}
      title={"Open in Google Maps: " + address}
    >
      <span style={{ flex: "0 0 auto" }} aria-hidden="true">📍</span>
      <span>{address}</span>
    </a>
  );
}

// ─── ETA strip shown on booking cards / rows ─────────────────────────────────
function EtaLine({ booking, size = 11 }) {
  const { etaOut, etaBack } = booking;
  if (!etaOut && !etaBack) return null;
  const L = etaLabels();
  const parts = [];
  if (etaOut) parts.push({ k: "out", icon: "🚚", label: L.out, v: fmtTime(etaOut) });
  if (etaBack) parts.push({ k: "back", icon: "↩", label: L.back, v: fmtTime(etaBack) });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: size, fontFamily: T.sans, color: C.textSub, marginTop: 3 }}>
      {parts.map((p) => (
        <span key={p.k} title={p.label}>
          <span aria-hidden="true">{p.icon}</span>{" "}
          <span style={{ color: C.textMuted }}>{p.label.replace(" ETA", "")}</span>{" "}
          <span style={{ fontWeight: 600, color: C.text, fontFamily: T.mono }}>{p.v}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Receipt / Invoice ───────────────────────────────────────────────────────
// One document, two states. RECEIPT is the paid state (what was collected);
// INVOICE is the unpaid state (what is still owed, and by when).
function invoiceTotals(booking, business, paidAmount) {
  const items = Number(booking.itemsTotal) || 0;
  const fee = Number(booking.deliveryFee) || 0;
  const disc = Number(booking.discountAmount) || 0;
  const net = items + fee - disc;                 // what totalCost already represents
  const rate = Number(business.taxRate) || 0;
  const tax = rate > 0 ? net * (rate / 100) : 0;
  const total = net + tax;
  const paid = Number(paidAmount) || 0;
  return { items, fee, disc, net, rate, tax, total, paid, due: Math.max(total - paid, 0) };
}

function dueDateStr(issuedISO, dueDays) {
  const base = issuedISO ? new Date(issuedISO) : new Date();
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + (Number(dueDays) || 0));
  return localDateStr(d);
}

function InvoiceDoc({ booking, business, itemDefs, categories, payments, mode, onClose, onIssue, issuing }) {
  const paid = (payments || []).filter((p) => p.bookingId === booking.id);
  const paidAmount = paid.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const t = invoiceTotals(booking, business, paidAmount);
  const isReceipt = mode === "receipt";
  const issued = booking.invoiceIssuedAt;
  const lineGroups = groupByCategory(
    itemDefs.filter((it) => booking.items && booking.items[it.id]), categories
  );

  const money = (n) => "$" + (Number(n) || 0).toFixed(2);
  const lbl = { fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted, fontFamily: T.sans, fontWeight: 600 };
  const val = { fontSize: 12, color: C.text, fontFamily: T.sans };
  const row = { display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: T.sans, padding: "3px 0" };

  return (
    <div className="epk-doc-sheet" style={{ background: "#fff", color: "#111", padding: "22px 24px", fontFamily: T.sans }}>
      <div style={{ textAlign: "center", fontSize: 24, fontWeight: 800, letterSpacing: "0.02em", marginBottom: 18, color: C.accentDeep }}>
        {isReceipt ? "Receipt" : "Invoice"}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{business.name}</div>
          {business.address && <div style={{ ...val, color: C.textSub, whiteSpace: "pre-line" }}>{business.address}</div>}
          {business.phone && <div style={{ ...val, color: C.textSub }}>{business.phone}</div>}
          {business.email && <div style={{ ...val, color: C.textSub }}>{business.email}</div>}
          {business.website && <div style={{ ...val, color: C.textSub }}>{business.website}</div>}
          {business.gstNumber && <div style={{ ...val, color: C.textSub, marginTop: 4 }}>GST/HST No. {business.gstNumber}</div>}
        </div>
        <div style={{ minWidth: 150 }}>
          <div style={lbl}>{isReceipt ? "Receipt #" : "Invoice #"}</div>
          <div style={{ ...val, fontFamily: T.mono, fontWeight: 700 }}>
            {booking.invoiceNo != null ? invoiceNoLabel(booking.invoiceNo) : "— not issued —"}
          </div>
          <div style={{ ...lbl, marginTop: 8 }}>{isReceipt ? "Receipt Date" : "Invoice Date"}</div>
          <div style={{ ...val, fontFamily: T.mono }}>{issued ? localDateStr(new Date(issued)) : localDateStr(new Date())}</div>
          {!isReceipt && (
            <>
              <div style={{ ...lbl, marginTop: 8 }}>Due Date</div>
              <div style={{ ...val, fontFamily: T.mono }}>{dueDateStr(issued, business.dueDays)}</div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 180 }}>
          <div style={lbl}>Bill To</div>
          <div style={{ ...val, fontWeight: 600 }}>{booking.name}</div>
          {booking.phone && <div style={{ ...val, color: C.textSub }}>{booking.phone}</div>}
          {booking.email && <div style={{ ...val, color: C.textSub }}>{booking.email}</div>}
          {booking.address && <div style={{ ...val, color: C.textSub, whiteSpace: "pre-line" }}>{booking.address}</div>}
        </div>
        <div style={{ minWidth: 150 }}>
          <div style={lbl}>Rental Period</div>
          <div style={{ ...val, fontFamily: T.mono }}>{fmtDateShort(booking.startDate)} – {fmtDateShort(booking.endDate)}</div>
          <div style={{ ...val, color: C.textSub }}>{booking.serviceType === "delivery" ? "Delivery" : "Pickup"}</div>
          {(booking.etaOut || booking.etaBack) && (
            <div style={{ ...val, color: C.textSub, fontSize: 11 }}>
              {booking.etaOut && <>Out approx. {fmtTime(booking.etaOut)}<br /></>}
              {booking.etaBack && <>Back approx. {fmtTime(booking.etaBack)}</>}
            </div>
          )}
        </div>
      </div>

      <div style={{
        // Green only when nothing is owed. Anything outstanding reads amber,
        // on either document.
        background: t.due <= 0 ? C.accentSoft : C.sunshineSoft,
        border: `1px solid ${t.due <= 0 ? C.border : C.sunshine}`,
        borderRadius: 3, padding: "10px 14px", marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: t.due <= 0 ? C.accentDeep : C.warning }}>
            {isReceipt ? "Total Received" : "Amount Due"}
          </span>
          <span style={{ fontSize: 20, fontWeight: 800, fontFamily: T.mono, color: C.text }}>
            {money(isReceipt ? t.paid : t.due)}
          </span>
        </div>
        {isReceipt && t.due > 0 && (
          <div style={{ fontSize: 11, color: C.danger, fontFamily: T.sans, marginTop: 4 }}>
            Balance of {money(t.due)} still outstanding on this booking.
          </div>
        )}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${C.borderStrong}` }}>
            {["Qty", "Description", "Unit Price", "Amount"].map((h, i) => (
              <th key={h} style={{ ...lbl, padding: "6px 6px", textAlign: i >= 2 ? "right" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineGroups.map(([cat, items]) => (
            <Fragment key={cat}>
              {lineGroups.length > 1 && (
                <tr><td colSpan={4} style={{ ...lbl, color: C.accent, padding: "9px 6px 2px" }}>{cat}</td></tr>
              )}
              {items.map((it) => {
                const qty = booking.items[it.id];
                return (
                  <tr key={it.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 6px", fontFamily: T.mono, fontSize: 12 }}>{qty}</td>
                    <td style={{ padding: "6px 6px", fontSize: 12 }}>{it.name}</td>
                    <td style={{ padding: "6px 6px", fontFamily: T.mono, fontSize: 12, textAlign: "right" }}>{money(it.price)}</td>
                    <td style={{ padding: "6px 6px", fontFamily: T.mono, fontSize: 12, textAlign: "right" }}>{money(qty * it.price)}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div style={{ marginLeft: "auto", maxWidth: 280 }}>
        <div style={row}><span>Items</span><span style={{ fontFamily: T.mono }}>{money(t.items)}</span></div>
        {t.fee > 0 && <div style={row}><span>Delivery</span><span style={{ fontFamily: T.mono }}>{money(t.fee)}</span></div>}
        {t.disc > 0 && (
          <div style={{ ...row, color: C.danger }}>
            <span>Discount{booking.discountMode === "amt" ? "" : ` (${discountLabel(booking)})`}</span>
            <span style={{ fontFamily: T.mono }}>-{money(t.disc)}</span>
          </div>
        )}
        {t.rate > 0 && (
          <>
            <div style={{ ...row, borderTop: `1px solid ${C.border}` }}><span>Subtotal</span><span style={{ fontFamily: T.mono }}>{money(t.net)}</span></div>
            <div style={row}><span>{business.taxLabel} ({t.rate}%)</span><span style={{ fontFamily: T.mono }}>{money(t.tax)}</span></div>
          </>
        )}
        <div style={{ ...row, borderTop: `2px solid ${C.borderStrong}`, fontWeight: 800, fontSize: 14, paddingTop: 6 }}>
          <span>Total</span><span style={{ fontFamily: T.mono }}>{money(t.total)}</span>
        </div>
        <div style={row}><span>Amount Paid</span><span style={{ fontFamily: T.mono }}>{money(t.paid)}</span></div>
        <div style={{ ...row, fontWeight: 700, color: t.due > 0 ? C.danger : C.accent }}>
          <span>{t.due > 0 ? "Amount Due" : "Paid in Full"}</span>
          <span style={{ fontFamily: T.mono }}>{money(t.due)}</span>
        </div>
      </div>

      {(business.paymentInstructions || business.terms) && (
        <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div style={lbl}>Terms &amp; Conditions</div>
          {business.paymentInstructions && <div style={{ ...val, color: C.textSub, whiteSpace: "pre-line" }}>{business.paymentInstructions}</div>}
          {business.terms && <div style={{ ...val, color: C.textSub, whiteSpace: "pre-line" }}>{business.terms}</div>}
        </div>
      )}
    </div>
  );
}

// Generates a shareable PNG directly with Canvas, without invoking Android printing.
// Uses the same booking, payment and tax calculations as InvoiceDoc.
function saveInvoiceAsPng(booking, business, itemDefs, categories, payments, mode) {
  const paidAmount = (payments || [])
    .filter((p) => p.bookingId === booking.id)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const t = invoiceTotals(booking, business, paidAmount);
  const isReceipt = mode === "receipt";
  const items = groupByCategory(
    itemDefs.filter((it) => booking.items && booking.items[it.id]), categories
  );
  const money = (value) => "$" + (Number(value) || 0).toFixed(2);
  const W = 650, S = 2, pad = 32, right = W - pad;
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = 4000 * S; // temporary height; cropped to content at the end
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Your browser could not create an image.");
  c.scale(S, S);
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, 4000);
  const ink = "#1c2620", muted = "#5e6a62", green = "#1f4d39";
  const lineColor = "#e4e4dc", amber = "#7a5800";
  let y = 38;
  function label(txt, x, yy) {
    c.font = "600 10px Arial, sans-serif"; c.fillStyle = muted;
    c.textAlign = "left"; c.fillText(String(txt).toUpperCase(), x, yy);
  }
  function text(txt, x, yy, size = 13, bold = false, color = ink, align = "left") {
    c.font = (bold ? "700 " : "400 ") + size + "px Arial, sans-serif";
    c.fillStyle = color; c.textAlign = align;
    c.fillText(String(txt ?? ""), x, yy);
    c.textAlign = "left";
  }
  function rule(yy) {
    c.beginPath(); c.moveTo(pad, yy); c.lineTo(right, yy);
    c.strokeStyle = lineColor; c.lineWidth = 1; c.stroke();
  }
  function wrapped(txt, x, startY, maxWidth, size = 12, color = muted, bold = false) {
    c.font = (bold ? "700 " : "400 ") + size + "px Arial, sans-serif";
    c.fillStyle = color; c.textAlign = "left";
    let yy = startY;
    String(txt ?? "").split("\n").forEach((paragraph) => {
      let line = "";
      paragraph.split(/\s+/).forEach((word) => {
        const candidate = line ? line + " " + word : word;
        if (line && c.measureText(candidate).width > maxWidth) {
          c.fillText(line, x, yy); yy += size + 5; line = word;
        } else line = candidate;
      });
      if (line) c.fillText(line, x, yy);
      yy += size + 5;
    });
    return yy;
  }
  text(isReceipt ? "Receipt" : "Invoice", W / 2, y, 25, true, green, "center");
  y += 38;
  const top = y;
  text(business.name || "EasyPartyKit.ca", pad, y, 15, true);
  y += 19;
  for (const info of [business.address, business.phone, business.email, business.website,
    business.gstNumber ? "GST/HST No. " + business.gstNumber : ""]) {
    if (info) y = wrapped(info, pad, y, 295, 12);
  }
  const businessEnd = y;
  label(isReceipt ? "Receipt #" : "Invoice #", 420, top);
  text(booking.invoiceNo != null ? invoiceNoLabel(booking.invoiceNo) : "Not issued", 420, top + 18, 13, true);
  label(isReceipt ? "Receipt Date" : "Invoice Date", 420, top + 39);
  const issued = booking.invoiceIssuedAt;
  text(issued ? localDateStr(new Date(issued)) : localDateStr(new Date()), 420, top + 57);
  if (!isReceipt) {
    label("Due Date", 420, top + 78);
    text(dueDateStr(issued, business.dueDays), 420, top + 96);
  }
  y = Math.max(businessEnd, top + (isReceipt ? 76 : 113)) + 21;
  const billTop = y;
  label("Bill To", pad, billTop);
  text(booking.name, pad, billTop + 19, 13, true);
  let billY = billTop + 38;
  for (const info of [booking.phone, booking.email, booking.address]) {
    if (info) billY = wrapped(info, pad, billY, 300);
  }
  label("Rental Period", 356, billTop);
  text(fmtDateShort(booking.startDate) + " – " + fmtDateShort(booking.endDate), 356, billTop + 19);
  text(booking.serviceType === "delivery" ? "Delivery" : "Pickup", 356, billTop + 37, 12, false, muted);
  if (booking.etaOut) text("Out approx. " + fmtTime(booking.etaOut), 356, billTop + 55, 11, false, muted);
  if (booking.etaBack) text("Back approx. " + fmtTime(booking.etaBack), 356, billTop + (booking.etaOut ? 72 : 55), 11, false, muted);
  y = Math.max(billY, billTop + (booking.etaBack ? 90 : booking.etaOut ? 73 : 55)) + 12;
  c.fillStyle = t.due <= 0 ? "#e3f0e7" : "#fff4cc";
  c.fillRect(pad, y, W - 2 * pad, 48);
  text(isReceipt ? "Total Received" : "Amount Due", pad + 12, y + 29, 15, true, t.due <= 0 ? green : amber);
  text(money(isReceipt ? t.paid : t.due), right - 12, y + 29, 19, true, ink, "right");
  y += 62;
  if (isReceipt && t.due > 0) {
    text("Balance still outstanding: " + money(t.due), pad, y, 11, true, "#b73c2a");
    y += 24;
  }
  label("Qty", pad + 4, y);
  label("Description", pad + 60, y);
  label("Unit Price", right - 174, y);
  label("Amount", right - 66, y);
  y += 13; rule(y); y += 18;
  items.forEach(([category, group]) => {
    if (items.length > 1) { label(category, pad + 4, y); y += 22; }
    group.forEach((it) => {
      const quantity = Number(booking.items[it.id]) || 0;
      const nextY = wrapped(it.name, pad + 60, y, 230, 12, ink);
      text(quantity, pad + 4, y, 12);
      text(money(it.price), right - 80, y, 12, false, ink, "right");
      text(money(quantity * it.price), right, y, 12, false, ink, "right");
      y = Math.max(y + 25, nextY + 6);
      rule(y - 9);
    });
    y += 4;
  });
  y += 12;
  const sumLeft = 390;
  function totalRow(name, value, bold = false, color = ink) {
    text(name, sumLeft, y, 13, bold, color);
    text(value, right, y, 13, bold, color, "right");
    y += 23;
  }
  totalRow("Items", money(t.items));
  if (t.fee > 0) totalRow("Delivery", money(t.fee));
  if (t.disc > 0) totalRow("Discount", "-" + money(t.disc), false, "#b73c2a");
  if (t.rate > 0) {
    totalRow("Subtotal", money(t.net));
    totalRow((business.taxLabel || "Tax") + " (" + t.rate + "%)", money(t.tax));
  }
  c.beginPath(); c.moveTo(sumLeft, y - 12); c.lineTo(right, y - 12);
  c.strokeStyle = lineColor; c.lineWidth = 2; c.stroke();
  totalRow("Total", money(t.total), true);
  totalRow("Amount Paid", money(t.paid));
  totalRow(t.due > 0 ? "Amount Due" : "Paid in Full", money(t.due), true, t.due > 0 ? "#b73c2a" : green);
  if (business.paymentInstructions || business.terms) {
    y += 9; rule(y); y += 24;
    label("Terms & Conditions", pad, y); y += 20;
    if (business.paymentInstructions) y = wrapped(business.paymentInstructions, pad, y, W - 2 * pad);
    if (business.terms) y = wrapped(business.terms, pad, y, W - 2 * pad);
  }
  const finalHeight = Math.ceil(Math.max(y + 20, 300));
  const output = document.createElement("canvas");
  output.width = W * S; output.height = finalHeight * S;
  const outCtx = output.getContext("2d");
  if (!outCtx) throw new Error("Your browser could not export the image.");
  outCtx.drawImage(canvas, 0, 0, output.width, output.height, 0, 0, output.width, output.height);
  const link = document.createElement("a");
  const safeNumber = booking.invoiceNo != null ? invoiceNoLabel(booking.invoiceNo) : "preview";
  link.download = (isReceipt ? "Receipt-" : "Invoice-") + safeNumber + ".png";
  link.href = output.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function InvoiceOverlay({ booking, business, itemDefs, categories, payments, onClose, onIssue }) {
  const paidAmount = (payments || [])
    .filter((p) => p.bookingId === booking.id)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const t = invoiceTotals(booking, business, paidAmount);
  // Default to whichever document matches reality; the toggle still overrides.
  const [mode, setMode] = useState(t.due <= 0 && t.paid > 0 ? "receipt" : "invoice");
  const [issuing, setIssuing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function saveImage() {
    if (exporting) return;
    setErr(""); setExporting(true);
    try {
      saveInvoiceAsPng(booking, business, itemDefs, categories, payments, mode);
    } catch (e) {
      console.error("Invoice PNG export failed", e);
      setErr("Couldn't save the image on this device. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function issue() {
    setIssuing(true); setErr("");
    const ok = await onIssue(booking);
    setIssuing(false);
    if (!ok) setErr("Couldn't get a number. Check your connection and try again — nothing was issued.");
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200,
      overflowY: "auto", padding: 12,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, margin: "0 auto" }}>
        <div className="epk-doc-actions" style={{
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: "4px 4px 0 0",
          padding: "10px 12px",
        }}>
          <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
            {[{ id: "invoice", label: "Invoice" }, { id: "receipt", label: "Receipt" }].map((m) => (
              <button key={m.id} type="button" onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
                style={{
                  padding: "8px 14px", border: "none", cursor: "pointer", fontFamily: T.sans,
                  fontSize: 12, fontWeight: 700,
                  background: mode === m.id ? C.accent : C.surface,
                  color: mode === m.id ? "#fff" : C.textSub,
                }}>
                {m.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, fontFamily: T.sans, color: mode === "receipt" && t.due > 0 ? C.warning : C.textMuted }}>
            {mode === "receipt"
              ? (t.due > 0
                  ? `Not paid in full — this receipt shows ${"$" + t.paid.toFixed(2)} received and notes the balance.`
                  : "Shows what was collected.")
              : "Shows what is still owed."}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {booking.invoiceNo == null ? (
              <Btn small variant="primary" onClick={issue} disabled={issuing}>
                {issuing ? "Getting number…" : "Issue number"}
              </Btn>
            ) : (
              <>
                <Btn small variant="primary" onClick={saveImage} disabled={exporting}>
                  {exporting ? "Saving…" : "Save as Image"}
                </Btn>
                <Btn small onClick={() => window.print()}>🖨 Print / PDF</Btn>
              </>
            )}
            <Btn small variant="ghost" onClick={onClose}>Close</Btn>
          </div>
        </div>

        {booking.invoiceNo == null && (
          <div className="epk-doc-actions" style={{
            background: C.sunshineSoft, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
            padding: "8px 12px", fontSize: 11, color: C.warning, fontFamily: T.sans,
          }}>
            This is a preview. “Issue number” assigns {invoiceNoLabel(369)}-style number permanently — do that before sending it to the customer.
          </div>
        )}
        {err && (
          <div className="epk-doc-actions" style={{
            background: C.brickSoft, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
            padding: "8px 12px", fontSize: 11, color: C.danger, fontFamily: T.sans,
          }}>{err}</div>
        )}

        <InvoiceDoc booking={booking} business={business} itemDefs={itemDefs}
          categories={categories} payments={payments} mode={mode} />
      </div>
    </div>
  );
}

// ─── Booking Status ──────────────────────────────────────────────────────────
const ST_ACTIVE = "active";
const ST_OUT = "out";
const ST_DONE = "done";
function bStatus(b) { return b.status || ST_ACTIVE; }

function StatusBadge({ status, paid, overdue }) {
  const pills = [];
  if (status === ST_OUT && !overdue) pills.push({ t: "OUT", bg: C.warning });
  if (status === ST_OUT && overdue) pills.push({ t: "OVERDUE", bg: C.danger });
  if (status === ST_DONE) pills.push({ t: "DONE", bg: C.accent });
  if (paid) pills.push({ t: "PAID", bg: C.accentDeep });
  if (!pills.length) return null;
  return (
    <>
      {pills.map((p) => (
        <span key={p.t} style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: p.bg, padding: "2px 6px", borderRadius: 2, letterSpacing: "0.06em" }}>{p.t}</span>
      ))}
    </>
  );
}

// ─── Bookings List ────────────────────────────────────────────────────────────
function BookingsList({
  isMobile, bookings, itemDefs,
  search, setSearch, filterService, setFilterService,
  filterStart, setFilterStart, filterEnd, setFilterEnd,
  filterStatus, setFilterStatus,
  startEditBooking, requestRemoveBooking, exportCSV,
  requestMarkOut, requestMarkReturned, requestRecordPayment, requestStepBack, requestInvoice, paidIds,
}) {
  const inputStyle = inp(isMobile);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bookings.filter((b) => {
      const status = b.status || "active";
      // "Active" means every open booking — including gear that's out and not back yet.
      if (filterStatus === "active") { if (status === ST_DONE) return false; }
      else if (filterStatus !== "all" && status !== filterStatus) return false;
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
            <option value="out">Out / Pending Return</option>
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
                const st = bStatus(b);
                const isDone = st === ST_DONE;
                const isPaid = paidIds.has(b.id);
                const late = isOverdue(b);
                return (
                <div key={b.id} style={{
                  background: C.surface,
                  border: `1px solid ${isDone ? C.accent : late ? C.danger : st === ST_OUT ? C.warning : C.border}`,
                  borderRadius: 3,
                  padding: "12px 14px",
                  opacity: isDone ? 0.85 : 1,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: C.text, fontFamily: T.sans }}>{b.name}</div>
                        <StatusBadge status={st} paid={isPaid} overdue={late} />
                        {late && (
                          <span style={{ fontSize: 10, color: C.danger, fontFamily: T.sans, fontWeight: 600 }}>
                            {daysOverdue(b)}d past return
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginTop: 2 }}>
                        {b.salesRep} · {fmtDateShort(b.startDate)} – {fmtDateShort(b.endDate)}
                      </div>
                      <EtaLine booking={b} size={11} />
                      {b.address && (
                        <div style={{ marginTop: 4 }}>
                          <AddressLink address={b.address} size={12} />
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {st !== ST_ACTIVE && (
                        <Btn small variant="ghost" onClick={() => requestStepBack(b)} title={isDone ? "Reopen — back to Out" : "Undo — back to Active"}>
                          ↩ {isDone ? "Reopen" : "Undo"}
                        </Btn>
                      )}
                      <Btn small variant="ghost" onClick={() => startEditBooking(b)}>{isDone ? "Open" : "Edit"}</Btn>
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
                  <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                    <Btn variant="ghost" onClick={() => requestInvoice(b)} style={{ whiteSpace: "nowrap" }}>
                      🧾 Receipt
                    </Btn>
                  </div>
                  {!isDone && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                      {st === ST_ACTIVE ? (
                        <Btn variant="primary" fullWidth onClick={() => requestMarkOut(b)}>
                          {b.serviceType === "delivery" ? "🚚 Delivered" : "📦 Picked Up by Customer"}
                        </Btn>
                      ) : (
                        <Btn variant="primary" fullWidth onClick={() => requestMarkReturned(b)}>
                          ✓ Returned
                        </Btn>
                      )}
                      {!isPaid && (
                        <Btn variant="ghost" onClick={() => requestRecordPayment(b)} style={{ whiteSpace: "nowrap" }}>
                          💵 Payment
                        </Btn>
                      )}
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
                    const st = bStatus(b);
                    const isDone = st === ST_DONE;
                    const isPaid = paidIds.has(b.id);
                    const late = isOverdue(b);
                    return (
                    <tr key={b.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.surface : C.bg, opacity: isDone ? 0.7 : 1 }}>
                      <td style={{ padding: "9px 10px", fontWeight: 600, color: C.text }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {b.name}
                          <StatusBadge status={st} paid={isPaid} overdue={late} />
                          {late && <span style={{ fontSize: 10, color: C.danger, fontWeight: 600 }}>{daysOverdue(b)}d</span>}
                        </div>
                        {b.notes && <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 400 }}>{b.notes}</div>}
                      </td>
                      <td style={{ padding: "9px 10px", color: C.textSub }}>{b.salesRep}</td>
                      <td style={{ padding: "9px 10px", color: C.textSub, whiteSpace: "nowrap" }}>
                        {fmtDateShort(b.startDate)} – {fmtDateShort(b.endDate)}
                        <EtaLine booking={b} size={10} />
                      </td>
                      <td style={{ padding: "9px 10px", color: C.textMuted, fontFamily: T.mono, textAlign: "center" }}>{b.days}</td>
                      {itemDefs.map((it) => (
                        <td key={it.id} style={{ padding: "9px 10px", color: C.text, fontFamily: T.mono, textAlign: "center" }}>{b.items?.[it.id] || "—"}</td>
                      ))}
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{ fontSize: 10, color: C.textSub, border: `1px solid ${C.border}`, padding: "2px 7px", borderRadius: 2 }}>
                          {b.serviceType === "delivery" ? "Delivery" : "Pickup"}
                        </span>
                        {b.address && <div style={{ marginTop: 3 }}><AddressLink address={b.address} size={10} compact /></div>}
                      </td>
                      <td style={{ padding: "9px 10px", color: C.textSub, fontFamily: T.mono }}>${b.itemsTotal?.toFixed(2) || "—"}</td>
                      <td style={{ padding: "9px 10px", color: C.textSub, fontFamily: T.mono }}>{b.deliveryFee > 0 ? `$${b.deliveryFee.toFixed(2)}` : "—"}</td>
                      <td style={{ padding: "9px 10px", color: b.discount > 0 ? C.danger : C.textMuted, fontFamily: T.mono }}>{b.discount > 0 ? `-${discountLabel(b)}` : "—"}</td>
                      <td style={{ padding: "9px 10px", fontWeight: 700, color: C.text, fontFamily: T.mono }}>${b.totalCost.toFixed(2)}</td>
                      <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                        {st === ST_ACTIVE && (
                          <Btn small variant="primary" onClick={() => requestMarkOut(b)} style={{ marginRight: 4 }}>
                            {b.serviceType === "delivery" ? "Delivered" : "Picked Up"}
                          </Btn>
                        )}
                        {st === ST_OUT && (
                          <Btn small variant="primary" onClick={() => requestMarkReturned(b)} style={{ marginRight: 4 }}>✓ Returned</Btn>
                        )}
                        {!isDone && !isPaid && (
                          <Btn small variant="ghost" onClick={() => requestRecordPayment(b)} style={{ marginRight: 4 }}>💵</Btn>
                        )}
                        {st !== ST_ACTIVE && (
                          <Btn small variant="ghost" onClick={() => requestStepBack(b)} style={{ marginRight: 4 }} title={isDone ? "Reopen — back to Out" : "Undo — back to Active"}>
                            ↩ {isDone ? "Reopen" : "Undo"}
                          </Btn>
                        )}
                        <Btn small variant="ghost" onClick={() => requestInvoice(b)} style={{ marginRight: 4 }} title="Receipt / invoice">🧾</Btn>
                        <Btn small variant="ghost" onClick={() => startEditBooking(b)}>{isDone ? "Open" : "Edit"}</Btn>
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
              { l: "Out", v: filtered.filter((b) => bStatus(b) === ST_OUT).length },
              { l: "Overdue", v: filtered.filter((b) => isOverdue(b)).length, danger: true },
            ].map((s) => (
              <div key={s.l}>
                <div style={{ fontSize: 16, fontWeight: 700, color: s.danger && s.v > 0 ? C.danger : C.text, fontFamily: T.mono }}>{s.v}</div>
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
function MarkDoneDialog({ open, booking, complete, onConfirm, onCancel }) {
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
          {complete ? "Return & Record Payment" : "Record Payment"}
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
          <Btn onClick={submit} variant="primary">{complete ? "Save & Close Booking" : "Save Payment"}</Btn>
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
        }} aria-label="EasyPartyKit.ca logo">
          🎈
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: isMobile ? 15 : 19, fontWeight: 800, fontFamily: T.sans,
            letterSpacing: "0.01em", lineHeight: 1.1,
            color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            EasyPartyKit.ca
          </div>
          {!isMobile && (
            <div style={{
              fontSize: 11, color: C.sunshineSoft, fontFamily: T.sans,
              marginTop: 2, fontStyle: "italic", opacity: 0.95,
            }}>
              Party rentals made easy.
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
function RemindersView({ isMobile, bookings, itemDefs, onMarkSent, templates }) {
  const [tab, setTab] = useState("confirm");
  const [phoneOnly, setPhoneOnly] = useState(false);
  const t0 = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  const daysUntil = (b) => Math.round((new Date(b.startDate + "T00:00:00") - t0) / 86400000);
  const active = bookings.filter((b) => (b.status || "active") === "active" && daysUntil(b) >= 0);
  const filt = (arr) => (phoneOnly ? arr.filter((b) => b.phone && b.phone.trim()) : arr);
  const toConfirm = filt(active.filter((b) => !b.confirmSent)).sort((a, z) => a.startDate.localeCompare(z.startDate));
  const toRemind = filt(active.filter((b) => daysUntil(b) <= REMINDER_WINDOW && !b.confirmed)).sort((a, z) => a.startDate.localeCompare(z.startDate));

  const tplSet = { ...DEFAULT_MESSAGE_TEMPLATES, ...(templates || {}) };
  function itemsSummary(b) {
    return itemDefs.filter((it) => b.items && b.items[it.id]).map((it) => b.items[it.id] + "\u00d7 " + it.name).join(", ");
  }
  function dateLabel(b) {
    const days = daysBetween(b.startDate, b.endDate);
    return days > 1 ? fmtDate(b.startDate) + "\u2013" + fmtDate(b.endDate) : fmtDate(b.startDate);
  }
  function fillTemplate(t, b) {
    const svc = b.serviceType === "delivery" ? "delivery to " + (b.address ? b.address : "your address") : "pickup";
    // Always hedged: an ETA is an estimate, so the customer never reads a hard promise.
    const approx = (v) => (v ? "approximately " + fmtTime(v) : "at a time we'll confirm");
    const map = {
      "{name}": b.name || "",
      "{items}": itemsSummary(b),
      "{date}": dateLabel(b),
      "{service}": svc,
      "{total}": (b.totalCost || 0).toFixed(0),
      "{etaOut}": approx(b.etaOut),
      "{etaBack}": approx(b.etaBack),
    };
    return (t || "").replace(/\{name\}|\{items\}|\{date\}|\{service\}|\{total\}|\{etaOut\}|\{etaBack\}/g, (m) => map[m]);
  }
  const confirmMsg = (b) => fillTemplate(tplSet.confirm, b);
  const remindMsg = (b) => fillTemplate(tplSet.remind, b);
  function sms(b, msg) {
    const phone = (b.phone || "").replace(/[^\d+]/g, "");
    return "sms:" + phone + "?&body=" + encodeURIComponent(msg);
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

  const segs = [
    { id: "confirm", label: "To confirm", count: toConfirm.length },
    { id: "remind", label: "To remind", count: toRemind.length },
    { id: "thank", label: "Thank you", paused: true },
  ];
  const subFor = {
    confirm: "Send right after booking \u2014 restates the details back to the customer.",
    remind: "Bookings within " + REMINDER_WINDOW + " days \u2014 confirm logistics.",
    thank: "Paused \u2014 needs your Google review link.",
  };

  return (
    <div style={{ padding: isMobile ? "14px 16px" : "18px 24px", maxWidth: 720 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.accentDeep, marginBottom: 12 }}>Messages</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {segs.map((sg) => {
          const on = tab === sg.id;
          return (
            <button key={sg.id} onClick={() => setTab(sg.id)}
              style={{ flex: 1, padding: "8px 6px", borderRadius: 4, cursor: "pointer", fontFamily: T.sans, fontSize: isMobile ? 11 : 12, fontWeight: 700,
                border: "1px solid " + (on ? C.accent : C.border),
                background: on ? C.accent : C.surface,
                color: on ? "#fff" : (sg.paused ? C.textMuted : C.textSub) }}>
              {sg.label}{sg.count ? " (" + sg.count + ")" : ""}
            </button>
          );
        })}
      </div>

      <button onClick={() => setPhoneOnly((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 14, padding: "5px 10px", borderRadius: 14, cursor: "pointer", fontFamily: T.sans, fontSize: 11, fontWeight: 600,
          border: "1px solid " + (phoneOnly ? C.accent : C.borderStrong),
          background: phoneOnly ? C.accentSoft : C.surface,
          color: phoneOnly ? C.accent : C.textSub }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, lineHeight: "13px", textAlign: "center", display: "inline-block", fontSize: 10, color: "#fff",
          border: "1px solid " + (phoneOnly ? C.accent : C.borderStrong), background: phoneOnly ? C.accent : "transparent" }}>{phoneOnly ? "\u2713" : ""}</span>
        Only show with phone number
      </button>

      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginBottom: 12 }}>{subFor[tab]}</div>

      {tab === "confirm" && (
        toConfirm.length === 0
          ? <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans }}>{phoneOnly ? "None with a phone number." : "All caught up."}</div>
          : toConfirm.map((b) => card(b, confirmMsg(b), "confirmSent"))
      )}

      {tab === "remind" && (
        toRemind.length === 0
          ? <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans }}>{phoneOnly ? "None with a phone number." : "Nothing due."}</div>
          : toRemind.map((b) => card(b, remindMsg(b), "confirmed"))
      )}

      {tab === "thank" && (
        <div style={{ fontSize: 12, color: C.textMuted, fontFamily: T.sans, lineHeight: 1.5, padding: "6px 0" }}>
          This step is paused until you add a Google review link. Once your Google Business page is live, send me the link and I'll switch it on.
        </div>
      )}
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
  const [invoiceFor, setInvoiceFor] = useState(null);
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
  const [itemDraft, setItemDraft] = useState({ name: "", price: "", inventory: "", category: "" });
  const [itemErr, setItemErr] = useState("");

  const EMPTY_FORM = {
    name: "", salesRep: "", startDate: "", endDate: "",
    items: {}, serviceType: "pickup", deliveryFee: "", address: "",
    discount: "", discountMode: "pct", notes: "", phone: "", email: "",
    etaOut: "", etaBack: "",
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
    if (f.discount !== "") {
      const d = +f.discount;
      if (isNaN(d) || d < 0) e.discount = "Enter a positive number, or leave blank.";
      else if (f.discountMode === "amt") {
        const sub = itemDefs.reduce((s, it) => s + (parseInt(f.items[it.id]) || 0) * it.price, 0)
          + (f.serviceType === "delivery" ? parseFloat(f.deliveryFee) || 0 : 0);
        if (d > sub) e.discount = `Can't discount more than the $${sub.toFixed(2)} subtotal.`;
      } else if (d > 100) e.discount = "A percentage can't be over 100.";
    }
    return e;
  }

  function handleSubmit() {
    const e = validateForm();
    setFormErrors(e);
    if (Object.keys(e).length) return;
    const itemsMap = {};
    itemDefs.forEach((it) => { itemsMap[it.id] = parseInt(form.items[it.id]) || 0; });
    const costs = calcTotal(itemsMap, itemDefs, form.serviceType, form.deliveryFee, form.discount, form.discountMode);
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
      etaOut: form.etaOut || "",
      etaBack: form.etaBack || "",
      discount: parseFloat(form.discount) || 0,
      discountMode: form.discountMode === "amt" ? "amt" : "pct",
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
      discountMode: b.discountMode === "amt" ? "amt" : "pct",
      notes: b.notes || "",
      phone: b.phone || "",
      email: b.email || "",
      etaOut: b.etaOut || "",
      etaBack: b.etaBack || "",
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

  async function setStatus(b, status) {
    setBookings((bs) => bs.map((x) => (x.id === b.id ? { ...x, status } : x)));
    await setBookingStatusDB(b.id, status);
  }
  // Gear has left: delivered to the customer, or collected by them.
  function requestMarkOut(b) { setStatus(b, "out"); }
  // Gear is back. If nothing has been collected yet, ask for payment on the way out.
  function requestMarkReturned(b) {
    if (payments.some((p) => p.bookingId === b.id)) setStatus(b, "done");
    else setDoneDialog({ booking: b, complete: true });
  }
  // Undo a mis-tap: out -> active, done -> out. Never touches recorded payments.
  function requestInvoice(b) { setInvoiceFor(b); }
  // Claims a number once and keeps it. Returns false so the overlay can say so.
  async function issueInvoiceNo(b) {
    if (b.invoiceNo != null) return true;
    const res = await claimInvoiceNoDB(b.id);
    if (!res) return false;
    setBookings((bs) => bs.map((x) => (x.id === b.id ? { ...x, ...res } : x)));
    setInvoiceFor((cur) => (cur && cur.id === b.id ? { ...cur, ...res } : cur));
    return true;
  }

  function requestStepBack(b) { setStatus(b, bStatus(b) === "done" ? "out" : "active"); }
  // Payment on its own, at any stage — leaves the booking's status alone.
  function requestRecordPayment(b) { setDoneDialog({ booking: b, complete: false }); }

  async function confirmMarkDone({ amount, collectedBy }) {
    const d = doneDialog;
    if (!d || !d.booking) return;
    const b = d.booking;
    const payment = {
      id: genId(),
      bookingId: b.id,
      amount,
      collectedBy,
      collectedAt: new Date().toISOString(),
      note: "",
    };
    setPayments((p) => [...p, payment]);
    if (d.complete) setBookings((bs) => bs.map((x) => (x.id === b.id ? { ...x, status: "done" } : x)));
    setDoneDialog(null);
    await Promise.all([
      addPaymentDB(payment),
      ...(d.complete ? [setBookingStatusDB(b.id, "done")] : []),
    ]);
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
    ? calcTotal(formItemsMap, itemDefs, form.serviceType, form.deliveryFee, form.discount, form.discountMode)
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
    .filter((b) => (b.status || "active") !== "done")
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
  const remindersProps = { isMobile, bookings, itemDefs, onMarkSent: markSent, templates: settings.messageTemplates };
  const _today0 = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  const pendingReminders = bookings.filter((b) => {
    if ((b.status || "active") !== "active") return false;
    const d = Math.round((new Date(b.startDate + "T00:00:00") - _today0) / 86400000);
    if (d < 0) return false;
    return !b.confirmSent || (d <= 3 && !b.confirmed);
  }).length;
  const bookingFormProps = {
    isMobile, itemDefs, categories: settingsCategories(settings), startDate, endDate, bookings,
    form, setForm, formErrors, successMsg,
    editingBookingId, cancelEdit, handleSubmit,
    rentalDays, getAvail, preview, formItemsMap,
  };
  const calendarProps = {
    isMobile, months, safeMonth, setCalMonth,
    startDate, endDate, bookings, itemDefs, dayStrain, strainBg,
    vacations,  // NEW
  };
  const paidIds = useMemo(() => new Set(payments.map((p) => p.bookingId)), [payments]);
  const invoiceBooking = invoiceFor ? (bookings.find((b) => b.id === invoiceFor.id) || invoiceFor) : null;
  const listProps = {
    isMobile, bookings, itemDefs,
    search, setSearch, filterService, setFilterService,
    filterStart, setFilterStart, filterEnd, setFilterEnd,
    filterStatus, setFilterStatus,
    startEditBooking, requestRemoveBooking, exportCSV,
    requestMarkOut, requestMarkReturned, requestRecordPayment, requestStepBack, requestInvoice, paidIds,
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
        {invoiceBooking && (
          <InvoiceOverlay booking={invoiceBooking} business={businessInfo(settings)}
            itemDefs={itemDefs} categories={settingsCategories(settings)} payments={payments}
            onClose={() => setInvoiceFor(null)} onIssue={issueInvoiceNo} />
        )}
        <MarkDoneDialog
          open={!!doneDialog}
          booking={doneDialog?.booking}
          complete={!!doneDialog?.complete}
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
      {invoiceBooking && (
        <InvoiceOverlay booking={invoiceBooking} business={businessInfo(settings)}
          itemDefs={itemDefs} categories={settingsCategories(settings)} payments={payments}
          onClose={() => setInvoiceFor(null)} onIssue={issueInvoiceNo} />
      )}
      <MarkDoneDialog
        open={!!doneDialog}
        booking={doneDialog?.booking}
        complete={!!doneDialog?.complete}
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
