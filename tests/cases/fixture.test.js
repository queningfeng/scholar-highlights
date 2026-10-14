/*!
 * Fixture-level integration: extract the byline, citation count and year of
 * every row of tests/fixtures/sample-profile.html straight out of the HTML
 * text and push them through the production classifier.
 *
 * Plain Node has no DOM, so the fixture is read textually here; the same
 * numbers are asserted against the rendered page by tools/verify-chrome.mjs,
 * which runs the real content script in headless Chrome.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const SH = require("../../src/content.js");
const harness = require("../harness.js");
const expected = require("../fixtures/expected-profile.json");

const { describe, test, equal, deepEqual, ok } = harness;

const HTML_PATH = path.join(__dirname, "..", "fixtures", "sample-profile.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

function firstMatch(text, pattern) {
  const match = pattern.exec(text);
  return match ? match[1].trim() : "";
}

function decode(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** The 12 rows Scholar serves with the first page. */
function readInitialRows() {
  const start = html.indexOf('<tbody id="gsc_a_b">');
  const end = html.indexOf("</tbody>", start);
  ok(start > 0 && end > start, "the fixture must contain #gsc_a_b");
  return html
    .slice(start, end)
    .split('<tr class="gsc_a_tr">')
    .slice(1)
    .map((block) => ({
      title: decode(firstMatch(block, /<a class="gsc_a_at" href="#">([\s\S]*?)<\/a>/)),
      authors: decode(firstMatch(block, /<div class="gs_gray">([\s\S]*?)<\/div>/)),
      citations: Number(firstMatch(block, /<a class="gsc_a_ac[^"]*" href="#">([0-9]+)<\/a>/) || 0),
      year: Number(firstMatch(block, /<span class="gsc_a_h[^"]*">([0-9]{4})<\/span>/)) || null,
    }));
}

/** The rows the fixture's "Show more" simulation appends. */
function readSecondPageRows() {
  const start = html.indexOf("var nextPage = [");
  ok(start > 0, "the fixture must contain the pagination simulation");
  const end = html.indexOf("];", start);
  const block = html.slice(start, end);
  const pattern = /\["([^"]*)", "([^"]*)", "([^"]*)", "([^"]*)", "([^"]*)"\]/g;
  const rows = [];
  let match = pattern.exec(block);
  while (match) {
    rows.push({
      title: decode(match[1]),
      authors: decode(match[2]),
      citations: Number(match[4]),
      year: Number(match[5]),
    });
    match = pattern.exec(block);
  }
  return rows;
}

function classify(authors) {
  return SH.classifyPaper({
    title: "irrelevant title",
    authors,
    profileName: expected.profileName,
    aliases: expected.aliases,
    overrides: {},
  });
}

const initialRows = readInitialRows();
const secondPageRows = readSecondPageRows();
const allRows = [...initialRows, ...secondPageRows];

describe("sample profile fixture");

test("the fixture has the promised DOM landmarks", () => {
  for (const landmark of [
    'id="gsc_prf"',
    'id="gsc_prf_i"',
    'id="gsc_prf_in"',
    "gsc_prf_il",
    'id="gsc_rsb_st"',
    'id="gsc_rsb_cit"',
    'id="gsc_a_t"',
    'id="gsc_a_b"',
    'class="gsc_a_tr"',
    'class="gsc_a_at"',
    'class="gs_gray"',
    'class="gsc_a_ac',
    'class="gsc_a_h',
    'id="gsc_bpf_more"',
  ]) {
    ok(html.includes(landmark), `fixture must contain ${landmark}`);
  }
});

test("the fixture holds 12 first-page rows and 8 second-page rows", () => {
  equal(initialRows.length, expected.initialRowCount);
  equal(secondPageRows.length, expected.page2Rows.length);
  equal(allRows.length, expected.expandedRowCount);
});

test("the first-page rows classify exactly as documented", () => {
  expected.rows.forEach((row, index) => {
    const parsed = initialRows[index];
    ok(parsed.title.startsWith(row.titlePrefix), `row ${row.index} title: ${parsed.title}`);
    const result = classify(parsed.authors);
    equal(result.matchedAuthor, row.matchedAuthor, `row ${row.index} matched author`);
    deepEqual(SH.activeRoleKeys(result.roles), row.roles, `row ${row.index} roles`);
    equal(SH.positionalAccent(result.roles), row.accent, `row ${row.index} accent`);
    equal(parsed.year, row.year, `row ${row.index} year`);
    equal(parsed.citations, row.citations, `row ${row.index} citations`);
  });
});

test("the second-page rows classify exactly as documented", () => {
  expected.page2Rows.forEach((row, index) => {
    const parsed = secondPageRows[index];
    equal(parsed.title, row.title, `row ${row.index} title`);
    const result = classify(parsed.authors);
    deepEqual(SH.activeRoleKeys(result.roles), row.roles, `row ${row.index} roles`);
    equal(SH.positionalAccent(result.roles), row.accent, `row ${row.index} accent`);
    equal(parsed.year, row.year, `row ${row.index} year`);
    equal(parsed.citations, row.citations, `row ${row.index} citations`);
  });
});

test("at least three of the owner's papers are co-first with a shared *", () => {
  const sharedStar = allRows.filter((row) => {
    const result = classify(row.authors);
    return result.roles.cofirst && SH.scanFragment(result.matchedAuthor).markers.has("*");
  });
  ok(sharedStar.length >= 3, `expected >= 3 co-first papers with *, found ${sharedStar.length}`);
});

test("the fixture contains every role at least once", () => {
  const counts = {};
  for (const row of allRows) {
    for (const role of SH.activeRoleKeys(classify(row.authors).roles)) {
      counts[role] = (counts[role] || 0) + 1;
    }
  }
  deepEqual(counts, expected.roleCounts);
});

test("a row where the owner is only the second author exists and is not co-first", () => {
  const plainSecond = allRows.filter((row) => {
    const result = classify(row.authors);
    return result.roles.second && !result.roles.cofirst && !result.roles.corresponding;
  });
  ok(plainSecond.length >= 1, "expected at least one plain second-author paper");
  // And the fixture keeps co-first strictly separate from that role.
  const cofirstAlsoSecond = allRows.filter((row) => {
    const result = classify(row.authors);
    return result.roles.cofirst && result.roles.second;
  });
  equal(cofirstAlsoSecond.length, 0, "a co-first paper must never also be flagged second");
});

test("the fixture's corresponding-author papers use both detection paths", () => {
  const rows = allRows.map((row) => classify(row.authors));
  const viaEnvelope = rows.filter((result) => result.roles.corresponding && SH.scanFragment(result.matchedAuthor).markers.has("✉"));
  const viaLastAuthor = rows.filter((result) => result.roles.corresponding && result.roles.last);
  ok(viaEnvelope.length >= 1, "one corresponding author marked with ✉");
  ok(viaLastAuthor.length >= 1, "one corresponding author inferred from the last position");
});

test("the metadata the panel reads out of the fixture is correct", () => {
  equal(firstMatch(html, /<div id="gsc_prf_in">([\s\S]*?)<\/div>/), expected.profileName);
  const aliasLine = firstMatch(html, /Also published as:\s*([\s\S]*?)<\/div>/);
  deepEqual(SH.splitNameList(aliasLine), expected.aliases);

  const statsTable = html.slice(html.indexOf('id="gsc_rsb_st"'), html.indexOf("</table>", html.indexOf('id="gsc_rsb_st"')));
  const totals = {};
  for (const row of statsTable.split("<tr>").slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
      decode(match[1].replace(/<[^>]*>/g, "")).trim(),
    );
    if (cells.length < 2) continue;
    const label = SH.fold(cells[0]);
    const value = Number(cells[1]);
    if (label.startsWith("citation")) totals.citations = value;
    if (label === "h index") totals.hIndex = value;
    if (label === "i10 index") totals.i10Index = value;
  }
  deepEqual(totals, expected.sidebarTotals);
});

test("the fixture's own totals match what the extension recomputes", () => {
  const summary = SH.summarizePapers(initialRows);
  deepEqual(
    {
      papers: summary.papers,
      citations: summary.citations,
      hIndex: summary.hIndex,
      i10Index: summary.i10Index,
    },
    {
      papers: expected.initialRowCount,
      citations: expected.sidebarTotals.citations,
      hIndex: expected.sidebarTotals.hIndex,
      i10Index: expected.sidebarTotals.i10Index,
    },
  );

  const expanded = SH.summarizePapers(allRows);
  deepEqual(
    {
      papers: expanded.papers,
      citations: expanded.citations,
      hIndex: expanded.hIndex,
      i10Index: expanded.i10Index,
    },
    expected.allRows,
  );
});
