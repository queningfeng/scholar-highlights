/*!
 * Author matching: full names, abbreviations, reversed order, diacritics,
 * aliases, and the near misses that must never match.
 * Runs the production classifyPaper() from src/content.js.
 */

"use strict";

const path = require("node:path");
const SH = require("../../src/content.js");
const harness = require("../harness.js");
const fixture = require("../fixtures/author-cases.json");

const { describe, test, equal, deepEqual } = harness;

describe("author matching");

for (const testCase of fixture.cases) {
  test(testCase.note, () => {
    const result = SH.classifyPaper({
      title: "irrelevant title",
      authors: testCase.authors,
      profileName: testCase.profileName || fixture.profileName,
      aliases: testCase.aliases || fixture.aliases,
      overrides: {},
    });
    equal(result.matchIndex, testCase.matchIndex, "match index");
    equal(result.matchedAuthor, testCase.matchedAuthor, "matched author");
    if (testCase.roles) {
      deepEqual(
        SH.activeRoleKeys(result.roles),
        testCase.roles,
        "roles",
      );
    }
  });
}

test("name parts fold diacritics, punctuation and case", () => {
  deepEqual(SH.nameParts("  Zoë   MÜLLER-Webster "), ["zoe", "muller", "webster"]);
  deepEqual(SH.nameParts("Que, Ningfeng"), ["que", "ningfeng"]);
  deepEqual(SH.nameParts("阙宁峰"), ["阙宁峰"]);
});

test("scoreIdentity ranks a full name above an abbreviation", () => {
  const identity = { raw: "Ningfeng Que", parts: SH.nameParts("Ningfeng Que") };
  const full = SH.scoreIdentity("Ningfeng Que", identity);
  const initial = SH.scoreIdentity("N. Que", identity);
  const missing = SH.scoreIdentity("Que", identity);
  const stranger = SH.scoreIdentity("Nina Quince", identity);
  if (!(full < initial)) throw new Error(`expected ${full} < ${initial}`);
  if (!(initial <= missing)) throw new Error(`expected ${initial} <= ${missing}`);
  if (!(missing < stranger)) throw new Error(`expected ${missing} < ${stranger}`);
  equal(stranger, Infinity, "a different person scores Infinity");
});

test("the byline splitter re-attaches marker-only fragments", () => {
  const byline = SH.splitByline("Ningfeng Que1,2, Hao Tang3, Yanwen Tian");
  deepEqual(byline, {
    fragments: ["Ningfeng Que1,2", "Hao Tang3", "Yanwen Tian"],
    truncated: false,
  });
});

test("the byline splitter understands et al., ellipses, 'and' and semicolons", () => {
  deepEqual(SH.splitByline("A. Smith, B. Jones, et al.").fragments, ["A. Smith", "B. Jones"]);
  equal(SH.splitByline("A. Smith, B. Jones, et al.").truncated, true);
  deepEqual(SH.splitByline("A. Smith and B. Jones").fragments, ["A. Smith", "B. Jones"]);
  deepEqual(SH.splitByline("A. Smith; B. Jones; C. Li").fragments, ["A. Smith", "B. Jones", "C. Li"]);
  deepEqual(SH.splitByline("王潇飞，阙宁峰").fragments, ["王潇飞", "阙宁峰"]);
});

test("foldForSearch maps folded characters back to the original string", () => {
  const text = "Yujia Sun, N. Que, Peiting Shi";
  const { folded, map } = SH.foldForSearch(text);
  equal(folded, "yujia sun n que peiting shi");
  const at = folded.indexOf("n que");
  equal(text.slice(map[at], map[at + "n que".length - 1] + 1), "N. Que");
});

test("the built-in profile preset is detected by Scholar id and by name", () => {
  const byId = SH.detectKnownProfile(
    { displayName: "Someone Else" },
    "https://scholar.google.com/citations?hl=en&user=ZxrkoP4AAAAJ",
  );
  equal(byId && byId.id, "ZxrkoP4AAAAJ", "detected by user id");
  const byName = SH.detectKnownProfile(
    { displayName: "阙宁峰" },
    "https://scholar.google.com/citations?user=whatever",
  );
  equal(byName && byName.id, "ZxrkoP4AAAAJ", "detected by display name");
  equal(
    SH.detectKnownProfile({ displayName: "Ada Lovelace" }, "https://scholar.google.com/citations?user=abc"),
    null,
    "unknown profiles get no preset",
  );
});

test("every preset override key is already in normalised form", () => {
  for (const profile of Object.values(SH.KNOWN_PROFILES)) {
    for (const key of Object.keys(profile.presetOverrides)) {
      equal(SH.normalizeTitle(key), key, `preset key "${key}" must be normalised`);
    }
    for (const role of Object.values(profile.presetOverrides)) {
      const parsed = SH.parseOverrideValue(role);
      equal(parsed.unknown.length, 0, `preset role "${role}" must be known`);
      if (!SH.activeRoleKeys(parsed.roles).length) {
        throw new Error(`preset role "${role}" names no role`);
      }
    }
  }
  if (!SH.KNOWN_PROFILES.ZxrkoP4AAAAJ.presetOverrides[
    "adaptive spatial transcriptomics interpolation via cross modal cross slice modeling"
  ]) {
    throw new Error("the co-first preset for the Adaptive Spatial Transcriptomics paper is missing");
  }
});

test("the fixtures directory is what the case files claim", () => {
  equal(
    path.basename(path.dirname(require.resolve("../fixtures/author-cases.json"))),
    "fixtures",
  );
});
