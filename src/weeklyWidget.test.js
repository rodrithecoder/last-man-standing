import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyWidgetSnapshot, mondayToSunday, dollar, summarizeRentalItems } from "./weeklyWidget.js";

test("Monday–Sunday boundaries remain local and cross months", () => {
  assert.deepEqual(mondayToSunday(new Date(2026, 10, 19, 9)), {
    start: "2026-11-16", end: "2026-11-22", today: "2026-11-19",
  });
  assert.deepEqual(mondayToSunday(new Date(2026, 11, 1)), {
    start: "2026-11-30", end: "2026-12-06", today: "2026-12-01",
  });
});
test("weekly snapshot accounts for partial payments and overdue returns", () => {
  const bookings = [
    { id: "1", name: "Alex", startDate: "2026-11-17", endDate: "2026-11-20",
      serviceType: "delivery", salesRep: "Lucia", totalCost: 1250.75, status: "active" },
    { id: "2", name: "Sam", startDate: "2026-11-22", endDate: "2026-11-23",
      serviceType: "pickup", totalCost: 99.99, status: "active" },
    { id: "3", name: "Old", startDate: "2026-11-11", endDate: "2026-11-15",
      serviceType: "pickup", totalCost: 500, status: "out" },
    { id: "4", name: "Done", startDate: "2026-11-18", endDate: "2026-11-19",
      serviceType: "delivery", totalCost: 1000, status: "done" },
  ];
  const payments = [{ bookingId: "1", amount: 250.25 },
    { bookingId: "2", amount: 100 }];
  const result = buildWeeklyWidgetSnapshot(bookings, payments, new Date(2026, 10, 19, 12));
  assert.deepEqual(result.counts, { rentals: 2, deliveries: 1, returns: 1, overdue: 1 });
  assert.equal(result.expectedCollections, 1000.5);
  assert.equal(result.expectedCollectionsLabel, "$1,001");
  assert.equal(result.nextJobs[0].name, "Alex");
  assert.equal(result.nextJobs[0].salesRep, "Lucia");
  assert.equal(result.nextJobs[0].type, "Return");
  assert.equal(result.nextJobs[1].type, "Pickup");
  assert.equal(result.nextJobs[1].name, "Sam");
});
test("natural whole-dollar formatting with commas", () => {
  assert.equal(dollar(11993), "$11,993");
  assert.equal(dollar(349.49), "$349");
  assert.equal(dollar(999.99), "$1,000");
});

test("rental item summary keeps quantities, first two names, and remaining count", () => {
  const booking = { items: { chairs: 10, cake: 1, round: 1, unused: 0 } };
  const inventory = [
    { id: "chairs", name: "Kids Chairs" },
    { id: "cake", name: "Cake Stand" },
    { id: "round", name: "Round Backdrop" },
    { id: "unused", name: "Towers" },
  ];
  assert.deepEqual(summarizeRentalItems(booking, inventory), {
    items: ["10× Kids Chairs", "1× Cake Stand"],
    moreCount: 1,
  });
  const result = buildWeeklyWidgetSnapshot([
    { id: "example", name: "Alex", startDate: "2026-11-20", endDate: "2026-11-21",
      status: "active", totalCost: 399, items: booking.items },
  ], [], new Date(2026, 10, 20, 12), inventory);
  assert.deepEqual(result.nextJobs[0].items, ["10× Kids Chairs", "1× Cake Stand"]);
  assert.equal(result.nextJobs[0].moreCount, 1);
  assert.deepEqual(summarizeRentalItems({ items: {} }, inventory), { items: [], moreCount: 0 });
});

test("pickup location appears in pickup and return jobs, not deliveries", () => {
  const bookings = [
    { id: "p1", name: "Pickup", startDate: "2026-11-20", endDate: "2026-11-21",
      pickupLocation: "sergio", serviceType: "pickup", status: "active", totalCost: 100 },
    { id: "d1", name: "Delivery", startDate: "2026-11-20", endDate: "2026-11-22",
      pickupLocation: "rodri", serviceType: "delivery", status: "active", totalCost: 50 },
  ];
  const result = buildWeeklyWidgetSnapshot(bookings, [], new Date(2026, 10, 20, 12));
  const pickup = result.nextJobs.find((j) => j.name === "Pickup" && j.type === "Pickup");
  const delivery = result.nextJobs.find((j) => j.name === "Delivery");
  const returned = result.nextJobs.find((j) => j.name === "Pickup" && j.type === "Return");
  assert.equal(pickup.pickupLocation, "sergio");
  assert.equal(delivery.pickupLocation, "");
  assert.equal(returned.pickupLocation, "sergio");
});
