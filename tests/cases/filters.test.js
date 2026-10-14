/*!
 * Filters: the year range, the independent role toggles and focus mode.
 * evaluateRow() is exactly what the content script calls for every row.
 */

"use strict";

const SH = require("../../src/content.js");
const harness = require("../harness.js");

const { describe, test, equal, deepEqual } = harness;

const ALL_ON = {
  first: true,
  cofirst: true,
  corresponding: true,
  second: true,
  last: true,
  middle: true,
};

function state(patch) {
  return {
    enabledRoles: { ...ALL_ON },
    focusMode: false,
    years: { start: "", end: "" },
    ...patch,
  };
}

function row(roles, year, citations) {
  const flags = { first: false, cofirst: false, corresponding: false, second: false, last: false, middle: false };
  for (const role of roles) flags[role] = true;
  return { roles: flags, year, citations: citations === undefined ? 0 : citations };
}

describe("filters");

test("an unbounded year range keeps everything, dated or not", () => {
  equal(SH.isYearInRange(2024, { start: "", end: "" }), true);
  equal(SH.isYearInRange(null, { start: "", end: "" }), true);
  equal(SH.isYearInRange(null, { start: null, end: null }), true);
});

test("a bounded year range hides undated papers", () => {
  equal(SH.isYearInRange(null, { start: "2020", end: "" }), false);
  equal(SH.isYearInRange(null, { start: "", end: "2024" }), false);
});

test("start, end and both bounds are inclusive", () => {
  equal(SH.isYearInRange(2020, { start: "2020", end: "" }), true);
  equal(SH.isYearInRange(2019, { start: "2020", end: "" }), false);
  equal(SH.isYearInRange(2024, { start: "", end: "2024" }), true);
  equal(SH.isYearInRange(2025, { start: "", end: "2024" }), false);
  equal(SH.isYearInRange(2022, { start: "2020", end: "2024" }), true);
  equal(SH.isYearInRange(2025, { start: "2020", end: "2024" }), false);
  equal(SH.isYearInRange(2019, { start: "2020", end: "2024" }), false);
});

test("strings from the option selects behave like numbers", () => {
  equal(SH.isYearInRange("2024", { start: "2024", end: "2024" }), true);
  equal(SH.isYearInRange(undefined, { start: "2024", end: "" }), false);
});

test("role toggles are independent and a row may match several", () => {
  const rolesOf = (list) => row(list, 2024).roles;
  equal(SH.matchesRoleFilter(rolesOf(["second"]), { ...ALL_ON, second: false }), false);
  equal(SH.matchesRoleFilter(rolesOf(["second", "corresponding"]), { ...ALL_ON, second: false }), true);
  equal(SH.matchesRoleFilter(rolesOf(["cofirst"]), { ...ALL_ON, cofirst: false, corresponding: false }), false);
  equal(SH.matchesRoleFilter(rolesOf(["cofirst"]), { ...ALL_ON, cofirst: true }), true);
  equal(SH.matchesRoleFilter(rolesOf([]), ALL_ON), false);
  const noneEnabled = { first: false, cofirst: false, corresponding: false, second: false, last: false, middle: false };
  equal(SH.matchesRoleFilter(rolesOf(["first"]), noneEnabled), false);
  equal(SH.matchesRoleFilter(rolesOf(["first"]), undefined), false);
  equal(SH.matchesRoleFilter(undefined, ALL_ON), false);
});

test("focus mode hides everything that is not highlighted", () => {
  const rowCofirst = row(["cofirst"], 2025, 7);
  const rowMiddle = row(["middle"], 2025, 3);

  deepEqual(SH.evaluateRow(rowCofirst, state({ focusMode: false })), {
    inRange: true,
    highlighted: true,
    visible: true,
  });
  deepEqual(SH.evaluateRow(rowMiddle, state({ focusMode: false })), {
    inRange: true,
    highlighted: true,
    visible: true,
  });

  // With the middle role switched off, focus mode hides that row only.
  const focused = state({ focusMode: true, enabledRoles: { ...ALL_ON, middle: false } });
  deepEqual(SH.evaluateRow(rowCofirst, focused), {
    inRange: true,
    highlighted: true,
    visible: true,
  });
  deepEqual(SH.evaluateRow(rowMiddle, focused), {
    inRange: true,
    highlighted: false,
    visible: false,
  });
});

test("focus mode never re-shows a row outside the year range", () => {
  const verdict = SH.evaluateRow(
    row(["cofirst"], 2019, 5),
    state({ focusMode: false, years: { start: "2020", end: "" } }),
  );
  deepEqual(verdict, { inRange: false, highlighted: false, visible: false });
});

test("metrics count only the rows inside the year range", () => {
  const rows = [
    row(["first"], 2020, 10),
    row(["cofirst"], 2024, 30),
    row(["middle"], 2026, 1),
  ];
  const current = state({ years: { start: "2024", end: "" } });
  const inRange = rows.filter((entry) => SH.isYearInRange(entry.year, current.years));
  equal(inRange.length, 2, "two papers are inside 2024+");
  const summary = SH.summarizePapers(inRange);
  equal(summary.papers, 2);
  equal(summary.citations, 31);
  // sorted 30,1 => the largest k with the k-th paper at >= k citations is 1
  equal(summary.hIndex, 1);
  equal(summary.i10Index, 1);
});
