/*!
 * Scholar Highlights - tiny zero-dependency test harness.
 *
 * Deliberately hand written: the suite must run with plain `node tests/run.js`
 * on a machine with no package manager, no network and no devDependencies.
 */

"use strict";

const results = {
  groups: [],
  current: null,
  passed: 0,
  failed: 0,
  failures: [],
};

function describe(name) {
  results.current = { name, cases: [] };
  results.groups.push(results.current);
}

function test(name, fn) {
  if (!results.current) describe("(ungrouped)");
  results.current.cases.push({ name, fn });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}: ${canonical(value[key])}`)
      .join(", ")}}`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return String(value);
}

function ok(value, message) {
  if (!value) throw new Error(message || `expected a truthy value, got ${canonical(value)}`);
}

function equal(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message ? `${message}: ` : ""}expected ${canonical(expected)}, got ${canonical(actual)}`,
    );
  }
}

function deepEqual(actual, expected, message) {
  const left = canonical(actual);
  const right = canonical(expected);
  if (left !== right) {
    throw new Error(
      `${message ? `${message}\n  ` : ""}actual:   ${left}\n  expected: ${right}`,
    );
  }
}

function throws(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
  }
  if (!threw) throw new Error(message || "expected the function to throw");
}

async function run() {
  console.log("Scholar Highlights — test suite\n");
  for (const group of results.groups) {
    console.log(group.name);
    for (const testCase of group.cases) {
      try {
        await testCase.fn();
        results.passed += 1;
        console.log(`  ok   ${testCase.name}`);
      } catch (error) {
        results.failed += 1;
        results.failures.push({ group: group.name, name: testCase.name, error });
        console.log(`  FAIL ${testCase.name}`);
      }
    }
    console.log("");
  }

  if (results.failures.length) {
    console.log("Failures\n");
    for (const failure of results.failures) {
      console.log(`  ${failure.group} › ${failure.name}`);
      const detail = String(failure.error && failure.error.message ? failure.error.message : failure.error);
      for (const line of detail.split("\n")) console.log(`      ${line}`);
      console.log("");
    }
  }

  const total = results.passed + results.failed;
  console.log(
    `${results.passed} passed, ${results.failed} failed (${total} test${total === 1 ? "" : "s"})`,
  );
  return results.failed;
}

module.exports = { describe, test, ok, equal, deepEqual, throws, run, canonical };
