#!/usr/bin/env node
/**
 * Scholar Highlights - headless Chrome end-to-end verification.
 *
 * This is the only check that proves the extension is *loadable* and actually
 * does something to a real page. It:
 *
 *   1. builds a throw-away copy of the extension whose match pattern points at
 *      http://127.0.0.1/* instead of scholar.google.com (nothing else changes:
 *      same src/, same styles/, same icons);
 *   2. serves the repository over HTTP and opens tests/fixtures/sample-profile.html
 *      - an offline reproduction of a Scholar author profile - in headless
 *      Chrome with that extension installed;
 *   3. drives the page through the DevTools protocol (no dependencies: Node's
 *      global WebSocket is enough) and asserts what the content script did:
 *      role classes, name marking, metrics, the chart, and the behaviour of the
 *      role / focus / year controls.
 *
 * Run: node tools/verify-chrome.mjs
 * Requires: a local Chrome (or Edge) install. Firefox is not covered.
 */

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createProbeServer } from "node:net";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const buildDir = join(here, ".verify-build");
const profileDir = join(here, ".verify-profile");
const fixturePath = "/tests/fixtures/sample-profile.html";

const expected = JSON.parse(
  readFileSync(join(root, "tests", "fixtures", "expected-profile.json"), "utf8"),
);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  return false;
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Branded Google Chrome refuses `--load-extension` outright:
 *
 *   WARNING:extension_service.cc --load-extension is not allowed in Google
 *   Chrome, ignoring.
 *
 * It is a build-level restriction, not a feature flag, so the harness needs a
 * browser that actually honours the switch (Chromium, Chrome for Testing, or
 * Edge). Probe each candidate and use the first one that does not complain.
 *
 * @param {string} browser
 * @returns {boolean}
 */
function allowsUnpackedExtensions(browser) {
  // Named so the existing `tools/.probe-profile*/` ignore rule covers it, in
  // case a probe is killed by the timeout and leaves the directory behind.
  const probeProfile = join(buildDir, "..", `.probe-profile-${process.pid}-${Date.now()}`);
  const result = spawnSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${probeProfile}`,
      `--load-extension=${buildDir}`,
      "--enable-logging=stderr",
      "--v=0",
      "--dump-dom",
      "about:blank",
    ],
    { encoding: "utf8", timeout: 40000, windowsHide: true },
  );
  const noise = `${result.stderr || ""}${result.stdout || ""}`;
  rmSync(probeProfile, { recursive: true, force: true });
  return !/--load-extension is not allowed/i.test(noise);
}

function selectBrowser() {
  const usable = CHROME_CANDIDATES.filter((candidate) => existsSync(candidate));
  for (const candidate of usable) {
    if (candidate === process.env.CHROME_PATH || allowsUnpackedExtensions(candidate)) {
      return candidate;
    }
    console.log(`  ..   ${candidate} refuses --load-extension; trying the next one`);
  }
  return null;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createProbeServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const target = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!target.startsWith(root) || !existsSync(target) || statSync(target).isDirectory()) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[extname(target)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(target));
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

function buildExtension() {
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  for (const directory of ["src", "styles", "assets"]) {
    cpSync(join(root, directory), join(buildDir, directory), { recursive: true });
  }
  cpSync(join(root, "options.html"), join(buildDir, "options.html"));
  const manifest = JSON.parse(readFileSync(join(root, "manifest.chrome.json"), "utf8"));
  manifest.content_scripts[0].matches = [
    "http://127.0.0.1/*",
    "http://localhost/*",
  ];
  manifest.name = `${manifest.name} (verification build)`;
  writeFileSync(join(buildDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function fetchTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`/json/list returned ${response.status}`);
  return response.json();
}

async function waitForTarget(port, urlPrefix, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchTargets(port);
      const pages = targets.filter(
        (target) => target.type === "page" && target.webSocketDebuggerUrl,
      );
      const match = pages.find((target) => target.url.startsWith(urlPrefix));
      if (match) return match;
      if (pages.length && Date.now() > deadline - timeoutMs / 2) {
        // Half way through, accept any page: Chrome may have shown an error page.
        return pages[0];
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`no DevTools page target appeared (${lastError ? lastError.message : "timeout"})`);
}

/** Minimal CDP client over Node's built-in WebSocket. */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("WebSocket failed")), {
      once: true,
    });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  function send(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolveSend, rejectSend) => {
      pending.set(id, { resolve: resolveSend, reject: rejectSend });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rejectSend(new Error(`${method} timed out`));
        }
      }, 20000);
    });
  }
  return { send, close: () => socket.close() };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception
      ? result.exceptionDetails.exception.description
      : result.exceptionDetails.text;
    throw new Error(`page exception: ${detail}`);
  }
  return result.result.value;
}

async function waitForValue(client, expression, expectedValue, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(client, expression);
    if (last === expectedValue) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  console.log(`  ..   ${label}: last value was ${JSON.stringify(last)}`);
  return false;
}

function readCellsExpression() {
  return `(() => {
    const cells = {};
    document.querySelectorAll("#shx-panel .shx-metrics tbody tr").forEach((row) => {
      const label = row.querySelector(".shx-metric-label").textContent;
      const values = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent);
      cells[label] = { highlighted: values[0], all: values[1] };
    });
    return cells;
  })()`;
}

function readRowsExpression() {
  return `(() => Array.from(document.querySelectorAll("#gsc_a_b tr.gsc_a_tr")).map((row, index) => ({
    index: index + 1,
    roles: row.dataset.shxRoles || "",
    accent: ["cofirst", "first", "second", "last", "middle"].find((role) => row.classList.contains("shx-a-" + role)) || null,
    corresponding: row.classList.contains("shx-corresponding"),
    highlighted: row.classList.contains("shx-hl"),
    hidden: row.classList.contains("shx-hidden"),
    override: row.dataset.shxOverride === "1",
    year: row.dataset.shxYear ? Number(row.dataset.shxYear) : null,
    citations: Number(row.dataset.shxCites || 0),
    matched: row.dataset.shxMatched || "",
    marked: Array.from(row.querySelectorAll(".shx-me")).map((node) => node.textContent),
    background: getComputedStyle(row).backgroundColor,
    accentShadow: getComputedStyle(row.querySelector("td.gsc_a_t")).boxShadow,
    correspondingShadow: getComputedStyle(row.querySelector("td.gsc_a_y")).boxShadow,
  })))()`;
}

async function main() {
  console.log("Scholar Highlights — headless Chrome verification\n");

  // buildDir must exist before probing: the probe points --load-extension at it.
  const manifest = buildExtension();

  const chrome = selectBrowser();
  if (
    !check(
      "a local browser that honours --load-extension was found",
      Boolean(chrome),
      "branded Chrome refuses --load-extension; install Edge, Chromium, or Chrome for Testing",
    )
  ) {
    console.log("\nverify: FAIL (no browser can load the extension)");
    process.exit(1);
  }
  console.log(`  ..   using ${chrome}`);
  check("the verification build matches 127.0.0.1", manifest.content_scripts[0].matches[0] === "http://127.0.0.1/*");

  const server = await startServer();
  const port = server.address().port;
  const debugPort = await freePort();
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  const pageUrl = `http://127.0.0.1:${port}${fixturePath}`;

  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      // DisableLoadExtensionCommandLineSwitch: Chrome 137+ ignores
      // --load-extension unless this kill-switch is itself disabled, which made
      // this harness silently load nothing on Chrome 155.
      "--disable-features=Translate,MediaRouter,OptimizationHints,ChromeWhatsNewUI,DisableLoadExtensionCommandLineSwitch",
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      "--remote-allow-origins=*",
      `--load-extension=${buildDir}`,
      `--disable-extensions-except=${buildDir}`,
      pageUrl,
    ],
    { stdio: "ignore", windowsHide: true },
  );

  let client = null;
  try {
    const target = await waitForTarget(debugPort, pageUrl, 25000);
    client = await connect(target.webSocketDebuggerUrl);
    // The very first evaluate can land before the navigation commits, so wait
    // for the URL instead of asserting on a single sample.
    check(
      "the fixture page loaded in the browser",
      await waitForValue(
        client,
        "location.href.startsWith('http://127.0.0.1:')",
        true,
        15000,
        "waiting for the fixture URL",
      ),
    );

    const panelAppeared = await waitForValue(
      client,
      "document.getElementById('shx-panel') !== null",
      true,
      25000,
      "waiting for the injected panel",
    );
    check("the content script runs and injects the panel", panelAppeared);

    if (!panelAppeared) {
      const hint = await evaluate(
        client,
        "({ readyState: document.readyState, hasProfile: !!document.querySelector('#gsc_prf_in'), html: document.documentElement.outerHTML.length })",
      );
      console.log(`  ..   page state: ${JSON.stringify(hint)}`);
      throw new Error("the extension did not run; Chrome may have refused --load-extension");
    }

    // ---------------------------------------------------------------- auto-expand
    const expanded = await waitForValue(
      client,
      "document.querySelectorAll('#gsc_a_b tr.gsc_a_tr').length",
      expected.expandedRowCount,
      30000,
      "waiting for 'Show more' pagination",
    );
    check(`auto-expanding loaded all ${expected.expandedRowCount} papers`, expanded);

    // The rows land in the DOM before the panel finishes recomputing, so wait
    // for the "All loaded" papers figure to catch up. Without this the metrics
    // and chart assertions below read the pre-expansion numbers and fail.
    check(
      "the panel recomputes its metrics over every loaded paper",
      await waitForValue(
        client,
        `document.querySelectorAll("#shx-panel .shx-metrics tbody tr")[0].querySelectorAll("td")[1].textContent`,
        String(expected.expandedRowCount),
        20000,
        "waiting for the metrics to settle after auto-expanding",
      ),
    );

    check(
      "Scholar's own table header row is left untouched",
      (await evaluate(client, "document.querySelector('#gsc_a_t thead tr').className")) === "gsc_a_tr" &&
        (await evaluate(client, "document.querySelector('#gsc_a_t thead tr').classList.contains('shx-hidden')")) === false,
    );

    // ---------------------------------------------------------------- panel shape
    check(
      "the options block starts collapsed",
      !(await evaluate(client, "document.getElementById('shx-options').classList.contains('shx-open')")),
    );
    check(
      "the OPTIONS toggle is an uppercase action link like Scholar's own",
      (await evaluate(client, "document.getElementById('shx-options-toggle').textContent")) === "Options",
    );
    check(
      "every role has a legend entry and a filter checkbox",
      (await evaluate(client, "document.querySelectorAll('#shx-panel .shx-legend-item').length")) === 6 &&
        (await evaluate(client, "document.querySelectorAll('#shx-panel .shx-role-grid input[type=checkbox]').length")) === 6,
    );
    check(
      "the panel only carries the storage-driven sections inside Scholar's sidebar",
      (await evaluate(client, "document.getElementById('gsc_rsb').contains(document.getElementById('shx-panel'))")) === true &&
        (await evaluate(client, "document.getElementById('shx-panel').nextElementSibling.id")) === "gsc_rsb_cit",
    );

    // ---------------------------------------------------------------- rows
    const rows = await evaluate(client, readRowsExpression());
    const rowExpectations = [...expected.rows, ...expected.page2Rows];
    // expected-profile.json records the accent the *classifier* derives from the
    // byline. The DOM only carries a class for roles that are enabled, and
    // DEFAULT_SETTINGS ships `middle: false` on purpose (a mid-list position is
    // rarely the story you want to see first). So a middle row is expected to
    // paint nothing here; the section further down proves the role's treatment
    // works as soon as it is switched on.
    const DISABLED_BY_DEFAULT = new Set(["middle"]);
    let rowMismatch = null;
    rows.forEach((row, index) => {
      const want = rowExpectations[index];
      if (!want) {
        rowMismatch = rowMismatch || `unexpected extra row ${row.index}`;
        return;
      }
      if (row.roles !== want.roles.join(" ")) {
        rowMismatch = rowMismatch || `row ${row.index} roles ${row.roles} != ${want.roles.join(" ")}`;
      }
      const wantAccent = DISABLED_BY_DEFAULT.has(want.accent) ? null : want.accent;
      if (row.accent !== wantAccent) {
        rowMismatch = rowMismatch || `row ${row.index} accent ${row.accent} != ${wantAccent}`;
      }
      if (row.corresponding !== want.roles.includes("corresponding")) {
        rowMismatch = rowMismatch || `row ${row.index} corresponding class`;
      }
      if (row.year !== want.year || row.citations !== want.citations) {
        rowMismatch = rowMismatch || `row ${row.index} year/citations ${row.year}/${row.citations}`;
      }
      if (want.matchedAuthor && row.matched !== want.matchedAuthor) {
        rowMismatch = rowMismatch || `row ${row.index} matched "${row.matched}" != "${want.matchedAuthor}"`;
      }
    });
    check("every row carries the documented roles and accent, straight from the DOM", rowMismatch === null, rowMismatch);

    const cofirstRow = rows[0];
    const secondRow = rows[1];
    const plainSecondRow = rows[5];
    const middleRow = rows[3];
    check(
      "co-first rows are visually distinct from second-author rows",
      cofirstRow.background !== secondRow.background &&
        cofirstRow.background !== plainSecondRow.background &&
        cofirstRow.background !== middleRow.background,
      `${cofirstRow.background} vs ${secondRow.background} vs ${plainSecondRow.background}`,
    );
    check(
      "the co-first row uses the co-first accent colour on its left edge",
      /124,\s*77,\s*255/.test(cofirstRow.accentShadow),
      cofirstRow.accentShadow,
    );
    check(
      "the corresponding author gets the right-hand green accent",
      /19,\s*115,\s*51/.test(rows[2].correspondingShadow),
      rows[2].correspondingShadow,
    );
    check(
      "a row that is only corresponding (no positional role) still gets the accent",
      rows[4].corresponding === true && /19,\s*115,\s*51/.test(rows[4].correspondingShadow),
      rows[4].correspondingShadow,
    );
    check(
      "the owner's own name is marked inside the byline",
      cofirstRow.marked.length === 1 && cofirstRow.marked[0] === "Alex Rivera",
      JSON.stringify(cofirstRow.marked),
    );
    check(
      "the name marking leaves the equal-contribution marker outside the mark",
      rows.every((row) => row.marked.every((text) => !/[*†✉]/.test(text))),
    );

    // ---------------------------------------------------------------- metrics
    let cells = await evaluate(client, readCellsExpression());
    check(
      `metrics over every loaded paper (${expected.allRows.papers} papers, ${expected.allRows.citations} citations, h ${expected.allRows.hIndex}, i10 ${expected.allRows.i10Index})`,
      cells.Papers.all === String(expected.allRows.papers) &&
        cells.Citations.all === String(expected.allRows.citations) &&
        cells["h-index"].all === String(expected.allRows.hIndex) &&
        cells["i10-index"].all === String(expected.allRows.i10Index),
      JSON.stringify(cells),
    );
    check(
      "the default role set highlights every role except 'middle' (15 papers, 125 citations)",
      cells.Papers.highlighted === "15" && cells.Citations.highlighted === "125",
      `${cells.Papers.highlighted} papers / ${cells.Citations.highlighted} citations`,
    );
    check(
      "Scholar's own totals are shown next to the recomputed ones",
      /128 citations/.test(await evaluate(client, "document.querySelector('#shx-panel .shx-note').textContent")),
      await evaluate(client, "document.querySelector('#shx-panel .shx-note').textContent"),
    );
    check(
      "the papers-per-year chart is an inline SVG with one group per year (2019-2026)",
      (await evaluate(client, "document.querySelectorAll('#shx-panel .shx-chart-svg .shx-bar-group').length")) === 8 &&
        (await evaluate(client, "document.querySelectorAll('#shx-panel .shx-chart-svg .shx-bar-marked').length")) > 0,
    );

    // ---------------------------------------------------------------- role filter
    await evaluate(client, "document.getElementById('shx-role-cofirst').click()");
    const cofirstOff = await waitForValue(
      client,
      `document.querySelectorAll("#gsc_a_b tr.gsc_a_tr.shx-hl").length`,
      11,
      8000,
      "waiting for the co-first filter to apply",
    );
    check("unchecking 'co-first' removes exactly the four co-first rows", cofirstOff);
    cells = await evaluate(client, readCellsExpression());
    check(
      "the metrics follow the filter (11 papers, 85 citations)",
      cells.Papers.highlighted === "11" && cells.Citations.highlighted === "85",
      `${cells.Papers.highlighted} papers / ${cells.Citations.highlighted} citations`,
    );
    check(
      "a filtered-out co-first row is no longer coloured as co-first",
      (await evaluate(client, "document.querySelectorAll('#gsc_a_b tr.gsc_a_tr.shx-a-cofirst').length")) === 0 &&
        (await evaluate(client, "document.getElementById('gsc_a_b').children[0].classList.contains('shx-hl')")) === false,
    );
    await evaluate(client, "document.getElementById('shx-role-cofirst').click()");
    check(
      "re-checking 'co-first' restores the four rows",
      await waitForValue(client, `document.querySelectorAll("#gsc_a_b tr.gsc_a_tr.shx-hl").length`, 15, 8000, "restoring"),
    );

    // ---------------------------------------------------------------- focus mode
    await evaluate(client, "document.getElementById('shx-focus').click()");
    const focused = await waitForValue(
      client,
      `(() => {
        const rows = Array.from(document.querySelectorAll("#gsc_a_b tr.gsc_a_tr"));
        const hidden = rows.filter((row) => row.classList.contains("shx-hidden")).length;
        const wrong = rows.filter((row) => row.classList.contains("shx-hidden") === row.classList.contains("shx-hl")).length;
        return hidden + ":" + wrong;
      })()`,
      "5:0",
      8000,
      "waiting for focus mode",
    );
    check("focus mode hides the five unhighlighted rows and nothing else", focused);
    await evaluate(client, "document.getElementById('shx-focus').click()");
    check(
      "leaving focus mode shows every row again",
      await waitForValue(client, `document.querySelectorAll("#gsc_a_b tr.gsc_a_tr.shx-hidden").length`, 0, 8000, "leaving focus mode"),
    );

    // ---------------------------------------------------------------- year range
    await evaluate(client, `(() => {
      const select = document.querySelectorAll("#shx-panel .shx-year")[0];
      select.value = "2024";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    })()`);
    cells = await waitForValue(
      client,
      `document.querySelectorAll("#shx-panel .shx-metrics tbody tr")[0].querySelectorAll("td")[1].textContent`,
      "10",
      8000,
      "waiting for the year range",
    );
    check("the year range restricts the metrics to 2024+ (10 papers)", cells);
    check(
      "rows outside the year range are hidden",
      (await evaluate(client, "document.querySelectorAll('#gsc_a_b tr.gsc_a_tr.shx-hidden').length")) === 10,
      await evaluate(client, "document.querySelectorAll('#gsc_a_b tr.gsc_a_tr.shx-hidden').length"),
    );
    await evaluate(client, `(() => {
      const select = document.querySelectorAll("#shx-panel .shx-year")[0];
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    })()`);
    check(
      "clearing the year range restores all 20 papers",
      await waitForValue(
        client,
        `document.querySelectorAll("#shx-panel .shx-metrics tbody tr")[0].querySelectorAll("td")[1].textContent`,
        "20",
        8000,
        "clearing the year range",
      ),
    );

    // ------------------------------------------------- middle role (off by default)
    // The row loop above expects no accent on middle rows, because DEFAULT_SETTINGS
    // ships `middle: false`. Prove the role still has a working treatment.
    check(
      "'middle' rows carry no accent while the role ships disabled",
      (await evaluate(client, "document.querySelectorAll('#gsc_a_b tr.gsc_a_tr.shx-a-middle').length")) === 0,
    );
    await evaluate(client, "document.getElementById('shx-role-middle').click()");
    check(
      `enabling 'middle' paints exactly the ${expected.roleCounts.middle} middle rows`,
      await waitForValue(
        client,
        "document.querySelectorAll('#gsc_a_b tr.gsc_a_tr.shx-a-middle').length",
        expected.roleCounts.middle,
        8000,
        "enabling the middle role",
      ),
    );
    await evaluate(client, "document.getElementById('shx-role-middle').click()");
    check(
      "disabling it again removes the accent",
      await waitForValue(
        client,
        "document.querySelectorAll('#gsc_a_b tr.gsc_a_tr.shx-a-middle').length",
        0,
        8000,
        "restoring the default role set",
      ),
    );

    // ---------------------------------------------------------------- theme
    const theme = await evaluate(client, "document.documentElement.dataset.shxTheme");
    check(`the resolved theme is published on <html> (${theme})`, theme === "light" || theme === "dark");
  } finally {
    if (client) client.close();
    server.close();
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    child.kill();
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }

  console.log(
    `\nverify: ${failures === 0 ? "PASS" : "FAIL"} (${checks - failures}/${checks} checks passed)`,
  );
  console.log(`(the throw-away verification build is at ${buildDir})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nverify: FAIL — ${error.message}`);
  process.exit(1);
});
