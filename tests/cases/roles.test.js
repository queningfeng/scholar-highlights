/*!
 * Role classification: sole first, co-first (shared * / † / superscripts /
 * affiliation digits), second, corresponding (✉ and last-author fallback),
 * last, middle, truncated bylines and the false-positive guards.
 */

"use strict";

const SH = require("../../src/content.js");
const harness = require("../harness.js");
const fixture = require("../fixtures/role-cases.json");

const { describe, test, equal, deepEqual } = harness;

describe("role classification");

for (const testCase of fixture.cases) {
  test(testCase.note, () => {
    const result = SH.classifyPaper({
      title: "irrelevant title",
      authors: testCase.authors,
      profileName: fixture.profileName,
      aliases: fixture.aliases,
      overrides: {},
    });
    deepEqual(SH.activeRoleKeys(result.roles), testCase.roles, "roles");
  });
}

test("co-first is a first-class role, never folded into second author", () => {
  const result = SH.classifyPaper({
    title: "t",
    authors: "Mingzhe Li†, Ningfeng Que†, Juanhua Zhang",
    profileName: "Ningfeng Que",
    aliases: [],
    overrides: {},
  });
  equal(result.roles.cofirst, true, "cofirst");
  equal(result.roles.second, false, "second must stay false for a co-first author");
  equal(result.roles.first, false, "first must stay false for a co-first author");
  deepEqual(SH.activeRoleKeys(result.roles), ["cofirst"]);
});

test("role keys and labels cover every role the panel can draw", () => {
  deepEqual(SH.ROLE_KEYS, [
    "first",
    "cofirst",
    "corresponding",
    "second",
    "last",
    "middle",
  ]);
  for (const key of SH.ROLE_KEYS) {
    if (!SH.ROLE_LABELS[key]) throw new Error(`missing label for ${key}`);
    if (!SH.ROLE_NOTES[key]) throw new Error(`missing legend note for ${key}`);
  }
  if (!/co-?first/i.test(SH.ROLE_NOTES.cofirst)) {
    throw new Error("the co-first legend entry must say what it is");
  }
});

test("the positional accent prefers co-first over every other position", () => {
  equal(SH.positionalAccent({ second: true, corresponding: true }), "second");
  equal(SH.positionalAccent({ cofirst: true, last: true }), "cofirst");
  equal(SH.positionalAccent({ first: true, last: true }), "first");
  equal(SH.positionalAccent({ corresponding: true }), null);
  equal(SH.positionalAccent({}), null);
});

test("marker scanning recognises symbols, superscripts and glued letters", () => {
  const markerSets = (text) => [...SH.scanFragment(text).markers].sort();
  deepEqual(markerSets("Ningfeng Que"), []);
  deepEqual(markerSets("Ningfeng Que*"), ["*"]);
  deepEqual(markerSets("Ningfeng Que✉"), ["✉"]);
  deepEqual(markerSets("Ningfeng Que1"), ["1"]);
  deepEqual(markerSets("Ningfeng Que1a"), ["1", "a"]);
  deepEqual(markerSets("Ningfeng Que¹"), ["¹"]);
  deepEqual(markerSets("Ningfeng Que†"), ["†"]);
  // A surname ending in a-f, with no marker, must stay clean.
  deepEqual(markerSets("Ningfeng Que"), []);
  deepEqual(markerSets("Yin Dai"), []);
  deepEqual(markerSets("Deliang Li"), []);
  equal(SH.scanFragment("Ningfeng Que*").body, "Ningfeng Que");
  equal(SH.scanFragment("Ningfeng Que1,2").body, "Ningfeng Que");
});

test("empty bylines classify to no roles instead of throwing", () => {
  for (const authors of ["", "   ", "et al.", "..."]) {
    const result = SH.classifyPaper({
      title: "t",
      authors,
      profileName: "Ningfeng Que",
      aliases: [],
      overrides: {},
    });
    deepEqual(SH.activeRoleKeys(result.roles), [], `"${authors}"`);
    equal(result.matchIndex, -1);
  }
  const nameless = SH.classifyPaper({
    title: "t",
    authors: "Ningfeng Que, Hao Tang",
    profileName: "",
    aliases: [],
    overrides: {},
  });
  deepEqual(SH.activeRoleKeys(nameless.roles), []);
});
