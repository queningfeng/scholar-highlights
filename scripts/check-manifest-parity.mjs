#!/usr/bin/env node
/**
 * Scholar Highlights - manifest parity check.
 *
 * `manifest.json` (Firefox) and `manifest.chrome.json` (Chrome / Edge) must be
 * identical except for the `browser_specific_settings` key, which only Firefox
 * understands. This script also proves that every path a manifest references
 * exists on disk and that the permission surface stayed minimal.
 *
 * Run: node scripts/check-manifest-parity.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function readJson(name) {
  const path = join(root, name);
  if (!existsSync(path)) {
    console.log(`  FAIL ${name} exists`);
    failures += 1;
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.log(`  FAIL ${name} parses: ${error.message}`);
    failures += 1;
    return null;
  }
}

/** Stable, key-sorted JSON so object key order can never cause a diff. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Walk to a dotted path, returning undefined when it is not there. */
function at(object, path) {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), object);
}

const firefox = readJson("manifest.json");
const chrome = readJson("manifest.chrome.json");

if (!firefox || !chrome) {
  console.log("\nmanifest parity: FAIL (unreadable manifest)");
  process.exit(1);
}

console.log("manifest parity");

const firefoxKeys = Object.keys(firefox).sort();
const chromeKeys = Object.keys(chrome).sort();
const allowedOnly = ["browser_specific_settings"];

const unexpected = firefoxKeys.filter((key) => !chromeKeys.includes(key) && !allowedOnly.includes(key));
const missing = chromeKeys.filter((key) => !firefoxKeys.includes(key));
check(
  "same key set (Firefox may add only browser_specific_settings)",
  unexpected.length === 0 && missing.length === 0,
  `firefox-only: ${unexpected.join(", ") || "none"}; chrome-only: ${missing.join(", ") || "none"}`,
);

const sharedKeys = firefoxKeys.filter((key) => chromeKeys.includes(key));
let identical = true;
const differing = [];
for (const key of sharedKeys) {
  if (canonical(firefox[key]) !== canonical(chrome[key])) {
    identical = false;
    differing.push(key);
  }
}
check(
  `every other key is identical (${sharedKeys.length} keys compared)`,
  identical,
  differing.join(", "),
);

check(
  "Firefox manifest declares browser_specific_settings.gecko.id",
  typeof at(firefox, ["browser_specific_settings", "gecko", "id"]) === "string",
);
check(
  "Chrome manifest has no browser_specific_settings",
  chrome.browser_specific_settings === undefined,
);
check("no background script", firefox.background === undefined && chrome.background === undefined);
check("no host_permissions", firefox.host_permissions === undefined && chrome.host_permissions === undefined);
check(
  'permissions are exactly ["storage"]',
  canonical(firefox.permissions) === canonical(["storage"]),
  canonical(firefox.permissions),
);
check(
  "content script matches exactly the Scholar citations URL",
  canonical(at(firefox, ["content_scripts", 0, "matches"])) ===
    canonical(["https://scholar.google.com/citations*"]),
);
check(
  "description fits the Chrome Web Store limit",
  typeof firefox.description === "string" && firefox.description.length <= 132,
  `${(firefox.description || "").length} chars`,
);
check(
  "same version in both manifests",
  firefox.version === chrome.version,
  `${firefox.version} vs ${chrome.version}`,
);

// Every referenced file must exist.
const referenced = [];
for (const manifest of [firefox, chrome]) {
  for (const [size, path] of Object.entries(manifest.icons || {})) {
    referenced.push([`icons.${size}`, path]);
  }
  const optionsPage = at(manifest, ["options_ui", "page"]);
  if (optionsPage) referenced.push(["options_ui.page", optionsPage]);
  for (const [index, script] of (manifest.content_scripts || []).entries()) {
    for (const path of script.js || []) referenced.push([`content_scripts[${index}].js`, path]);
    for (const path of script.css || []) referenced.push([`content_scripts[${index}].css`, path]);
  }
}

const seen = new Set();
for (const [label, path] of referenced) {
  if (seen.has(path)) continue;
  seen.add(path);
  check(`referenced file exists: ${path} (${label})`, existsSync(join(root, path)));
}

// Files the options page loads must exist too (HTML is not covered above).
for (const path of ["options.html", "src/options.js", "styles/options.css"]) {
  check(`shipped file exists: ${path}`, existsSync(join(root, path)));
}

console.log(
  `\nmanifest parity: ${failures === 0 ? "PASS" : "FAIL"} (${checks - failures}/${checks} checks passed)`,
);
process.exit(failures === 0 ? 0 : 1);
