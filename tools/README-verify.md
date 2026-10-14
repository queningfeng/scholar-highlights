# Verification harness

`tools/verify-chrome.mjs` is the only check that proves the extension is really
loadable and really does something to a page. Everything else in `tests/` runs
the logic in Node, which cannot execute DOM code.

## What it does

1. Builds a throw-away copy of the extension in `tools/.verify-build/`. The only
   difference from the shipped build is the match pattern
   (`http://127.0.0.1/*` instead of `scholar.google.com`); `src/`, `styles/`,
   `assets/` and `options.html` are copied verbatim.
2. Serves the repository over HTTP on an ephemeral port.
3. Launches `chrome --headless=new --load-extension=... --remote-debugging-port=...`
   with a scratch profile in `tools/.verify-profile/`, opening
   `tests/fixtures/sample-profile.html` - an offline reproduction of a Google
   Scholar author profile with the author's real papers.
4. Speaks the DevTools protocol over Node's built-in `WebSocket` (no npm
   packages) and asserts, on the rendered page:
   - the content script injected `#shx-panel` into Scholar's sidebar, right
     before `#gsc_rsb_cit`, and left it collapsed behind `OPTIONS`;
   - auto-expansion clicked `#gsc_bpf_more` until all 20 papers were present,
     and left Scholar's own table header alone;
   - every row carries the documented `data-shx-roles`, accent class,
     corresponding class, year and citation count;
   - a co-first row's background colour differs from a second-author row and
     from an unhighlighted row (the whole point of the extension);
   - the owner's name is wrapped in `.shx-me` inside the byline and the
     equal-contribution marker stays outside the mark;
   - the metrics read 20 / 196 / h 9 / i10 8 for all loaded papers and
     15 / 125 for the default role set, next to Scholar's own totals;
   - the papers-per-year SVG has one group per year (2019-2026);
   - unchecking `co-first` removes exactly four rows and updates the metrics,
     focus mode hides exactly the five unhighlighted rows, and a 2024+ year
     range restricts both rows and metrics.

## Running it

```sh
node tools/verify-chrome.mjs
```

Requires a local Chrome (or Edge) install. `CHROME_PATH` overrides the search.
Exit code 0 means every check passed; the output lists each check.

## Environment note (why this may be skipped)

Chromium needs named pipes and the ability to spawn the crashpad handler. In a
locked-down or sandboxed shell that forbids those, Chrome refuses to start:

```
[ERROR:third_party\crashpad\...\crashpad_client_win.cc:430] OpenProcess: 拒绝访问。 (0x5)
[FATAL:mojo\public\cpp\platform\platform_channel.cc:187] Check failed: ... 拒绝访问。 (0x5)
crash server failed to launch, self-terminating
```

That is an environment limitation, not an extension problem: run the harness
from a normal desktop session (no `--dump-dom`/headless restrictions needed
beyond the flags the script passes) and it will work. In a build environment
that cannot start a browser, treat the Node suite
(`node tests/run.js`, including `tests/cases/fixture.test.js`, which classifies
the very same fixture profile) as the substitute, and run this script on your
own machine once.

## Manual check in a real browser instead

If you prefer to look at it yourself:

1. Temporarily change `manifest.content_scripts[0].matches` (in a copy of the
   folder, never in the shipped file) to `["http://127.0.0.1/*", "file:///*"]`,
   or add the fixture path to the matches.
2. Load the copy as an unpacked extension.
3. Serve this repository (`npx serve .`, `python -m http.server`) and open
   `http://127.0.0.1:PORT/tests/fixtures/sample-profile.html`.

The fixture's inline script simulates Scholar's pagination: the first click on
`Show more` appends 8 more rows and then hides the button, exactly like the real
page once the list is exhausted.
