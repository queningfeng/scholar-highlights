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

const fs = require("node:fs");
const path = require("node:path");

const harness = require("./harness.js");

// Discover rather than list: an explicit array silently skipped a newly added
// case file once already.
const casesDir = path.join(__dirname, "cases");
const cases = fs
  .readdirSync(casesDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(casesDir, name));

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
