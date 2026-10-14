#!/usr/bin/env node
/**
 * Scholar Highlights - test entry point.
 *
 *   node tests/run.js
 *
 * Loads every case file in tests/cases and runs it against the production
 * implementation in src/content.js (required, never re-implemented).
 */

"use strict";

const harness = require("./harness.js");

const cases = [
  "./cases/name-matching.test.js",
  "./cases/roles.test.js",
  "./cases/overrides.test.js",
  "./cases/metrics.test.js",
  "./cases/filters.test.js",
  "./cases/fixture.test.js",
  "./cases/policy.test.js",
];

for (const file of cases) {
  require(file);
}

harness
  .run()
  .then((failed) => {
    process.exitCode = failed === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error("test runner crashed:", error);
    process.exitCode = 1;
  });
