import { useState, useEffect, useMemo, useCallback } from "react";

// ─── Storage Keys ─────────────────────────────────────────────────────────────
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
};

// ─── Persistence ──────────────────────────────────────────────────────────────
function load(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
}
function save(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function fmtDate(ds) {
  if (!ds) return "";
  const [y, m, d] = ds.split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function fmtDateShort(ds) {
  if (!ds) return "";
  const [y, m, d] = ds.split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function getDIM(y, m) {
  return new Date(y, m + 1, 0).getDate();
}
function daysBetween(s, e) {
  return (
    Math.round(
      (new Date(e + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000
    ) + 1
  );
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
// FIX: Build local YYYY-MM-DD without going through toISOString (which uses UTC
// and can shift the date by a day in non-UTC timezones).
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
      .filter(
        (b) => b.id !== excludeId && b.startDate <= ds && b.endDate >= ds
      )
      .reduce((s, b) => s + (b.items?.[itemId] || 0), 0);
    max = Math.max(max, used);
    cur.setDate(cur.getDate() + 1);
  }
  return max;
}
function calcTotal(itemsMap, itemDefs, svcType, deliveryFee, discount) {
  const itemsTotal = itemDefs.reduce(
    (s, it) => s + (itemsMap[it.id] || 0) * it.price,
    0
  );
  const fee = svcType === "delivery" ? parseFloat(deliveryFee) || 0 : 0;
  const sub = itemsTotal + fee;
  const disc = sub * ((parseFloat(discount) || 0) / 100);
  return {
    itemsTotal,
    deliveryFee: fee,
    discountAmount: disc,
    totalCost: sub - disc,
  };
}

// CSV export helper
function bookingsToCSV(bookings, itemDefs) {
  const headers = [
    "Customer",
    "Sales Rep",
    "Start",
    "End",
    "Days",
    ...itemDefs.map((i) => i.name),
    "Service",
    "Address",
    "Subtotal",
    "Delivery Fee",
    "Discount %",
    "Discount $",
    "Total",
    "Notes",
  ];
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = bookings.map((b) =>
    [
      b.name,
      b.salesRep,
      b.startDate,
      b.endDate,
      b.days,
      ...itemDefs.map((i) => b.items?.[i.id] || 0),
      b.serviceType,
      b.address || "",
      (b.itemsTotal || 0).toFixed(2),
      (b.deliveryFee || 0).toFixed(2),
      b.discount || 0,
      (b.discountAmount || 0).toFixed(2),
      b.totalCost.toFixed(2),
      b.notes || "",
    ]
      .map(escape)
      .join(",")
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
// Palette inspired by the Last Man Standing brand: forest green, sunshine
// yellow, brick red. Green leads, yellow accents, red for danger/discounts.
const C = {
  bg: "#fafaf6",
  surface: "#ffffff",
  border: "#e4e4dc",
  borderStrong: "#cdcdbf",
  text: "#1c2620",
  textSub: "#5e6a62",
  textMuted: "#9aa39c",
  accent: "#2d6a4f",         // forest green (primary)
  accentDeep: "#1f4d39",     // deeper green for hover/header
  accentSoft: "#e3f0e7",     // green tint for surfaces
  sunshine: "#fbcf3c",       // brand yellow
  sunshineSoft: "#fff4cc",   // soft yellow for highlights
  brick: "#b73c2a",          // brand red (danger/discount)
  brickSoft: "#fbe7e3",
  danger: "#b73c2a",
  success: "#2d6a4f",
  warning: "#7a5800",
  cap50: "#cfe9d6",          // <50% — soft green
  cap80: "#ffe89a",          // 50–99% — warm yellow
  cap100: "#f5c2b8",         // full — soft brick
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
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        color: C.textMuted,
        textTransform: "uppercase",
        fontFamily: T.sans,
        marginBottom: 5,
        fontWeight: 500,
      }}
    >
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
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: T.sans }}>
          {hint}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: C.danger, marginTop: 4, fontFamily: T.sans }}>
          {error}
        </div>
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

// Confirm dialog
function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          padding: "20px 22px",
          maxWidth: 380,
          width: "100%",
          fontFamily: T.sans,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.textSub, marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
          <Btn
            onClick={onConfirm}
            variant={danger ? "danger" : "primary"}
            style={danger ? { background: C.danger, color: C.surface, borderColor: C.danger } : undefined}
          >
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
  settingsPanelProps,
}) {
  const inputStyle = inp(isMobile);

  return (
    <div style={{ padding: isMobile ? "16px" : "16px 16px 24px" }}>
      <SettingsPanel {...settingsPanelProps} />

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

// ─── Calendar ─────────────────────────────────────────────────────────────────
function CalendarView({
  isMobile, months, safeMonth, setCalMonth,
  startDate, endDate, bookings, itemDefs, dayStrain, strainBg,
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
  startEditBooking, requestRemoveBooking, exportCSV,
}) {
  const inputStyle = inp(isMobile);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (s) {
        const hay = `${b.name} ${b.salesRep} ${b.notes || ""} ${b.address || ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (filterService !== "all" && b.serviceType !== filterService) return false;
      if (filterStart && b.endDate < filterStart) return false;
      if (filterEnd && b.startDate > filterEnd) return false;
      return true;
    });
  }, [bookings, search, filterService, filterStart, filterEnd]);

  const totalRev = filtered.reduce((s, b) => s + b.totalCost, 0);
  const filtersActive = search || filterService !== "all" || filterStart || filterEnd;

  return (
    <div style={{ padding: isMobile ? "14px" : "20px 24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <Label>Search</Label>
          <input style={inputStyle} placeholder="Customer, rep, notes…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
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
            setSearch(""); setFilterService("all"); setFilterStart(""); setFilterEnd("");
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
              {filtered.map((b) => (
                <div key={b.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 3, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.text, fontFamily: T.sans }}>{b.name}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, marginTop: 2 }}>
                        {b.salesRep} · {fmtDateShort(b.startDate)} – {fmtDateShort(b.endDate)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn small variant="ghost" onClick={() => startEditBooking(b)}>Edit</Btn>
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: C.textMuted, fontFamily: T.sans, background: C.bg, border: `1px solid ${C.border}`, padding: "2px 8px", borderRadius: 2 }}>
                      {b.serviceType === "delivery" ? "Delivery" : "Pickup"}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: T.mono }}>${b.totalCost.toFixed(2)}</span>
                  </div>
                </div>
              ))}
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
                  {filtered.map((b, i) => (
                    <tr key={b.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.surface : C.bg }}>
                      <td style={{ padding: "9px 10px", fontWeight: 600, color: C.text }}>
                        {b.name}
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
                        <Btn small variant="ghost" onClick={() => startEditBooking(b)}>Edit</Btn>
                        <Btn small variant="ghost" onClick={() => requestRemoveBooking(b)} style={{ color: C.danger }}>Remove</Btn>
                      </td>
                    </tr>
                  ))}
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

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ isMobile, bookings, totalRevenue }) {
  return (
    <div
      style={{
        background: C.accentDeep,
        borderBottom: `3px solid ${C.sunshine}`,
        padding: isMobile ? "12px 16px" : "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        color: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, minWidth: 0 }}>
        {/* Logo mark: yellow circle with chair glyph */}
        <div
          style={{
            width: isMobile ? 34 : 40,
            height: isMobile ? 34 : 40,
            borderRadius: "50%",
            background: C.sunshine,
            color: C.accentDeep,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: isMobile ? 18 : 22,
            fontWeight: 800,
            flexShrink: 0,
            boxShadow: "0 1px 0 rgba(0,0,0,0.15)",
          }}
          aria-label="Last Man Standing logo"
        >
          🪑
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: isMobile ? 15 : 19,
              fontWeight: 800,
              fontFamily: T.sans,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              lineHeight: 1.1,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Last Man Standing
          </div>
          {!isMobile && (
            <div
              style={{
                fontSize: 11,
                color: C.sunshineSoft,
                fontFamily: T.sans,
                marginTop: 2,
                fontStyle: "italic",
                opacity: 0.95,
              }}
            >
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

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const width = useWindowWidth();
  const isMobile = width < 640;

  const [bookings, setBookings] = useState(() => load(SK_BOOKINGS, []));
  const [settings, setSettings] = useState(() => {
    const s = load(SK_SETTINGS, DEFAULT_SETTINGS);
    if (!s.items) s.items = DEFAULT_ITEMS;
    return s;
  });

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
    discount: "", notes: "",
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

  const saveBookings = useCallback((b) => {
    setBookings(b);
    save(SK_BOOKINGS, b);
  }, []);
  const saveSettings = useCallback((s) => {
    setSettings(s);
    save(SK_SETTINGS, s);
  }, []);

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
      discount: parseFloat(form.discount) || 0,
      ...costs,
    };

    let updated;
    if (editingBookingId) {
      updated = bookings.map((b) => (b.id === editingBookingId ? { ...b, ...baseBooking } : b));
      setSuccessMsg("Booking updated.");
    } else {
      updated = [...bookings, { id: genId(), ...baseBooking }];
      setSuccessMsg("Booking saved.");
    }
    updated.sort((a, b) => a.startDate.localeCompare(b.startDate));
    saveBookings(updated);
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
        saveBookings(bookings.filter((x) => x.id !== b.id));
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

  const formItemsMap = {};
  itemDefs.forEach((it) => { formItemsMap[it.id] = parseInt(form.items[it.id]) || 0; });
  const anyItem = itemDefs.some((it) => formItemsMap[it.id] > 0);
  const preview = anyItem
    ? calcTotal(formItemsMap, itemDefs, form.serviceType, form.deliveryFee, form.discount)
    : null;
  const totalRevenue = bookings.reduce((s, b) => s + b.totalCost, 0);

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
  const bookingFormProps = {
    isMobile, itemDefs, startDate, endDate, bookings,
    form, setForm, formErrors, successMsg,
    editingBookingId, cancelEdit, handleSubmit,
    rentalDays, getAvail, preview, formItemsMap, settingsPanelProps,
  };
  const calendarProps = {
    isMobile, months, safeMonth, setCalMonth,
    startDate, endDate, bookings, itemDefs, dayStrain, strainBg,
  };
  const listProps = {
    isMobile, bookings, itemDefs,
    search, setSearch, filterService, setFilterService,
    filterStart, setFilterStart, filterEnd, setFilterEnd,
    startEditBooking, requestRemoveBooking, exportCSV,
  };

  if (isMobile) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, paddingBottom: 64 }}>
        <Header isMobile={isMobile} bookings={bookings} totalRevenue={totalRevenue} />
        {mobileTab === "calendar" && <CalendarView {...calendarProps} />}
        {mobileTab === "list" && <BookingsList {...listProps} />}
        {mobileTab === "form" && <BookingForm {...bookingFormProps} />}
        <TabBar bottom active={mobileTab} onChange={setMobileTab}
          tabs={[
            { id: "calendar", label: "Calendar", icon: "▦" },
            { id: "list", label: "Bookings", icon: "≡" },
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
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column" }}>
      <Header isMobile={isMobile} bookings={bookings} totalRevenue={totalRevenue} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ width: 340, minWidth: 300, background: C.bg, borderRight: `1px solid ${C.border}`, overflowY: "auto" }}>
          <BookingForm {...bookingFormProps} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.surface }}>
          <TabBar active={desktopTab} onChange={setDesktopTab}
            tabs={[{ id: "calendar", label: "Calendar" }, { id: "list", label: "Bookings" }]} />
          <div style={{ flex: 1, overflowY: "auto" }}>
            {desktopTab === "calendar" && <CalendarView {...calendarProps} />}
            {desktopTab === "list" && <BookingsList {...listProps} />}
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
    </div>
  );
}
