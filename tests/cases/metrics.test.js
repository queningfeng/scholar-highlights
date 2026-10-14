/*!
 * Metrics: h-index, i10-index, papers, citations and papers-per-year against
 * hand-computed fixtures (including the exact numbers of the sample profile).
 */

"use strict";

const SH = require("../../src/content.js");
const harness = require("../harness.js");
const fixture = require("../fixtures/metric-cases.json");
const expectedProfile = require("../fixtures/expected-profile.json");

const { describe, test, equal, deepEqual } = harness;

describe("metrics");

for (const testCase of fixture.cases) {
  test(testCase.note, () => {
    const summary = SH.summarizePapers(testCase.papers);
    equal(summary.papers, testCase.expect.papers, "papers");
    equal(summary.citations, testCase.expect.citations, "citations");
    equal(summary.hIndex, testCase.expect.hIndex, "h-index");
    equal(summary.i10Index, testCase.expect.i10Index, "i10-index");
    deepEqual(summary.perYear, testCase.expect.perYear, "papers per year");
  });
}

test("the fixture profile's own totals are consistent with its rows", () => {
  const rows = expectedProfile.rows;
  const summary = SH.summarizePapers(rows);
  equal(summary.papers, expectedProfile.initialRowCount);
  equal(summary.citations, expectedProfile.sidebarTotals.citations);
  equal(summary.hIndex, expectedProfile.sidebarTotals.hIndex);
  equal(summary.i10Index, expectedProfile.sidebarTotals.i10Index);
});

test("computeIndices does not mutate its input", () => {
  const counts = [3, 0, 6, 1, 5];
  const before = [...counts];
  SH.computeIndices(counts);
  deepEqual(counts, before);
});

test("buildYearSeries fills the gaps between the first and the last year", () => {
  const series = SH.buildYearSeries({ "2024": 2 }, { "2020": 1, "2024": 3 });
  deepEqual(series, [
    { year: 2020, total: 1, highlighted: 0 },
    { year: 2021, total: 0, highlighted: 0 },
    { year: 2022, total: 0, highlighted: 0 },
    { year: 2023, total: 0, highlighted: 0 },
    { year: 2024, total: 3, highlighted: 2 },
  ]);
  deepEqual(SH.buildYearSeries({}, {}), []);
});

test("the highlighted share of a year never exceeds its total", () => {
  const totals = { "2020": 2, "2021": 0, "2022": 1 };
  const highlighted = { "2020": 1, "2022": 1 };
  const series = SH.buildYearSeries(highlighted, totals);
  deepEqual(
    series.map((entry) => entry.year),
    [2020, 2021, 2022],
  );
  deepEqual(
    series.map((entry) => [entry.highlighted, entry.total]),
    [
      [1, 2],
      [0, 0],
      [1, 1],
    ],
  );
});

test("the expanded fixture profile has the hand-computed totals", () => {
  const rows = [...expectedProfile.rows, ...expectedProfile.page2Rows];
  const summary = SH.summarizePapers(rows);
  equal(summary.papers, expectedProfile.allRows.papers);
  equal(summary.citations, expectedProfile.allRows.citations);
  equal(summary.hIndex, expectedProfile.allRows.hIndex);
  equal(summary.i10Index, expectedProfile.allRows.i10Index);
});

test("per-year totals from the expanded fixture profile add up to 20 papers", () => {
  const perYear = {};
  for (const row of [...expectedProfile.rows, ...expectedProfile.page2Rows]) {
    perYear[String(row.year)] = (perYear[String(row.year)] || 0) + 1;
  }
  const total = Object.values(perYear).reduce((sum, count) => sum + count, 0);
  equal(total, expectedProfile.expandedRowCount);
  const series = SH.buildYearSeries(perYear, perYear);
  equal(series.length, 8, "2019 through 2026");
  equal(series[0].year, 2019);
  equal(series[series.length - 1].year, 2026);
});
