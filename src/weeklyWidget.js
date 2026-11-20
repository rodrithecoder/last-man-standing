// Monday–Sunday rental widget snapshot. Calculations use exact stored amounts.
// Only the formatted display uses whole Canadian dollars.
export function localYmd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
export function mondayToSunday(now = new Date()) {
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(local);
  monday.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: localYmd(monday), end: localYmd(sunday), today: localYmd(local) };
}
export const dollar = (number) => "$" + new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 0, minimumFractionDigits: 0,
}).format(Number(number) || 0);

// Match booking.items (item ID → quantity) to the current inventory names.
export function summarizeRentalItems(booking, itemDefs = []) {
  const quantities = booking?.items || {};
  const namesById = new Map(itemDefs.map((it) => [String(it.id), it.name]));
  const selected = Object.entries(quantities)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([id, quantity]) => ({
      name: String(namesById.get(String(id)) || "Item").trim() || "Item",
      quantity: Number(quantity),
    }));
  return {
    items: selected.slice(0, 2).map(({ name, quantity }) => `${quantity}× ${name}`),
    moreCount: Math.max(0, selected.length - 2),
  };
}

export function buildWeeklyWidgetSnapshot(bookings = [], payments = [], now = new Date(), itemDefs = []) {
  const { start, end, today } = mondayToSunday(now);
  const paymentsByBooking = new Map();
  for (const p of payments) {
    paymentsByBooking.set(p.bookingId, (paymentsByBooking.get(p.bookingId) || 0) + (Number(p.amount) || 0));
  }
  const active = bookings.filter((b) => (b.status || "active") !== "done");
  const isThisWeek = (day) => day >= start && day <= end;
  const thisWeek = active.filter((b) => isThisWeek(b.startDate));
  const futureJobs = [];
  for (const b of active) {
    if (b.startDate >= today) futureJobs.push({
      id: b.id, date: b.startDate, time: b.etaOut || "",
      ...summarizeRentalItems(b, itemDefs),
      name: b.name || "Rental", salesRep: b.salesRep || "", type: b.serviceType === "delivery" ? "Delivery" : "Pickup",
      order: 0,
    });
    if (b.endDate >= today) futureJobs.push({
      id: b.id, date: b.endDate, time: b.etaBack || "",
      ...summarizeRentalItems(b, itemDefs),
      name: b.name || "Rental", salesRep: b.salesRep || "", type: "Return", order: 1,
    });
  }
  futureJobs.sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)) || a.order - b.order
  );
  const outstanding = thisWeek.reduce((sum, b) =>
    sum + Math.max(0, (Number(b.totalCost) || 0) - (paymentsByBooking.get(b.id) || 0)), 0
  );
  return {
    schemaVersion: 1,
    weekStart: start, weekEnd: end, generatedAt: now.toISOString(),
    counts: {
      rentals: thisWeek.length,
      deliveries: thisWeek.filter((b) => b.serviceType === "delivery").length,
      returns: active.filter((b) => isThisWeek(b.endDate)).length,
      overdue: active.filter((b) => b.status === "out" && b.endDate < today).length,
    },
    expectedCollections: outstanding,
    expectedCollectionsLabel: dollar(outstanding),
    // Restrict customer details to upcoming jobs; widget stores only 3 rows.
    nextJobs: futureJobs.slice(0, 3),
  };
}
