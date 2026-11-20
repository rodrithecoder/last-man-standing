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
  const alex = result.nextJobs.find((job) => job.name === "Alex");
  const sam = result.nextJobs.find((job) => job.name === "Sam");
  assert.equal(alex.salesRep, "Lucia");
  assert.equal(alex.type, "Return");
  assert.equal(sam.type, "Pickup");
  assert.equal(result.nextJobs.some((job) => job.status === "out"), false);
  assert.equal(result.outJobs[0].name, "Old");
  assert.equal(result.outJobs[0].overdue, true);
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

test("rental marked out appears as an out return, not a pending pickup", () => {
  const bookings = [
    { id: "out", name: "Sergio pickup", startDate: "2026-11-20", endDate: "2026-11-22",
      serviceType: "pickup", pickupLocation: "sergio", status: "out", totalCost: 200 },
    { id: "waiting", name: "Next rental", startDate: "2026-11-21", endDate: "2026-11-23",
      serviceType: "delivery", status: "active", totalCost: 100 },
  ];
  const result = buildWeeklyWidgetSnapshot(bookings, [], new Date(2026,10,20,12));
  const job = result.nextJobs.find((j) => j.name === "Sergio pickup");
  assert.equal(result.nextJobs.filter((j) => j.name === "Sergio pickup").length, 1);
  assert.equal(job.type, "Return");
  assert.equal(job.status, "out");
  assert.equal(job.pickupLocation, "sergio");
  assert.equal(job.overdue, false);
  assert.equal(result.nextJobs.find((j) => j.name === "Next rental").status, "active");
});
test("overdue out rental remains visible and flagged", () => {
  const result = buildWeeklyWidgetSnapshot([
    { id: "late", name: "Late", startDate: "2026-11-15", endDate: "2026-11-18",
      status: "out", serviceType: "pickup", totalCost: 100 },
  ], [], new Date(2026,10,20,12));
  assert.equal(result.nextJobs.length, 0);
  assert.equal(result.outJobs[0].status, "out");
  assert.equal(result.outJobs[0].overdue, true);
  assert.equal(result.outJobs[0].type, "Return");
  assert.equal(result.counts.overdue, 1);
});

test("Upcoming excludes Out while the Out tab lists active outstanding equipment", () => {
  const bookings = [
    {id:"p1",name:"Pending",startDate:"2026-11-21",endDate:"2026-11-22",
     serviceType:"pickup",status:"active",totalCost:100},
    {id:"o1",name:"Already out",startDate:"2026-11-19",endDate:"2026-11-23",
     serviceType:"pickup",status:"out",pickupLocation:"sergio",totalCost:100},
    {id:"late",name:"Late return",startDate:"2026-11-15",endDate:"2026-11-18",
     serviceType:"delivery",status:"out",totalCost:100},
  ];
  const result=buildWeeklyWidgetSnapshot(bookings,[],new Date(2026,10,20,12));
  assert.equal(result.outCount,2);
  assert.equal(result.outJobs.length,2);
  assert.equal(result.outJobs[0].name,"Late return");
  assert.equal(result.outJobs[0].overdue,true);
  assert.equal(result.outJobs[1].pickupLocation,"sergio");
  assert.equal(result.nextJobs.some(j=>j.status==="out"),false);
  assert.equal(result.nextJobs[0].name,"Pending");
});
