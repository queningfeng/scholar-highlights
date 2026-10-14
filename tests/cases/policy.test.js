/*!
 * Policy tests: the promises the README and the store listings make are
 * checked mechanically.
 *
 *   - no string-to-markup path and no eval anywhere in the shipped code
 *   - no network APIs, no extra browser APIs, no host permissions
 *   - every file a manifest references exists
 *   - the role palette in styles/content.css and styles/options.css agree
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const SH = require("../../src/content.js");
const harness = require("../harness.js");

const { describe, test, equal, ok, deepEqual } = harness;

const ROOT = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

const FORBIDDEN_IN_CODE = [
  { pattern: /\.innerHTML\b/, why: "innerHTML would let page data become markup" },
  { pattern: /\.outerHTML\b/, why: "outerHTML would let page data become markup" },
  { pattern: /insertAdjacentHTML/, why: "insertAdjacentHTML parses strings as markup" },
  { pattern: /document\.write/, why: "document.write parses strings as markup" },
  { pattern: /\beval\s*\(/, why: "eval is forbidden by the MV3 CSP and by policy" },
  { pattern: /new\s+Function\s*\(/, why: "the Function constructor is forbidden by the MV3 CSP" },
  { pattern: /\bfetch\s*\(/, why: "the extension must never talk to the network" },
  { pattern: /XMLHttpRequest/, why: "the extension must never talk to the network" },
  { pattern: /new\s+WebSocket\b/, why: "the extension must never talk to the network" },
  { pattern: /sendBeacon/, why: "the extension must never talk to the network" },
  { pattern: /importScripts/, why: "there is no background worker to import into" },
  { pattern: /chrome\.tabs|chrome\.scripting|chrome\.cookies/, why: "only storage.sync may be used" },
];

describe("policy");

test("the shipped JavaScript contains no markup, eval or network paths", () => {
  for (const file of ["src/content.js", "src/options.js"]) {
    const source = read(file);
    for (const rule of FORBIDDEN_IN_CODE) {
      if (rule.pattern.test(source)) {
        throw new Error(`${file} matches ${rule.pattern} — ${rule.why}`);
      }
    }
  }
});

test("the only browser APIs the content script uses are storage and runtime", () => {
  const source = read("src/content.js");
  const apis = new Set();
  for (const match of source.matchAll(/\b(?:browser|chrome)\.([A-Za-z]+)/g)) {
    apis.add(match[1]);
  }
  for (const match of source.matchAll(/api\.([A-Za-z]+)/g)) {
    apis.add(match[1]);
  }
  const allowed = new Set(["storage", "runtime", "browser", "chrome"]);
  const unexpected = [...apis].filter((name) => !allowed.has(name));
  deepEqual(unexpected, [], "unexpected browser API namespaces");
});

test("both manifests ship exactly the documented permission surface", () => {
  for (const file of ["manifest.json", "manifest.chrome.json"]) {
    const manifest = JSON.parse(read(file));
    equal(manifest.manifest_version, 3, `${file} manifest version`);
    ok(!manifest.background, `${file} must not declare a background script`);
    ok(!manifest.host_permissions, `${file} must not declare host permissions`);
    ok(!manifest.web_accessible_resources, `${file} must not expose files to pages`);
    deepEqual(manifest.permissions, ["storage"], `${file} permissions`);
    deepEqual(
      manifest.content_scripts[0].matches,
      ["https://scholar.google.com/citations*"],
      `${file} match pattern`,
    );
  }
});

test("every path the manifests reference exists", () => {
  for (const file of ["manifest.json", "manifest.chrome.json"]) {
    const manifest = JSON.parse(read(file));
    const paths = [
      ...Object.values(manifest.icons || {}),
      manifest.options_ui && manifest.options_ui.page,
      ...(manifest.content_scripts[0].js || []),
      ...(manifest.content_scripts[0].css || []),
    ].filter(Boolean);
    for (const referenced of paths) {
      ok(exists(referenced), `${file} references missing ${referenced}`);
    }
  }
  for (const file of ["options.html", "styles/options.css", "src/options.js", "assets/icon.svg"]) {
    ok(exists(file), `missing shipped file ${file}`);
  }
  for (const size of [16, 32, 48, 96, 128]) {
    ok(exists(`assets/icons/icon-${size}.png`), `missing icon-${size}.png`);
  }
});

test("the options page loads the shared core before its own script", () => {
  const html = read("options.html");
  const core = html.indexOf('src="src/content.js"');
  const options = html.indexOf('src="src/options.js"');
  ok(core > 0, "options.html must load src/content.js");
  ok(options > core, "src/options.js must come after the shared core");
  ok(!/onclick=|onload=/i.test(html), "no inline event handlers (MV3 CSP)");
});

test("the role palette is identical in the panel and on the options page", () => {
  // First occurrence = the light palette, last occurrence = the dark one, so
  // this catches drift in either theme.
  const extract = (css, pick) => {
    const tokens = {};
    for (const match of css.matchAll(/--shx-([a-z]+)-(line|tint):\s*([^;]+);/g)) {
      const key = `${match[1]}-${match[2]}`;
      const value = match[3].trim();
      if (pick === "first" && tokens[key] === undefined) tokens[key] = value;
      if (pick === "last") tokens[key] = value;
    }
    return tokens;
  };
  const panelCss = read("styles/content.css");
  const optionsCss = read("styles/options.css");
  for (const pick of ["first", "last"]) {
    const panel = extract(panelCss, pick);
    const options = extract(optionsCss, pick);
    for (const role of SH.ROLE_KEYS) {
      for (const kind of ["line", "tint"]) {
        const key = `${role}-${kind}`;
        ok(panel[key], `content.css must define --shx-${key}`);
        ok(options[key], `options.css must define --shx-${key}`);
        equal(
          options[key],
          panel[key],
          `--shx-${key} must match in both stylesheets (${pick} definition)`,
        );
      }
    }
  }
  // The dark palette must actually differ, otherwise a dark theme is a no-op.
  const light = extract(panelCss, "first");
  const dark = extract(panelCss, "last");
  ok(light["cofirst-line"] !== dark["cofirst-line"], "the dark palette must differ from the light one");
  ok(panelCss.includes(':root[data-shx-theme="dark"]'), "content.css must define a dark palette");
});

test("every role has a swatch, a filter and a row treatment", () => {
  const css = read("styles/content.css");
  const script = read("src/content.js");
  for (const role of SH.ROLE_KEYS) {
    ok(css.includes(`.shx-swatch-${role}`), `missing swatch for ${role}`);
    ok(script.includes("`shx-r-${key}`"), "the content script must tag rows with per-role classes");
  }
  for (const role of ["first", "cofirst", "second", "last", "middle"]) {
    ok(css.includes(`tr.gsc_a_tr.shx-a-${role}`), `missing row accent for ${role}`);
  }
  ok(css.includes("tr.gsc_a_tr.shx-corresponding"), "missing corresponding accent");
  ok(css.includes(".shx-hidden"), "missing focus-mode hiding rule");
  ok(css.includes(".shx-options.shx-open"), "the options panel must be collapsed by default");
  ok(/prefers-color-scheme:\s*dark/.test(css), "no prefers-color-scheme fallback");
  // The per-role classes are documented so users can build on them.
  for (const role of SH.ROLE_KEYS) {
    ok(css.includes(`shx-r-${role}`), `content.css must document shx-r-${role}`);
  }
});

test("both stylesheets are syntactically balanced", () => {
  // A browser silently drops broken CSS rules, so this is the only place a
  // stray brace or a missing semicolon can be caught without a real browser.
  for (const file of ["styles/content.css", "styles/options.css"]) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    for (const char of css) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      if (depth < 0) throw new Error(`${file}: a closing brace has no opening brace`);
    }
    equal(depth, 0, `${file}: unbalanced braces`);
    css.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const quotes = (trimmed.match(/"/g) || []).length;
      equal(quotes % 2, 0, `${file}:${index + 1} has an odd number of quotes`);
      const isDeclaration = /^(--)?[a-z-]+\s*:/.test(trimmed) && !trimmed.startsWith("@");
      // A declaration ends with ';'. A trailing comma is how a selector list
      // (and, in principle, a multi-line value) continues on the next line.
      if (isDeclaration && !/[;{},]$/.test(trimmed)) {
        throw new Error(`${file}:${index + 1} declaration does not end with ';': ${trimmed}`);
      }
    });
  }
});

test("every selector the content script relies on exists in the fixture DOM", () => {
  // `#gs_prf_ion_txt` is the "Also published as" dialog input, which Scholar
  // only renders when that dialog is open, and `#shx-panel` is ours.
  const optional = new Set(["otherNames", "panel"]);
  const html = read("tests/fixtures/sample-profile.html");
  for (const [name, selector] of Object.entries(SH.SELECTORS)) {
    if (optional.has(name)) continue;
    const tokens = selector.match(/[.#][A-Za-z0-9_-]+/g) || [];
    for (const token of tokens) {
      const attribute = token.startsWith("#") ? "id" : "class";
      const value = token.slice(1);
      ok(
        html.includes(`${attribute}="${value}"`) || html.includes(`${attribute}="${value} `),
        `${name}: fixture has no ${attribute}="${value}" for selector ${selector}`,
      );
    }
  }
});

test("the shipped file tree is the documented one", () => {
  const required = [
    "manifest.json",
    "manifest.chrome.json",
    "README.md",
    "VERIFICATION.md",
    "LICENSE",
    ".gitignore",
    "package.json",
    "options.html",
    "src/content.js",
    "src/options.js",
    "styles/content.css",
    "styles/options.css",
    "assets/icon.svg",
    "scripts/check-manifest-parity.mjs",
    "scripts/check-syntax.mjs",
    "scripts/make-icons.py",
    "tests/run.js",
    "tests/harness.js",
    "tests/fixtures/sample-profile.html",
    "tests/fixtures/expected-profile.json",
  ];
  for (const file of required) {
    ok(exists(file), `missing ${file}`);
  }
});

test("the licence is MIT and names the author", () => {
  const licence = read("LICENSE");
  ok(/MIT License/.test(licence), "LICENSE must be the MIT licence");
  ok(licence.includes("Ningfeng Que"), "LICENSE must name Ningfeng Que");
});

test("the README documents the co-first rules and the development workflow", () => {
  const readme = read("README.md");
  for (const needle of [
    "共同第一作者",
    "node tests/run.js",
    "node scripts/check-manifest-parity.mjs",
    "storage.sync",
    "ZxrkoP4AAAAJ",
    "cofirst",
  ]) {
    ok(readme.includes(needle), `README must mention ${needle}`);
  }
  ok(/English summary/i.test(readme), "README must end with an English summary");
});

test("no dangling reference to a script that is not shipped", () => {
  for (const file of ["options.html", "manifest.json", "manifest.chrome.json"]) {
    const text = read(file);
    for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const target = match[1];
      if (/^https?:/.test(target)) continue;
      ok(exists(target), `${file} references missing ${target}`);
    }
  }
});
