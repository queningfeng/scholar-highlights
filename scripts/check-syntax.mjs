#!/usr/bin/env node
/**
 * Scholar Highlights - syntax gate.
 *
 * Parses every shipped and test JavaScript file with `node --check`, which is
 * exactly what "the content script is genuinely loadable" means for a
 * build-step-free extension: no bundler, no transpiler, no dangling reference
 * hidden behind a build.
 *
 * Run: node scripts/check-syntax.mjs
 */

import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const roots = ["src", "tests", "scripts", "tools"];
const skipDirs = new Set([
  "node_modules",
  ".git",
  "artifacts",
  ".verify-build",
  ".verify-profile",
]);

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (skipDirs.has(entry)) continue;
      found.push(...walk(path));
    } else if (/\.(js|mjs|cjs)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

const files = [];
for (const directory of roots) {
  const path = join(root, directory);
  try {
    if (statSync(path).isDirectory()) files.push(...walk(path));
  } catch {
    // optional directory
  }
}

let failures = 0;
for (const file of files.sort()) {
  // stdio: "inherit" keeps the child off a pipe (which the DSH Windows
  // sandbox forbids) and still gives us the exit status.
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  const label = relative(root, file).replace(/\\/g, "/");
  if (result.status === 0) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

console.log(
  `\nsyntax: ${failures === 0 ? "PASS" : "FAIL"} (${files.length - failures}/${files.length} files parsed)`,
);
process.exit(failures === 0 ? 0 : 1);
