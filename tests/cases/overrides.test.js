/*!
 * Manual override precedence: an override always wins over automatic
 * detection, keeps working when the owner is not even in the byline, and a
 * typo falls back to detection instead of silently blanking a paper.
 */

"use strict";

const SH = require("../../src/content.js");
const harness = require("../harness.js");
const fixture = require("../fixtures/override-cases.json");

const { describe, test, equal, deepEqual } = harness;

describe("manual overrides");

for (const testCase of fixture.cases) {
  test(testCase.note, () => {
    const result = SH.classifyPaper({
      title: testCase.title,
      authors: testCase.authors,
      profileName: fixture.profileName,
      aliases: fixture.aliases,
      overrides: SH.normalizeOverrideMap(testCase.overrides),
    });
    deepEqual(SH.activeRoleKeys(result.roles), testCase.roles, "roles");
    equal(result.override, testCase.override, "override flag");
    if (testCase.detected) {
      deepEqual(SH.activeRoleKeys(result.detected), testCase.detected, "detected roles");
    }
    if (testCase.matchIndex !== undefined) {
      equal(result.matchIndex, testCase.matchIndex, "match index");
    }
  });
}

test("the default override map is empty and documented by its parser", () => {
  deepEqual(SH.normalizeOverrideMap(undefined), {});
  deepEqual(SH.normalizeOverrideMap(null), {});
  const parsed = SH.parseOverrideLines("");
  deepEqual(parsed.overrides, {});
  deepEqual(parsed.errors, []);
});

test("the override textarea format: one 'title => role' per line, # comments allowed", () => {
  const parsed = SH.parseOverrideLines(
    [
      "# a comment",
      "CoInS-Net: A Continuous Position-Aware Network => cofirst",
      "   ",
      "// another comment",
      "Some Paper => cofirst, corresponding",
    ].join("\n"),
  );
  deepEqual(parsed.errors, []);
  deepEqual(parsed.overrides, {
    "coins net a continuous position aware network": "cofirst",
    "some paper": "cofirst, corresponding",
  });
});

test("invalid override lines are reported, not swallowed", () => {
  const parsed = SH.parseOverrideLines(
    ["no separator here", "Title => cofrist", "=> first"].join("\n"),
  );
  equal(parsed.errors.length, 3, "three bad lines");
  equal(parsed.errors[0].line, 1);
  equal(parsed.errors[1].reason.includes("cofrist"), true, "the bad role is named");
  deepEqual(parsed.overrides, {});
});

test("overrides round-trip through format and parse", () => {
  const map = {
    "adaptive spatial transcriptomics interpolation": "cofirst",
    "vtcnet a feature fusion dl model": "cofirst, corresponding",
  };
  const text = SH.formatOverrideLines(map);
  const parsed = SH.parseOverrideLines(text);
  deepEqual(parsed.errors, []);
  deepEqual(parsed.overrides, map);
});

test("alias lines are one per line, so a reversed name stays one alias", () => {
  deepEqual(SH.parseAliasLines("N. Que\nQue, Ningfeng\n\n阙宁峰"), [
    "N. Que",
    "Que, Ningfeng",
    "阙宁峰",
  ]);
  deepEqual(SH.parseAliasLines("NingFeng Que\nN. Que\nNingFeng Que"), [
    "NingFeng Que",
    "N. Que",
  ]);
  deepEqual(SH.parseAliasLines(""), []);
  deepEqual(SH.parseAliasLines("   \n  \n"), []);
});

test("role synonyms all resolve to a real role", () => {
  const expected = {
    first: "first",
    "1st": "first",
    cofirst: "cofirst",
    "co first": "cofirst",
    "equal first": "cofirst",
    corresponding: "corresponding",
    corr: "corresponding",
    second: "second",
    "2nd": "second",
    last: "last",
    senior: "last",
    middle: "middle",
  };
  for (const [token, role] of Object.entries(expected)) {
    const parsed = SH.parseOverrideValue(token);
    deepEqual(parsed.unknown, [], `"${token}" must be known`);
    deepEqual(SH.activeRoleKeys(parsed.roles), [role], `"${token}" => ${role}`);
  }
  for (const token of ["none", "-", "no"]) {
    const parsed = SH.parseOverrideValue(token);
    equal(parsed.force, true, `"${token}" clears the paper`);
    deepEqual(SH.activeRoleKeys(parsed.roles), []);
  }
});
