/*!
 * Scholar Highlights - authorship-role highlighting for Google Scholar author
 * profile pages (https://scholar.google.com/citations?user=...).
 *
 * This file is the extension's single content script. It is a classic (non
 * module) script on purpose: MV3 content scripts cannot use static `import`,
 * and dynamic `import()` of an extension URL from a content script needs
 * `web_accessible_resources` and behaves differently across engines. One plain
 * script has identical semantics everywhere and needs no build step.
 *
 * The same file is also the shared implementation for two other consumers:
 *   - the Node test suite (`require("../src/content.js")`, see module.exports)
 *   - the options page (`options.html` loads it first, then src/options.js,
 *     and talks to `globalThis.ScholarHighlights`)
 *
 * Privacy: no network access, no host permissions, no background script. The
 * only browser API used is `storage.sync` (plus `runtime.openOptionsPage` when
 * the user clicks "Settings"). Nothing ever leaves the browser.
 *
 * License: MIT (c) Ningfeng Que
 */

"use strict";

const ScholarHighlights = (function () {
  "use strict";

  // =========================================================================
  // 1. Constants
  // =========================================================================

  const VERSION = "1.0.0";

  /** Every role the extension knows, in panel / legend order. */
  const ROLE_KEYS = [
    "first",
    "cofirst",
    "corresponding",
    "second",
    "last",
    "middle",
  ];

  const ROLE_LABELS = {
    first: "First",
    cofirst: "Co-first",
    corresponding: "Corresponding",
    second: "Second",
    last: "Last",
    middle: "Middle",
  };

  const ROLE_NOTES = {
    first: "First (sole first author): first in the byline without a shared equal-contribution marker.",
    cofirst: "Co-first (共同第一作者): shares an equal-contribution marker (* † ‡ § ¶ # or a superscript) with another author.",
    corresponding: "Corresponding: carries the ✉ marker, or is the last author of an untruncated byline that has no ✉ at all.",
    second: "Second: second in the byline, without a shared equal-contribution marker.",
    last: "Last: last author of an untruncated byline.",
    middle: "Middle: neither first, second nor last.",
  };

  /** Order used to pick the single "accent" colour of a highlighted row. */
  const POSITIONAL_PRIORITY = ["cofirst", "first", "second", "last", "middle"];

  /** Symbols that carry authorship meaning. */
  const SYMBOL_MARKERS = "*†‡§¶#✉";

  /** The corresponding-author marker. */
  const CORRESPONDING_MARKER = "✉";

  /** Unicode superscript digits / letters used for affiliation footnotes. */
  const SUPERSCRIPT_MARKERS = "⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵇᶜᵈᵉᶠ";

  /** The host page is the extension's only coupling to Scholar. */
  const SELECTORS = Object.freeze({
    profileName: "#gsc_prf_in",
    profileInfo: ".gsc_prf_il",
    otherNames: "#gs_prf_ion_txt",
    papersTable: "#gsc_a_t",
    rowsBody: "#gsc_a_b",
    row: "tr.gsc_a_tr",
    title: "a.gsc_a_at",
    authors: "div.gs_gray",
    citations: "a.gsc_a_ac",
    year: "span.gsc_a_h",
    showMore: "#gsc_bpf_more",
    sidebarStats: "#gsc_rsb_st",
    sidebarCitedBy: "#gsc_rsb_cit",
    sidebarRoot: "#gsc_rsb",
    panel: "#shx-panel",
  });

  const LIMITS = Object.freeze({
    /** Hard cap on "Show more" pages (20 rows each) while auto-loading. */
    maxExpandPages: 60,
    /** Per-click wait for new rows. */
    expandClickTimeoutMs: 8000,
    /** Overall auto-expand budget. */
    expandBudgetMs: 90000,
    /** Breather between clicks so Scholar does not rate-limit us. */
    expandClickGapMs: 200,
    /** How long to wait for the profile DOM before giving up. */
    profileWaitMs: 10000,
    /** Row batches appended by the page are absorbed after this idle time. */
    rowBatchDebounceMs: 120,
  });

  const STORAGE_KEYS = Object.freeze({
    settings: "settings",
    overrides: "overrides",
    aliases: "aliases",
  });

  const DEFAULT_SETTINGS = Object.freeze({
    version: 1,
    /** Roles that are highlighted by default. `middle` is off on purpose:
     *  a mid-list position is rarely the story you want to see first. */
    enabledRoles: Object.freeze({
      first: true,
      cofirst: true,
      corresponding: true,
      second: true,
      last: true,
      middle: false,
    }),
    autoExpand: true,
    highlightName: true,
    focusMode: false,
    theme: "auto", // "auto" | "light" | "dark"
    useProfilePreset: true,
  });

  /** Every value a manual override may carry, keyed by its folded form. */
  const OVERRIDE_ROLE_ALIASES = Object.freeze({
    first: "first",
    "1st": "first",
    cofirst: "cofirst",
    "co first": "cofirst",
    "equal first": "cofirst",
    equal: "cofirst",
    corresponding: "corresponding",
    corr: "corresponding",
    correspondingauthor: "corresponding",
    second: "second",
    "2nd": "second",
    last: "last",
    senior: "last",
    middle: "middle",
    none: "none",
    "-": "none",
    no: "none",
  });

  /**
   * Built-in knowledge about specific profiles. Used only to seed defaults:
   * the extension works on any profile, and everything here can be overridden
   * by the user in the options page.
   */
  const KNOWN_PROFILES = Object.freeze({
    ZxrkoP4AAAAJ: Object.freeze({
      id: "ZxrkoP4AAAAJ",
      label: "Ningfeng Que (阙宁峰), Peking University",
      matchNames: ["Ningfeng Que", "NingFeng Que", "阙宁峰"],
      aliases: [
        "NingFeng Que",
        "Ningfeng Que",
        "N. Que",
        "Que Ningfeng",
        "Que, Ningfeng",
        "阙宁峰",
      ],
      /**
       * Equal-contribution facts that Google Scholar's byline does not show
       * (Scholar strips the shared `*` / `†` markers). They ship as a preset
       * and are only used while the stored override map is empty, so anything
       * the user writes in the options page always wins.
       *
       * This list is the author's own answer, verified against the publisher
       * records -- do not add to it by inference:
       *   co-first : CoInS-Net, StateXDiff, MLAR-UNet, VTCNet, FOCUS
       *   NOT co-first: C2-STi (sole first author) and the hydrogel review
       *   (a genuine second-author paper).
       *
       * Keys are normalizeTitle() output; tests/cases/preset.test.js pins them.
       */
      presetOverrides: Object.freeze({
        "coins net a continuous position aware network for joint medical image interpolation and segmentation":
          "cofirst",
        "statexdiff cell state contextualized multimodal diffusion for single cell perturbation prediction":
          "cofirst",
        "mlar unet ldct image denoising based on u net with multiple lightweight attention based modules and residual reinforcement":
          "cofirst",
        "vtcnet a feature fusion dl model based on cnn and vit for the classification of cervical cells":
          "cofirst",
        // FOCUS. Both titles are listed because the preprint was renamed; a
        // profile can still show either one.
        "coordinated enhancement of molecular and spatial fidelity for biological inference in spatial transcriptomics":
          "cofirst",
        "a foundational generative model for cross platform unified enhancement of spatial transcriptomics":
          "cofirst",
      }),
    }),
  });

  // =========================================================================
  // 2. Text helpers (pure)
  // =========================================================================

  const COMBINING_MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff]/g;
  const WORD_CHAR = /[0-9a-z\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

  /** Lowercase + strip diacritics. */
  function stripDiacritics(text) {
    return String(text == null ? "" : text)
      .normalize("NFKD")
      .replace(COMBINING_MARKS, "");
  }

  /**
   * Canonical comparison form of a string: lowercase, diacritics removed,
   * every run of non-alphanumeric characters collapsed into one space.
   */
  function fold(text) {
    const lowered = stripDiacritics(text).toLowerCase();
    let out = "";
    let pendingSpace = false;
    for (const char of lowered) {
      if (WORD_CHAR.test(char)) {
        if (pendingSpace && out) out += " ";
        pendingSpace = false;
        out += char;
      } else {
        pendingSpace = true;
      }
    }
    return out;
  }

  /** Normalised title key used by the manual override list. */
  function normalizeTitle(title) {
    return fold(title);
  }

  /**
   * Fold `text` for substring search while keeping a map from every folded
   * character back to its index in the original string. This is what makes
   * "N. Que" findable inside "Yujia Sun, N. Que, Peiting Shi" without any
   * regular-expression escaping or lookbehind support.
   *
   * @param {string} text
   * @returns {{folded: string, map: number[]}}
   */
  function foldForSearch(text) {
    const raw = stripDiacritics(text).toLowerCase();
    const chars = [];
    const indexes = [];
    for (let i = 0; i < raw.length; i += 1) {
      const char = raw[i];
      if (WORD_CHAR.test(char)) {
        chars.push(char);
        indexes.push(i);
      } else {
        chars.push(" ");
        indexes.push(i);
      }
    }
    const folded = [];
    const map = [];
    let pendingSpace = true; // trims leading whitespace
    for (let i = 0; i < chars.length; i += 1) {
      if (chars[i] === " ") {
        if (pendingSpace) continue;
        pendingSpace = true;
      } else {
        pendingSpace = false;
      }
      folded.push(chars[i]);
      map.push(indexes[i]);
    }
    while (folded.length && folded[folded.length - 1] === " ") {
      folded.pop();
      map.pop();
    }
    return { folded: folded.join(""), map };
  }

  /** Split a comma separated list of names ("A, B" / "A、B" / "A;B"). */
  function splitNameList(text) {
    return String(text == null ? "" : text)
      .split(/[,;、，；]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * Split an author byline into fragments, one per comma/semicolon separated
   * name, and record whether the list is truncated ("et al.", "...").
   *
   * @param {string} text
   * @returns {{fragments: string[], truncated: boolean}}
   */
  function splitByline(text) {
    let raw = String(text == null ? "" : text).replace(/\u00a0/g, " ");
    raw = raw.replace(/\bet\s*\.?\s*al\.?/gi, " … ").replace(/\.\.\.|…/g, " … ");
    // "A, B and C" is a three author list, not a two author list.
    raw = raw.replace(/\s+and\s+/gi, ", ").replace(/\s*&\s*/g, ", ");
    const truncated = raw.includes("…");
    const head = truncated ? raw.slice(0, raw.indexOf("…")) : raw;
    const pieces = head
      .split(/[,;，；]/)
      .map((piece) =>
        piece
          .replace(/^[\s&]+/, "")
          .replace(/\band\b\s*$/i, "")
          .replace(/[\s.!?'"()[\]]+$/, "")
          .trim(),
      )
      .filter(Boolean);

    // A fragment that carries nothing but markers ("Smith1,2") belongs to the
    // previous author; keeping it separate would shift every later position.
    const fragments = [];
    for (const piece of pieces) {
      const scanned = scanFragment(piece);
      if (!scanned.body && fragments.length) {
        fragments[fragments.length - 1] += `,${piece}`;
        continue;
      }
      fragments.push(piece);
    }
    return { fragments, truncated };
  }

  // =========================================================================
  // 3. Markers (pure)
  // =========================================================================

  const TRAILING_PUNCT = /[\s.!?'"()[\]{}]+$/;
  const SUPERSCRIPT_TAIL = /[\u2070-\u2079\u00b9\u00b2\u00b3\u1d43-\u1d5f]+$/;
  const GLUED_DIGIT_TAIL = /([0-9]{1,3}(?:\s*[,/]\s*[0-9]{1,3})*)([a-f])$/i;
  const DIGIT_TAIL = /([0-9]{1,3}(?:\s*[,/]\s*[0-9]{1,3})*)$/;
  const LETTER_AFTER_SYMBOL = /[*†‡§¶#✉]([a-f])$/i;

  /** @param {Set<string>} target @param {string} run */
  function addNumberMarkers(target, run) {
    for (const part of String(run).split(/[,/]/)) {
      const value = part.trim();
      if (value) target.add(value);
    }
  }

  /**
   * Read the authorship markers of one byline fragment.
   *
   * Recognised markers:
   *   - symbols anywhere in the fragment: * † ‡ § ¶ # ✉
   *   - Unicode superscripts: ¹ ² ³ ᵃ ᵇ ...
   *   - an ASCII digit run at the very end: "Que1", "Que1,2"
   *   - an ASCII letter glued to a digit or to a symbol: "Que1a", "Que*a"
   *
   * A bare ASCII letter separated by a space ("Que a") is deliberately *not*
   * a marker: half of all surnames end in a-f, so treating "Ningfeng Que" as
   * carrying an "e" marker would invent equal-contribution pairs out of thin
   * air. Superscript letters and the manual override list cover that case.
   *
   * @param {string} fragment
   * @returns {{body: string, markers: Set<string>}}
   */
  function scanFragment(fragment) {
    const markers = new Set();
    const text = String(fragment == null ? "" : fragment).replace(
      TRAILING_PUNCT,
      "",
    );
    let tail = text;

    const superscript = SUPERSCRIPT_TAIL.exec(tail);
    if (superscript) {
      for (const char of superscript[0]) markers.add(char);
      tail = tail.slice(0, tail.length - superscript[0].length);
    }

    const glued = GLUED_DIGIT_TAIL.exec(tail);
    if (glued) {
      addNumberMarkers(markers, glued[1]);
      markers.add(glued[2].toLowerCase());
      tail = tail.slice(0, tail.length - glued[0].length);
    } else {
      const digits = DIGIT_TAIL.exec(tail);
      if (digits) {
        addNumberMarkers(markers, digits[1]);
        tail = tail.slice(0, tail.length - digits[0].length);
      } else {
        const letter = LETTER_AFTER_SYMBOL.exec(tail);
        if (letter) {
          markers.add(letter[1].toLowerCase());
          tail = tail.slice(0, tail.length - 2);
        }
      }
    }

    for (const char of text) {
      if (SYMBOL_MARKERS.includes(char)) markers.add(char);
    }

    const body = tail.replace(/[*†‡§¶#✉]/g, " ").trim();
    return { body, markers };
  }

  /** @param {Set<string>} markers */
  function hasCorrespondingMarker(markers) {
    return markers.has(CORRESPONDING_MARKER);
  }

  // =========================================================================
  // 4. Author matching (pure)
  // =========================================================================

  const STRONG_PART_MIN = 2;

  /** @param {string} text @returns {string[]} */
  function nameParts(text) {
    const folded = fold(text);
    return folded ? folded.split(" ") : [];
  }

  /**
   * Build the list of identities the owner may appear as: the profile's
   * display name plus every alias ("Also published as", user list, presets).
   *
   * @param {string} displayName
   * @param {string[]} aliases
   * @returns {Array<{raw: string, parts: string[]}>}
   */
  function buildIdentities(displayName, aliases) {
    const identities = [];
    const seen = new Set();
    for (const raw of [displayName, ...(aliases || [])]) {
      const parts = nameParts(raw);
      if (!parts.length) continue;
      // A one-word identity shorter than three characters ("Li") would match
      // far too many strangers, so it is ignored as an identity.
      if (parts.length === 1 && parts[0].length < 3) continue;
      const key = parts.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      identities.push({ raw: String(raw), parts });
    }
    return identities;
  }

  /**
   * Score one candidate byline fragment (or merged span) against one identity.
   * Lower is better; `Infinity` means "cannot be this person".
   *
   * Rules:
   *   - at least one strong (>= 2 characters) word must be shared;
   *   - every other word must be a known word of the identity or a single
   *     initial of one, so "Ningfeng Que" never matches "Nina Quince";
   *   - the surname (last identity word) is the strongest signal, and a
   *     missing identity word costs a little so that the fuller reading of an
   *     ambiguous byline wins.
   *
   * @param {string} candidate
   * @param {{parts: string[]}} identity
   * @returns {number}
   */
  function scoreIdentity(candidate, identity) {
    const parts = nameParts(candidate);
    if (!parts.length) return Infinity;
    const identityParts = identity.parts;
    const known = new Set(identityParts);

    const shared = parts.filter(
      (part) => part.length >= STRONG_PART_MIN && known.has(part),
    );
    if (!shared.length) return Infinity;

    let score = 0;
    for (const part of parts) {
      if (known.has(part)) continue;
      if (part.length === 1) {
        score += identityParts.some((word) => word.startsWith(part)) ? 1 : 2;
        continue;
      }
      return Infinity;
    }

    for (const word of identityParts) {
      if (word.length === 1) continue;
      if (parts.includes(word)) continue;
      if (parts.some((part) => part.length === 1 && word.startsWith(part))) {
        continue;
      }
      score += 1;
    }

    const surname = identityParts[identityParts.length - 1];
    if (shared.includes(surname)) score -= 0.5;
    else if (shared.includes(identityParts[0])) score -= 0.25;

    return score;
  }

  /**
   * Find the profile owner in a byline.
   *
   * Author spans are matched, not just single fragments: a reversed name inside
   * a comma separated list ("Hao Tang, Que, Ningfeng, Mingzhe Li") must be read
   * as one author. Spans of up to three fragments are tried and the best score
   * wins; ties prefer the shorter span, then the earlier position.
   *
   * @param {string[]} fragments
   * @param {Array<{raw: string, parts: string[]}>} identities
   * @returns {{index: number, endIndex: number, text: string, score: number, identity: string}}
   */
  function findOwnerInByline(fragments, identities) {
    const best = {
      index: -1,
      endIndex: -1,
      text: "",
      score: Infinity,
      identity: "",
    };
    if (!fragments.length || !identities.length) return best;

    const maxSpan = 3;
    for (let start = 0; start < fragments.length; start += 1) {
      for (
        let end = start;
        end < Math.min(fragments.length, start + maxSpan);
        end += 1
      ) {
        // Matching runs on the marker-free text ("Ningfeng Que1" must compare
        // as "Ningfeng Que"); the raw text is what later gets marked in the
        // byline, so it is kept separately.
        const rawSpan = fragments.slice(start, end + 1);
        const candidate = rawSpan
          .map((fragment) => scanFragment(fragment).body)
          .join(", ");
        for (const identity of identities) {
          // Merging fragments costs nothing and is rewarded slightly, so that
          // "Que, N." is read as one author rather than as "Que" + a stray "N".
          const score =
            scoreIdentity(candidate, identity) - 0.25 * (end - start);
          if (score === Infinity) continue;
          const spanLength = end - start;
          const bestSpanLength = best.endIndex - best.index;
          const better =
            score < best.score - 1e-9 ||
            (Math.abs(score - best.score) < 1e-9 &&
              (spanLength < bestSpanLength ||
                (spanLength === bestSpanLength && start < best.index)));
          if (better) {
            best.index = start;
            best.endIndex = end;
            best.text = rawSpan.join(", ");
            best.score = score;
            best.identity = identity.raw;
          }
        }
      }
    }
    return best;
  }

  // =========================================================================
  // 5. Role classification (pure)
  // =========================================================================

  /** @returns {Record<string, boolean>} */
  function emptyRoles() {
    const roles = {};
    for (const key of ROLE_KEYS) roles[key] = false;
    return roles;
  }

  /** @param {Record<string, boolean>} roles @returns {string[]} */
  function activeRoleKeys(roles) {
    return ROLE_KEYS.filter((key) => Boolean(roles[key]));
  }

  /** @param {string} value @returns {Record<string, boolean>} */
  function parseRoleList(value) {
    const roles = emptyRoles();
    for (const token of String(value == null ? "" : value).split(/\s+/)) {
      if (token && Object.prototype.hasOwnProperty.call(roles, token)) {
        roles[token] = true;
      }
    }
    return roles;
  }

  /**
   * Positional + marker classification for one byline, given the owner's span.
   *
   * @param {{fragments: string[], truncated: boolean}} byline
   * @param {{index: number, endIndex: number}} owner
   * @returns {Record<string, boolean>}
   */
  function classifyPosition(byline, owner) {
    const roles = emptyRoles();
    const fragments = byline.fragments;
    const inOwnerSpan = (index) =>
      index >= owner.index && index <= owner.endIndex;

    const ownerMarkers = new Set();
    for (let i = owner.index; i <= owner.endIndex; i += 1) {
      for (const marker of scanFragment(fragments[i]).markers) {
        ownerMarkers.add(marker);
      }
    }

    const otherMarkers = new Set();
    const envelopePartners = [];
    fragments.forEach((fragment, index) => {
      if (inOwnerSpan(index)) return;
      for (const marker of scanFragment(fragment).markers) {
        otherMarkers.add(marker);
        if (marker === CORRESPONDING_MARKER) envelopePartners.push(index);
      }
    });

    const shared = [...ownerMarkers].filter((marker) =>
      otherMarkers.has(marker),
    );
    const sharedEqualMarkers = shared.filter(
      (marker) => marker !== CORRESPONDING_MARKER,
    );

    const isFirst = owner.index === 0;
    const isSecond = owner.index === 1;
    const isLast =
      !byline.truncated && owner.endIndex === fragments.length - 1;

    // Co-first: 共同第一作者. An equal-contribution marker shared with another
    // author is the definition. A shared ✉ only counts when the partner sits
    // in the leading pair, which is how "co-first + co-corresponding" papers
    // are annotated in practice.
    let cofirst = sharedEqualMarkers.length > 0;
    if (!cofirst && shared.includes(CORRESPONDING_MARKER) && (isFirst || isSecond)) {
      cofirst = envelopePartners.some((index) => index === 0 || index === 1);
    }

    const anyEnvelope = fragments.some((fragment) =>
      hasCorrespondingMarker(scanFragment(fragment).markers),
    );

    roles.cofirst = cofirst;
    roles.first = isFirst && !cofirst;
    roles.second = isSecond && !cofirst;
    roles.last = isLast;
    roles.corresponding =
      hasCorrespondingMarker(ownerMarkers) || (isLast && !anyEnvelope);
    roles.middle = !cofirst && !isFirst && !isSecond && !isLast;

    return roles;
  }

  /**
   * Parse one override value: a comma/semicolon separated list of roles
   * ("cofirst, corresponding"), a whole-phrase synonym ("equal first"), a
   * single role, or "none" / "-" to force a paper out of every highlight.
   *
   * @param {string} value
   * @returns {{roles: Record<string, boolean>, force: boolean, unknown: string[]}}
   */
  function parseOverrideValue(value) {
    const roles = emptyRoles();
    const unknown = [];
    let force = false;
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return { roles, force, unknown };
    if (/^[-–—]+$/.test(raw)) return { roles, force: true, unknown };

    const apply = (role) => {
      if (role === "none") force = true;
      else roles[role] = true;
    };

    for (const phrase of raw.split(/[,;|+]/)) {
      const foldedPhrase = fold(phrase);
      if (!foldedPhrase) continue;
      // A whole phrase first, so "equal first" cannot be read as "equal"
      // (a co-first synonym) plus "first".
      const direct = OVERRIDE_ROLE_ALIASES[foldedPhrase];
      if (direct) {
        apply(direct);
        continue;
      }
      const tokens = foldedPhrase.split(" ");
      let matched = false;
      for (const token of tokens) {
        const role = OVERRIDE_ROLE_ALIASES[token];
        if (!role) continue;
        apply(role);
        matched = true;
      }
      if (!matched) unknown.push(...tokens);
    }
    return { roles, force, unknown };
  }

  /** Normalise a stored override map so keys ignore case and punctuation. */
  function normalizeOverrideMap(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [key, value] of Object.entries(raw)) {
      const normalized = normalizeTitle(key);
      if (!normalized) continue;
      out[normalized] = String(value);
    }
    return out;
  }

  /** @returns {{roles: Record<string, boolean>, raw: string}|null} */
  function resolveOverride(overrides, title) {
    if (!overrides) return null;
    const key = normalizeTitle(title);
    if (!key) return null;
    const raw = overrides[key];
    if (raw === undefined) return null;
    const parsed = parseOverrideValue(raw);
    // A value that names no known role ("cofrist") is a typo, not an
    // instruction to clear the paper: fall back to automatic detection.
    if (!parsed.force && !activeRoleKeys(parsed.roles).length) return null;
    return { roles: parsed.roles, force: parsed.force, raw: String(raw) };
  }

  /**
   * Parse the options page textarea: one `title => role` entry per line, with
   * `#` comments allowed. Returns the normalised map plus a per-line error list
   * so the user sees exactly which entry was rejected and why.
   *
   * @param {string} text
   * @returns {{overrides: Record<string, string>, errors: Array<{line: number, text: string, reason: string}>}}
   */
  function parseOverrideLines(text) {
    const overrides = {};
    const errors = [];
    const lines = String(text == null ? "" : text).split(/\r?\n/);
    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) return;
      const separator = line.indexOf("=>");
      if (separator < 0) {
        errors.push({ line: index + 1, text: line, reason: '缺少 "=>"' });
        return;
      }
      const title = normalizeTitle(line.slice(0, separator));
      const value = line.slice(separator + 2).trim();
      if (!title) {
        errors.push({ line: index + 1, text: line, reason: "标题为空" });
        return;
      }
      const parsed = parseOverrideValue(value);
      if (parsed.unknown.length) {
        errors.push({
          line: index + 1,
          text: line,
          reason: `未知角色 "${parsed.unknown.join(" ")}"`,
        });
        return;
      }
      if (!parsed.force && !activeRoleKeys(parsed.roles).length) {
        errors.push({ line: index + 1, text: line, reason: "没有给出角色" });
        return;
      }
      overrides[title] = value;
    });
    return { overrides, errors };
  }

  /** Render an override map back into textarea text (sorted for stability). */
  function formatOverrideLines(overrides) {
    return Object.keys(overrides || {})
      .sort()
      .map((key) => `${key} => ${overrides[key]}`)
      .join("\n");
  }

  /** Parse the alias textarea: one alias per line.
   *  Commas are deliberately not separators, because a comma is also how a
   *  reversed name is written ("Que, Ningfeng"). */
  function parseAliasLines(text) {
    const seen = new Set();
    const aliases = [];
    for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
      const name = line.trim();
      const key = fold(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      aliases.push(name);
    }
    return aliases;
  }

  /**
   * Classify the profile owner's authorship of one paper.
   *
   * @param {object} paper
   * @param {string} paper.title
   * @param {string} paper.authors - raw byline as shown by Scholar
   * @param {string} paper.profileName
   * @param {string[]} [paper.aliases]
   * @param {Record<string, string>} [paper.overrides] - normalised title => role
   * @returns {{roles: Record<string, boolean>, detected: Record<string, boolean>,
   *   matchedAuthor: string, matchIndex: number, override: boolean,
   *   truncated: boolean}}
   */
  function classifyPaper(paper) {
    const byline = splitByline(paper.authors);
    const identities = buildIdentities(
      paper.profileName,
      paper.aliases || [],
    );
    const owner = findOwnerInByline(byline.fragments, identities);
    const detected =
      owner.index >= 0 ? classifyPosition(byline, owner) : emptyRoles();
    const override = resolveOverride(paper.overrides, paper.title);
    return {
      roles: override ? override.roles : detected,
      detected,
      matchedAuthor: owner.index >= 0 ? owner.text : "",
      matchIndex: owner.index,
      override: Boolean(override),
      truncated: byline.truncated,
    };
  }

  // =========================================================================
  // 6. Metrics (pure)
  // =========================================================================

  /**
   * h-index and i10-index of a list of citation counts. Input untouched.
   * @param {number[]} citationCounts
   * @returns {{hIndex: number, i10Index: number}}
   */
  function computeIndices(citationCounts) {
    const sorted = [...citationCounts].sort((a, b) => b - a);
    let hIndex = 0;
    while (hIndex < sorted.length && sorted[hIndex] > hIndex) hIndex += 1;
    return {
      hIndex,
      i10Index: sorted.filter((count) => count >= 10).length,
    };
  }

  /**
   * Aggregate a set of papers.
   * @param {Array<{citations?: number, year?: number|null}>} papers
   * @returns {{papers: number, citations: number, hIndex: number, i10Index: number,
   *   perYear: Record<string, number>, firstYear: number|null, lastYear: number|null}}
   */
  function summarizePapers(papers) {
    const counts = [];
    const perYear = {};
    let citations = 0;
    let firstYear = null;
    let lastYear = null;
    for (const paper of papers || []) {
      const cited = Number(paper && paper.citations) || 0;
      counts.push(cited);
      citations += cited;
      const year = paper && paper.year ? Number(paper.year) : null;
      if (year && Number.isFinite(year)) {
        perYear[String(year)] = (perYear[String(year)] || 0) + 1;
        if (firstYear === null || year < firstYear) firstYear = year;
        if (lastYear === null || year > lastYear) lastYear = year;
      }
    }
    return {
      papers: counts.length,
      citations,
      ...computeIndices(counts),
      perYear,
      firstYear,
      lastYear,
    };
  }

  /**
   * Continuous per-year series for the chart.
   * @param {Record<string, number>} highlightedPerYear
   * @param {Record<string, number>} totalPerYear
   * @returns {Array<{year: number, total: number, highlighted: number}>}
   */
  function buildYearSeries(highlightedPerYear, totalPerYear) {
    const years = new Set();
    for (const key of Object.keys(totalPerYear || {})) years.add(Number(key));
    for (const key of Object.keys(highlightedPerYear || {})) years.add(Number(key));
    const sorted = [...years].filter((year) => Number.isFinite(year)).sort((a, b) => a - b);
    if (!sorted.length) return [];
    const series = [];
    for (let year = sorted[0]; year <= sorted[sorted.length - 1]; year += 1) {
      series.push({
        year,
        total: (totalPerYear && totalPerYear[String(year)]) || 0,
        highlighted: (highlightedPerYear && highlightedPerYear[String(year)]) || 0,
      });
    }
    return series;
  }

  // =========================================================================
  // 7. Filtering (pure)
  // =========================================================================

  /** @param {number|string|null|undefined} year @param {{start: string, end: string}} range */
  function isYearInRange(year, range) {
    const start = range && range.start !== "" && range.start != null ? Number(range.start) : null;
    const end = range && range.end !== "" && range.end != null ? Number(range.end) : null;
    if (start === null && end === null) return true;
    if (year === null || year === undefined || !Number.isFinite(Number(year))) {
      return false; // a bounded range hides undated papers
    }
    const value = Number(year);
    if (start !== null && value < start) return false;
    if (end !== null && value > end) return false;
    return true;
  }

  /** @param {Record<string, boolean>} roles @param {Record<string, boolean>} enabled */
  function matchesRoleFilter(roles, enabled) {
    if (!roles || !enabled) return false;
    return ROLE_KEYS.some((key) => roles[key] && enabled[key]);
  }

  /**
   * What should happen to one publication row.
   * @param {{roles: Record<string, boolean>, year: number|null, citations: number}} row
   * @param {{enabledRoles: Record<string, boolean>, focusMode: boolean, years: {start: string, end: string}}} state
   * @returns {{inRange: boolean, highlighted: boolean, visible: boolean}}
   */
  function evaluateRow(row, state) {
    const inRange = isYearInRange(row.year, state.years);
    const highlighted = inRange && matchesRoleFilter(row.roles, state.enabledRoles);
    return {
      inRange,
      highlighted,
      visible: inRange && (!state.focusMode || highlighted),
    };
  }

  /** @param {Record<string, boolean>} roles @returns {string|null} */
  function positionalAccent(roles) {
    for (const key of POSITIONAL_PRIORITY) {
      if (roles && roles[key]) return key;
    }
    return null;
  }

  // =========================================================================
  // 8. Storage (browser, promise wrapper for Chrome + Firefox)
  // =========================================================================

  const SETTINGS_TIMEOUT_MS = 3000;

  function extensionApi() {
    return globalThis.browser || globalThis.chrome || null;
  }

  function storageArea() {
    const api = extensionApi();
    return api && api.storage && api.storage.sync ? api.storage.sync : null;
  }

  /**
   * Call one storage method and always resolve, whatever the engine hands back:
   * Firefox returns promises, Chrome accepts a callback and (since MV3) also
   * returns a promise. A watchdog resolves with `{}` if neither fires.
   *
   * @param {"get"|"set"|"remove"} method
   * @param {unknown} payload
   * @returns {Promise<Record<string, unknown>>}
   */
  function callStorage(method, payload) {
    const area = storageArea();
    if (!area || typeof area[method] !== "function") return Promise.resolve({});
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value && typeof value === "object" ? value : {});
      };
      const timer = setTimeout(() => {
        console.warn(
          `[Scholar Highlights] storage.${method} did not answer in time; using defaults`,
        );
        finish({});
      }, SETTINGS_TIMEOUT_MS);
      const done = (value) => {
        clearTimeout(timer);
        finish(value);
      };
      try {
        const maybePromise = area[method](payload, (value) => done(value));
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(done, (error) => {
            console.warn(`[Scholar Highlights] storage.${method} failed`, error);
            done({});
          });
        }
      } catch (error) {
        console.warn(`[Scholar Highlights] storage.${method} threw`, error);
        clearTimeout(timer);
        finish({});
      }
    });
  }

  function normalizeSettings(raw) {
    const stored = raw && typeof raw === "object" ? raw : {};
    const roles = { ...DEFAULT_SETTINGS.enabledRoles };
    if (stored.enabledRoles && typeof stored.enabledRoles === "object") {
      for (const key of ROLE_KEYS) {
        if (typeof stored.enabledRoles[key] === "boolean") {
          roles[key] = stored.enabledRoles[key];
        }
      }
    }
    const theme =
      stored.theme === "light" || stored.theme === "dark" ? stored.theme : "auto";
    return {
      enabledRoles: roles,
      autoExpand:
        typeof stored.autoExpand === "boolean"
          ? stored.autoExpand
          : DEFAULT_SETTINGS.autoExpand,
      highlightName:
        typeof stored.highlightName === "boolean"
          ? stored.highlightName
          : DEFAULT_SETTINGS.highlightName,
      focusMode:
        typeof stored.focusMode === "boolean"
          ? stored.focusMode
          : DEFAULT_SETTINGS.focusMode,
      theme,
      useProfilePreset:
        typeof stored.useProfilePreset === "boolean"
          ? stored.useProfilePreset
          : DEFAULT_SETTINGS.useProfilePreset,
    };
  }

  function loadSettings() {
    return callStorage("get", STORAGE_KEYS.settings).then((items) =>
      normalizeSettings(items[STORAGE_KEYS.settings]),
    );
  }

  function saveSettings(settings) {
    return callStorage("set", {
      [STORAGE_KEYS.settings]: {
        version: DEFAULT_SETTINGS.version,
        ...settings,
      },
    });
  }

  function loadOverrides() {
    return callStorage("get", STORAGE_KEYS.overrides).then((items) =>
      normalizeOverrideMap(items[STORAGE_KEYS.overrides]),
    );
  }

  function saveOverrides(overrides) {
    return callStorage("set", {
      [STORAGE_KEYS.overrides]: normalizeOverrideMap(overrides),
    });
  }

  function loadAliases() {
    return callStorage("get", STORAGE_KEYS.aliases).then((items) => {
      const stored = items[STORAGE_KEYS.aliases];
      if (Array.isArray(stored)) return stored.map(String).filter(Boolean);
      if (typeof stored === "string") return splitNameList(stored);
      return [];
    });
  }

  function saveAliases(aliases) {
    const list = Array.isArray(aliases) ? aliases.map(String).filter(Boolean) : [];
    return callStorage("set", { [STORAGE_KEYS.aliases]: list });
  }

  function onStorageChanged(listener) {
    const api = extensionApi();
    if (!api || !api.storage || !api.storage.onChanged) return () => {};
    const handler = (changes, areaName) => {
      if (areaName && areaName !== "sync") return;
      listener(changes);
    };
    api.storage.onChanged.addListener(handler);
    return () => api.storage.onChanged.removeListener(handler);
  }

  // =========================================================================
  // 9. DOM utilities (browser)
  // =========================================================================

  /**
   * Element builder - the only way this extension creates UI. Page derived
   * text is always passed as `text` or as a child string, so it can only ever
   * become a text node. No string-to-markup API is used anywhere in this
   * project, which tests/cases/policy.test.js enforces mechanically.
   *
   * @param {string} tag
   * @param {Record<string, unknown>} [props] - class, text, dataset, attrs,
   *   on (listener map), hidden, or a plain attribute
   * @param {Array<Node|string>|Node|string} [children]
   * @returns {HTMLElement}
   */
  function build(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null) continue;
      if (key === "class") node.className = String(value);
      else if (key === "text") node.textContent = String(value);
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key === "hidden") node.hidden = Boolean(value);
      else if (key === "on") {
        for (const [type, handler] of Object.entries(value)) {
          node.addEventListener(type, handler);
        }
      } else if (key === "attrs") {
        for (const [name, attrValue] of Object.entries(value)) {
          node.setAttribute(name, String(attrValue));
        }
      } else {
        node.setAttribute(key, String(value));
      }
    }
    const list = Array.isArray(children) ? children : children ? [children] : [];
    for (const child of list) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child);
    }
    return node;
  }

  function query(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function queryAll(selector, scope) {
    return Array.from((scope || document).querySelectorAll(selector));
  }

  function documentReady() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", () => resolve(), {
        once: true,
      });
    });
  }

  function waitForSelector(selector, timeoutMs) {
    const immediate = query(selector);
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const found = query(selector);
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(found);
        }
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  function debounce(fn, waitMs) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), waitMs);
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isElementVisible(element) {
    if (!element || !element.isConnected) return false;
    if (element.hidden) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  /** Relative luminance of a CSS colour, or null when it is transparent. */
  function colorLuminance(color) {
    if (!color) return null;
    const match = /rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,/\s]+([0-9.]+))?/i.exec(
      color,
    );
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (alpha === 0) return null;
    const [r, g, b] = [1, 2, 3].map((index) => Number(match[index]) / 255);
    // sRGB relative luminance (WCAG), good enough for a light/dark verdict.
    const channel = (value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  /**
   * Decide whether to draw the panel light or dark. "auto" looks at the page
   * first (Scholar itself has no dark theme, but a forced-dark browser or a
   * user stylesheet may repaint it) and only then at the OS preference.
   *
   * @param {string} theme
   * @returns {"light"|"dark"}
   */
  function resolveTheme(theme) {
    if (theme === "light" || theme === "dark") return theme;
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const luminance = colorLuminance(bodyBackground);
    if (luminance !== null) return luminance < 0.4 ? "dark" : "light";
    const media =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-color-scheme: dark)")
        : null;
    return media && media.matches ? "dark" : "light";
  }

  /**
   * Resolve the theme and publish it on <html>, because the highlighted rows
   * are Scholar's own table rows and cannot inherit from the panel.
   * @param {string} theme
   * @returns {"light"|"dark"}
   */
  function applyDocumentTheme(theme) {
    const resolved = resolveTheme(theme);
    document.documentElement.dataset.shxTheme = resolved;
    return resolved;
  }

  // =========================================================================
  // 10. Page reading (browser)
  // =========================================================================

  function readProfile() {
    const nameElement = query(SELECTORS.profileName);
    const displayName = nameElement ? nameElement.textContent.trim() : "";
    const aliases = [];

    // Best effort: the "Also published as" line, when Scholar renders one.
    const aliasPattern =
      /^(?:also published as|also known as|alternative names|别名|曾用名|其他姓名)\s*[:：]?\s*(.+)$/i;
    for (const row of queryAll(SELECTORS.profileInfo)) {
      const text = row.textContent.replace(/\s+/g, " ").trim();
      const match = aliasPattern.exec(text);
      if (match) aliases.push(...splitNameList(match[1]));
    }
    const otherNames = query(SELECTORS.otherNames);
    if (otherNames) aliases.push(...splitNameList(otherNames.textContent));

    return {
      displayName,
      aliases: [...new Set(aliases)].filter(
        (alias) => fold(alias) !== fold(displayName),
      ),
    };
  }

  /** The built-in profile entry for this page, by Scholar id then by name. */
  function detectKnownProfile(profile, href) {
    let userId = "";
    try {
      userId = new URL(href || location.href).searchParams.get("user") || "";
    } catch (error) {
      userId = "";
    }
    if (userId && KNOWN_PROFILES[userId]) return KNOWN_PROFILES[userId];
    const folded = fold(profile.displayName);
    if (!folded) return null;
    for (const entry of Object.values(KNOWN_PROFILES)) {
      if (entry.matchNames.some((name) => fold(name) === folded)) return entry;
    }
    return null;
  }

  function readRowElements() {
    // Scoped to the tbody and header-free, so Scholar's own table header or a
    // hypothetical layout change can never be filtered/hidden by mistake.
    const scope = query(SELECTORS.rowsBody) || document;
    return queryAll(SELECTORS.row, scope).filter(
      (row) => !row.querySelector("th"),
    );
  }

  function parseNumber(text) {
    const digits = String(text == null ? "" : text).replace(/[^0-9]/g, "");
    return digits ? Number.parseInt(digits, 10) : 0;
  }

  function parseYear(text) {
    const match = /(1[89][0-9]{2}|20[0-9]{2})/.exec(String(text == null ? "" : text));
    return match ? Number.parseInt(match[1], 10) : null;
  }

  /** The author byline element of a row (Scholar puts it in the first .gs_gray). */
  function rowAuthorsElement(row) {
    const cell = row.querySelector("td.gsc_a_t") || row;
    return cell.querySelector(SELECTORS.authors);
  }

  function classifyRow(row, context) {
    const authorsElement = rowAuthorsElement(row);
    const authors = authorsElement ? authorsElement.textContent.trim() : "";
    const titleElement = row.querySelector(SELECTORS.title);
    const title = titleElement ? titleElement.textContent.trim() : "";
    const result = classifyPaper({
      title,
      authors,
      profileName: context.profileName,
      aliases: context.aliases,
      overrides: context.overrides,
    });

    row.dataset.shxRoles = activeRoleKeys(result.roles).join(" ");
    row.dataset.shxDetected = activeRoleKeys(result.detected).join(" ");
    row.dataset.shxMatched = result.matchedAuthor;
    row.dataset.shxOverride = result.override ? "1" : "0";
    row.dataset.shxCites = String(
      parseNumber(
        (row.querySelector(SELECTORS.citations) || {}).textContent || "0",
      ),
    );
    const year = parseYear(
      (row.querySelector(SELECTORS.year) || {}).textContent || "",
    );
    if (year === null) delete row.dataset.shxYear;
    else row.dataset.shxYear = String(year);
    return result;
  }

  function rowData(row) {
    return {
      roles: parseRoleList(row.dataset.shxRoles || ""),
      year: row.dataset.shxYear ? Number(row.dataset.shxYear) : null,
      citations: Number(row.dataset.shxCites || 0),
      element: row,
    };
  }

  /** Profile's own totals, as printed in Scholar's sidebar table. */
  function readProfileTotals() {
    const table = query(SELECTORS.sidebarStats);
    if (!table) return null;
    const totals = {};
    for (const row of queryAll("tr", table)) {
      const cells = queryAll("td", row);
      if (cells.length < 2) continue;
      const label = fold(cells[0].textContent);
      const value = parseNumber(cells[1].textContent);
      if (label.startsWith("citation")) totals.citations = value;
      else if (label.startsWith("h index") || label === "hindex") totals.hIndex = value;
      else if (label.startsWith("i10")) totals.i10Index = value;
    }
    return Object.keys(totals).length ? totals : null;
  }

  // =========================================================================
  // 11. Applying state to the page (browser)
  // =========================================================================

  function applyRoleClasses(row, roles, enabledRoles) {
    const enabled = enabledRoles || {};
    const active = {};
    for (const key of ROLE_KEYS) {
      active[key] = Boolean(roles[key] && enabled[key]);
      row.classList.toggle(`shx-r-${key}`, active[key]);
    }
    const accent = positionalAccent(active);
    for (const key of ROLE_KEYS) {
      if (key !== "corresponding") {
        row.classList.toggle(`shx-a-${key}`, key === accent);
      }
    }
    row.classList.toggle("shx-corresponding", active.corresponding);
    return active;
  }

  function setRowLabel(row, activeRoles) {
    if (!activeRoles.length) {
      row.removeAttribute("title");
      row.removeAttribute("data-shx-label");
      return;
    }
    const label = activeRoles.map((key) => ROLE_LABELS[key]).join(" + ");
    row.dataset.shxLabel = label;
    // A tooltip is the least intrusive way to expose the role to a reader who
    // cannot rely on the colour, without injecting extra markup into Scholar.
    row.setAttribute("title", `Scholar Highlights: ${label}`);
  }

  /**
   * Apply the whole state to the given rows (all rows when omitted).
   * @param {object} state
   * @param {Iterable<HTMLElement>} [rows]
   */
  function applyState(state, rows) {
    const targets = rows ? Array.from(rows) : readRowElements();
    for (const row of targets) {
      const data = rowData(row);
      const verdict = evaluateRow(data, state);
      const active = applyRoleClasses(row, data.roles, state.enabledRoles);
      row.classList.toggle("shx-hl", verdict.highlighted);
      row.classList.toggle("shx-hidden", !verdict.visible);
      setRowLabel(row, verdict.highlighted ? activeRoleKeys(active) : []);
    }
  }

  // Name marking ------------------------------------------------------------

  function clearNameMarks(authorsElement) {
    const marks = queryAll(".shx-me", authorsElement);
    if (!marks.length) return false;
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
    return true;
  }

  /**
   * Wrap the owner's own name inside an author byline.
   * @param {Element} authorsElement
   * @param {string} matchedAuthor
   * @returns {boolean} whether anything was marked
   */
  function markOwnerName(authorsElement, matchedAuthor) {
    if (!authorsElement || !matchedAuthor) return false;
    const needle = foldForSearch(matchedAuthor).folded;
    if (!needle) return false;

    const textNodes = [];
    const walker = document.createTreeWalker(
      authorsElement,
      NodeFilter.SHOW_TEXT,
      null,
    );
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
      const text = node.nodeValue || "";
      const { folded, map } = foldForSearch(text);
      const at = folded.indexOf(needle);
      if (at < 0) continue;
      const before = at === 0 ? " " : folded[at - 1];
      const afterIndex = at + needle.length;
      const after = afterIndex >= folded.length ? " " : folded[afterIndex];
      if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) continue;

      const start = map[at];
      const end = map[afterIndex - 1] + 1;
      if (!(end > start)) continue;

      node.splitText(end);
      const middle = node.splitText(start);
      const mark = build("span", { class: "shx-me" });
      middle.parentNode.replaceChild(mark, middle);
      mark.append(middle);
      return true;
    }
    return false;
  }

  function applyNameMarking(enabled, rows) {
    const targets = rows ? Array.from(rows) : readRowElements();
    for (const row of targets) {
      const authorsElement = rowAuthorsElement(row);
      if (!authorsElement) continue;
      clearNameMarks(authorsElement);
      if (enabled && row.dataset.shxMatched) {
        markOwnerName(authorsElement, row.dataset.shxMatched);
      }
    }
  }

  // =========================================================================
  // 12. Panel (browser)
  // =========================================================================

  function legendItem() {
    return (key) =>
      build("div", { class: "shx-legend-item" }, [
        build("span", { class: `shx-swatch shx-swatch-${key}`, "aria-hidden": "true" }),
        build("span", { class: "shx-legend-text" }, [
          build("strong", { text: ROLE_LABELS[key] }),
          build("span", { class: "shx-legend-note", text: ROLE_NOTES[key] }),
        ]),
      ]);
  }

  /**
   * Build the sidebar panel.
   *
   * @param {object} options
   * @param {object} options.state
   * @param {object} options.handlers - { update, loadAll, openOptions }
   * @param {HTMLElement|null} options.profileTotals
   * @returns {object|null}
   */
  function mountPanel(options) {
    const { state, handlers } = options;
    const anchor = query(SELECTORS.sidebarCitedBy) || query(SELECTORS.sidebarStats);
    if (!anchor || !anchor.parentNode) return null;

    // A panel from a previous extension lifetime may still be in the DOM with
    // dead listeners (content scripts re-run when the extension reloads).
    const existing = document.getElementById("shx-panel");
    if (existing) existing.remove();

    const optionsToggle = build("button", {
      class: "shx-link",
      type: "button",
      text: "Options",
      id: "shx-options-toggle",
      attrs: {
        "aria-expanded": "false",
        "aria-controls": "shx-options",
        title: "展开/收起筛选与设置（角色、年份、专注模式）",
      },
    });

    const header = build("div", { class: "shx-head" }, [
      build("span", { class: "shx-head-title", text: "Highlights" }),
      optionsToggle,
    ]);

    const status = build("div", { class: "shx-status", hidden: true });

    // ---- metrics table
    const metricRows = [
      { key: "papers", label: "Papers" },
      { key: "citations", label: "Citations" },
      { key: "hIndex", label: "h-index" },
      { key: "i10Index", label: "i10-index" },
    ];
    const cells = {};
    const tableBody = build(
      "tbody",
      {},
      metricRows.map((metric) => {
        const highlighted = build("td", { class: "shx-num", text: "0" });
        const all = build("td", { class: "shx-num", text: "0" });
        cells[metric.key] = { highlighted, all };
        return build("tr", {}, [
          build("th", { class: "shx-metric-label", attrs: { scope: "row" }, text: metric.label }),
          highlighted,
          all,
        ]);
      }),
    );
    const table = build("table", { class: "shx-metrics" }, [
      build("thead", {}, [
        build("tr", {}, [
          build("th", {}),
          build("th", { class: "shx-num", text: "Highlighted" }),
          build("th", { class: "shx-num", text: "All loaded" }),
        ]),
      ]),
      tableBody,
    ]);

    const profileNote = build("p", { class: "shx-note", hidden: true });

    const chartHost = build("div", { class: "shx-chart" });

    const metricsHost = build("div", { class: "shx-metrics-block" }, [
      table,
      profileNote,
      chartHost,
    ]);

    // ---- options (collapsed by default)
    const roleInputs = new Map();
    const roleGrid = build(
      "div",
      { class: "shx-role-grid" },
      ROLE_KEYS.map((key) => {
        const input = build("input", {
          type: "checkbox",
          id: `shx-role-${key}`,
          on: {
            change: () => {
              const enabledRoles = { ...state.enabledRoles, [key]: input.checked };
              handlers.update({ enabledRoles });
            },
          },
        });
        input.checked = Boolean(state.enabledRoles[key]);
        roleInputs.set(key, input);
        return build("label", { class: "shx-check", for: `shx-role-${key}` }, [
          input,
          build("span", { class: `shx-swatch shx-swatch-${key}`, "aria-hidden": "true" }),
          build("span", { text: ROLE_LABELS[key] }),
        ]);
      }),
    );

    const startSelect = build("select", {
      class: "shx-year",
      attrs: { "aria-label": "First year" },
      on: { change: () => handlers.update({ years: { ...state.years, start: startSelect.value } }) },
    });
    const endSelect = build("select", {
      class: "shx-year",
      attrs: { "aria-label": "Last year" },
      on: { change: () => handlers.update({ years: { ...state.years, end: endSelect.value } }) },
    });

    const focusInput = build("input", {
      type: "checkbox",
      id: "shx-focus",
      on: { change: () => handlers.update({ focusMode: focusInput.checked }) },
    });
    focusInput.checked = Boolean(state.focusMode);

    const nameInput = build("input", {
      type: "checkbox",
      id: "shx-mark-name",
      on: { change: () => handlers.update({ highlightName: nameInput.checked }) },
    });
    nameInput.checked = Boolean(state.highlightName);

    const autoInput = build("input", {
      type: "checkbox",
      id: "shx-auto-expand",
      on: { change: () => handlers.update({ autoExpand: autoInput.checked }) },
    });
    autoInput.checked = Boolean(state.autoExpand);

    const loadAllButton = build("button", {
      class: "shx-button",
      type: "button",
      text: "Load all papers",
      title: "点完 Scholar 的 “Show more”，让指标覆盖全部论文",
      on: { click: () => handlers.loadAll() },
    });

    const settingsButton = build("button", {
      class: "shx-button",
      type: "button",
      text: "Settings…",
      title: "打开设置页：别名、手动覆盖、默认角色、主题",
      on: { click: () => handlers.openOptions() },
    });

    const optionsBody = build("div", { class: "shx-options", id: "shx-options" }, [
      build("div", { class: "shx-options-inner" }, [
        build("div", { class: "shx-legend" }, ROLE_KEYS.map(legendItem())),
        build("div", { class: "shx-field" }, [
          build("div", {
            class: "shx-field-label",
            text: "Highlight roles",
            title: "共同第一作者（共同一作）是独立角色，不等于第二作者",
          }),
          roleGrid,
        ]),
        build("div", { class: "shx-field" }, [
          build("div", { class: "shx-field-label", text: "Year range" }),
          build("div", { class: "shx-year-row" }, [startSelect, build("span", { text: "–" }), endSelect]),
        ]),
        build("div", { class: "shx-field" }, [
          build("label", {
            class: "shx-check",
            for: "shx-focus",
            title: "专注模式：隐藏所有未被高亮的论文行",
          }, [
            focusInput,
            build("span", { text: "Focus mode (hide everything else)" }),
          ]),
          build("label", {
            class: "shx-check",
            for: "shx-mark-name",
            title: "在作者列表里高亮你自己的名字",
          }, [
            nameInput,
            build("span", { text: "Highlight my name in bylines" }),
          ]),
          build("label", {
            class: "shx-check",
            for: "shx-auto-expand",
            title: "打开主页时自动点完 “Show more”",
          }, [
            autoInput,
            build("span", { text: "Load every paper on page load" }),
          ]),
        ]),
        build("div", { class: "shx-field shx-field-actions" }, [
          loadAllButton,
          settingsButton,
        ]),
      ]),
    ]);

    optionsToggle.addEventListener("click", () => {
      const open = optionsBody.classList.toggle("shx-open");
      optionsToggle.setAttribute("aria-expanded", String(open));
    });

    const section = build(
      "div",
      {
        class: "shx-section",
        id: "shx-panel",
        dataset: { shxTheme: applyDocumentTheme(state.theme) },
      },
      [header, optionsBody, status, metricsHost],
    );

    anchor.parentNode.insertBefore(section, anchor);

    // ---- chart -----------------------------------------------------------
    const SVG_NS = "http://www.w3.org/2000/svg";
    const CHART = { width: 200, height: 118, top: 12, right: 22, bottom: 18, left: 2 };

    function renderChart(series, theme) {
      chartHost.textContent = "";
      if (!series.length) {
        chartHost.append(
          build("p", { class: "shx-empty", text: "No dated papers to chart yet." }),
        );
        return;
      }
      const plotWidth = CHART.width - CHART.left - CHART.right;
      const plotHeight = CHART.height - CHART.top - CHART.bottom;
      const slot = plotWidth / series.length;
      const barWidth = Math.max(2, Math.min(14, slot * 0.68));
      const maxTotal = Math.max(...series.map((entry) => entry.total), 1);
      const maxHighlighted = Math.max(
        ...series.map((entry) => entry.highlighted),
        0,
      );
      const axisMax = Math.max(maxTotal, maxHighlighted, 1);

      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "shx-chart-svg");
      svg.setAttribute("viewBox", `0 0 ${CHART.width} ${CHART.height}`);
      svg.setAttribute("role", "img");
      svg.setAttribute(
        "aria-label",
        `Papers per year from ${series[0].year} to ${series[series.length - 1].year}`,
      );

      const log = (tag, attributes, text) => {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [name, value] of Object.entries(attributes)) {
          node.setAttribute(name, String(value));
        }
        if (text !== undefined) node.textContent = String(text);
        svg.append(node);
        return node;
      };

      const gridLines = 2;
      for (let i = 0; i <= gridLines; i += 1) {
        const value = Math.round((axisMax * i) / gridLines);
        const y = CHART.top + plotHeight - (i / gridLines) * plotHeight;
        log("line", {
          class: "shx-grid",
          x1: CHART.left,
          x2: CHART.left + plotWidth,
          y1: y,
          y2: y,
        });
        log("text", {
          class: "shx-axis-label",
          x: CHART.width - 2,
          y: y + 3,
          "text-anchor": "end",
        }, value);
      }

      const labelEvery = series.length <= 12 ? 1 : Math.ceil(series.length / 10);
      series.forEach((entry, index) => {
        const x = CHART.left + index * slot + (slot - barWidth) / 2;
        const totalHeight = (entry.total / axisMax) * plotHeight;
        const highlightedHeight = (entry.highlighted / axisMax) * plotHeight;
        const group = log("g", { class: "shx-bar-group" });
        const title = document.createElementNS(SVG_NS, "title");
        title.textContent = `${entry.year}: ${entry.highlighted} of ${entry.total} highlighted`;
        group.append(title);
        if (entry.total > 0) {
          const bar = document.createElementNS(SVG_NS, "rect");
          bar.setAttribute("class", "shx-bar");
          bar.setAttribute("x", x);
          bar.setAttribute("y", CHART.top + plotHeight - totalHeight);
          bar.setAttribute("width", barWidth);
          bar.setAttribute("height", Math.max(totalHeight, 1));
          group.append(bar);
        }
        if (entry.highlighted > 0) {
          const mark = document.createElementNS(SVG_NS, "rect");
          mark.setAttribute("class", "shx-bar-marked");
          mark.setAttribute("x", x);
          mark.setAttribute("y", CHART.top + plotHeight - highlightedHeight);
          mark.setAttribute("width", barWidth);
          mark.setAttribute("height", Math.max(highlightedHeight, 1));
          group.append(mark);
        }
        if (index % labelEvery === 0 || index === series.length - 1) {
          const label = document.createElementNS(SVG_NS, "text");
          label.setAttribute("class", "shx-year-label");
          label.setAttribute("x", CHART.left + index * slot + slot / 2);
          label.setAttribute("y", CHART.height - 4);
          label.setAttribute("text-anchor", "middle");
          label.textContent = String(entry.year);
          group.append(label);
        }
      });

      chartHost.dataset.shxTheme = theme;
      chartHost.append(svg);
      chartHost.append(
        build("p", {
          class: "shx-caption",
          text: `Papers per year, ${series[0].year}–${series[series.length - 1].year}. Dark share = highlighted.`,
        }),
      );
    }

    // ---- updates ---------------------------------------------------------
    let lastChartKey = "";

    function setStatus(message) {
      if (!message) {
        status.hidden = true;
        status.textContent = "";
        return;
      }
      status.hidden = false;
      status.textContent = message;
    }

    function metricValue(key, summary) {
      if (key === "papers") return summary.papers;
      if (key === "citations") return summary.citations;
      if (key === "hIndex") return summary.hIndex;
      return summary.i10Index;
    }

    function updateMetrics(currentState) {
      const rows = readRowElements();
      const all = [];
      const highlighted = [];
      for (const row of rows) {
        const data = rowData(row);
        if (!isYearInRange(data.year, currentState.years)) continue;
        all.push(data);
        if (row.classList.contains("shx-hl")) highlighted.push(data);
      }
      const summaryAll = summarizePapers(all);
      const summaryHighlighted = summarizePapers(highlighted);

      for (const metric of metricRows) {
        cells[metric.key].highlighted.textContent = String(
          metricValue(metric.key, summaryHighlighted),
        );
        cells[metric.key].all.textContent = String(
          metricValue(metric.key, summaryAll),
        );
      }

      const totals = options.profileTotals;
      if (totals) {
        const parts = [];
        if (typeof totals.citations === "number") parts.push(`${totals.citations} citations`);
        if (typeof totals.hIndex === "number") parts.push(`h-index ${totals.hIndex}`);
        if (typeof totals.i10Index === "number") parts.push(`i10-index ${totals.i10Index}`);
        profileNote.hidden = !parts.length;
        profileNote.textContent = parts.length
          ? `Scholar's own totals: ${parts.join(" · ")}`
          : "";
      }

      const series = buildYearSeries(
        summaryHighlighted.perYear,
        summaryAll.perYear,
      );
      const chartKey = JSON.stringify([series, currentState.theme]);
      if (chartKey !== lastChartKey) {
        lastChartKey = chartKey;
        renderChart(series, resolveTheme(currentState.theme));
      }
    }

    let knownYears = new Set();
    function refreshYearOptions(rows) {
      const scope = rows ? Array.from(rows) : readRowElements();
      const before = knownYears.size;
      for (const row of scope) {
        if (row.dataset.shxYear) knownYears.add(Number(row.dataset.shxYear));
      }
      if (knownYears.size === before && startSelect.options.length > 1) return;
      const years = [...knownYears].sort((a, b) => b - a);
      const fill = (select, placeholder, selected) => {
        select.textContent = "";
        select.append(build("option", { value: "", text: placeholder }));
        for (const year of years) {
          select.append(build("option", { value: String(year), text: String(year) }));
        }
        select.value = selected && years.includes(Number(selected)) ? selected : "";
      };
      fill(startSelect, "First year", state.years.start);
      fill(endSelect, "Last year", state.years.end);
    }

    function syncTheme(theme) {
      section.dataset.shxTheme = applyDocumentTheme(theme);
    }

    refreshYearOptions();

    return {
      element: section,
      update(currentState) {
        updateMetrics(currentState);
      },
      refreshYearOptions,
      syncTheme,
      setStatus,
      syncControls(currentState) {
        for (const [key, input] of roleInputs) {
          input.checked = Boolean(currentState.enabledRoles[key]);
        }
        focusInput.checked = Boolean(currentState.focusMode);
        nameInput.checked = Boolean(currentState.highlightName);
        autoInput.checked = Boolean(currentState.autoExpand);
      },
    };
  }

  // =========================================================================
  // 13. Auto-expansion of the publication list (browser)
  // =========================================================================

  function countRows() {
    return readRowElements().length;
  }

  function waitForMoreRows(previousCount, timeoutMs) {
    return new Promise((resolve) => {
      const body = query(SELECTORS.rowsBody) || query(SELECTORS.papersTable) || document.body;
      const check = () => {
        if (countRows() > previousCount) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(true);
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
      check();
    });
  }

  /**
   * Click Scholar's "Show more" until every paper row is loaded.
   * Stops when the button disappears, is disabled, stops producing rows, hits
   * the page cap, runs out of budget, or the caller aborts.
   *
   * @param {(progress: {loaded: number, pages: number}) => void} [onProgress]
   * @param {() => boolean} [isAborted]
   */
  async function loadAllPapers(onProgress, isAborted) {
    const button = query(SELECTORS.showMore);
    if (!button) return { pages: 0, loaded: countRows(), complete: true };
    const startedAt = Date.now();
    let pages = 0;
    for (let page = 0; page < LIMITS.maxExpandPages; page += 1) {
      if (isAborted && isAborted()) return { pages, loaded: countRows(), complete: false };
      if (Date.now() - startedAt > LIMITS.expandBudgetMs) {
        console.warn("[Scholar Highlights] auto-expand budget exhausted");
        return { pages, loaded: countRows(), complete: false };
      }
      const current = query(SELECTORS.showMore);
      if (!current || current.disabled || !isElementVisible(current)) {
        return { pages, loaded: countRows(), complete: true };
      }
      const before = countRows();
      current.click();
      pages += 1;
      const grew = await waitForMoreRows(before, LIMITS.expandClickTimeoutMs);
      if (onProgress) onProgress({ loaded: countRows(), pages });
      if (!grew) return { pages, loaded: countRows(), complete: true };
      await sleep(LIMITS.expandClickGapMs);
    }
    return { pages, loaded: countRows(), complete: false };
  }

  // =========================================================================
  // 14. Orchestrator (browser)
  // =========================================================================

  const STATE_SESSION_KEY = "schx.yearRange";

  function loadYearRange() {
    try {
      const raw = sessionStorage.getItem(STATE_SESSION_KEY);
      if (!raw) return { start: "", end: "" };
      const parsed = JSON.parse(raw);
      return { start: String(parsed.start || ""), end: String(parsed.end || "") };
    } catch (error) {
      return { start: "", end: "" };
    }
  }

  function saveYearRange(range) {
    try {
      sessionStorage.setItem(STATE_SESSION_KEY, JSON.stringify(range));
    } catch (error) {
      console.warn("[Scholar Highlights] could not remember the year range", error);
    }
  }

  async function run() {
    const profile = readProfile();
    if (!profile.displayName) return;

    const known = detectKnownProfile(profile, location.href);
    const [storedSettings, userOverrides, userAliases] = await Promise.all([
      loadSettings(),
      loadOverrides(),
      loadAliases(),
    ]);

    const presetOverrides =
      known && storedSettings.useProfilePreset ? known.presetOverrides : {};
    // A stored override always beats a shipped preset.
    const overrides = { ...presetOverrides, ...userOverrides };
    const aliases = [
      ...new Set([
        ...profile.aliases,
        ...(known ? known.aliases : []),
        ...userAliases,
      ]),
    ];

    const context = {
      profileName: profile.displayName,
      aliases,
      overrides,
    };
    const state = {
      ...storedSettings,
      years: loadYearRange(),
    };

    const profileTotals = readProfileTotals();
    let panel = null;
    let expanding = false;

    const applyAll = () => {
      applyState(state);
      if (panel) panel.update(state);
    };

    const PERSISTED_KEYS = [
      "enabledRoles",
      "focusMode",
      "highlightName",
      "autoExpand",
      "theme",
      "useProfilePreset",
    ];

    const handlers = {
      update(patch) {
        Object.assign(state, patch);
        if ("years" in patch) saveYearRange(state.years);
        if (PERSISTED_KEYS.some((key) => key in patch)) {
          const settings = {};
          for (const key of PERSISTED_KEYS) settings[key] = state[key];
          saveSettings(settings);
        }
        if ("theme" in patch && panel) panel.syncTheme(state.theme);
        applyAll();
        if ("highlightName" in patch) applyNameMarking(state.highlightName);
        if ("autoExpand" in patch && state.autoExpand && !expanding) {
          void expandAll();
        }
      },
      loadAll() {
        if (expanding) return;
        void expandAll(true);
      },
      openOptions() {
        const api = extensionApi();
        if (api && api.runtime && api.runtime.openOptionsPage) {
          api.runtime.openOptionsPage();
        }
      },
    };

    panel = mountPanel({ state, handlers, profileTotals });

    const absorbRows = (rows) => {
      const list = Array.from(rows);
      if (!list.length) return;
      for (const row of list) classifyRow(row, context);
      if (panel) panel.refreshYearOptions(list);
      applyState(state, list);
      if (state.highlightName) applyNameMarking(true, list);
      if (panel) panel.update(state);
    };

    const initialRows = readRowElements();
    absorbRows(initialRows);
    applyNameMarking(state.highlightName);

    // Rows appended later (auto-expansion or a manual "Show more") run through
    // the same pipeline, batched to keep big profiles linear.
    const pending = [];
    const flush = debounce(() => absorbRows(pending.splice(0)), LIMITS.rowBatchDebounceMs);
    if (query(SELECTORS.rowsBody)) {
      const observer = new MutationObserver((mutations) => {
        let added = false;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const element = /** @type {Element} */ (node);
            if (element.matches && element.matches(SELECTORS.row)) {
              pending.push(element);
              added = true;
            } else if (element.querySelectorAll) {
              const nested = Array.from(element.querySelectorAll(SELECTORS.row));
              if (nested.length) {
                pending.push(...nested);
                added = true;
              }
            }
          }
        }
        if (added) flush();
      });
      observer.observe(query(SELECTORS.rowsBody), { childList: true, subtree: true });
    }

    async function expandAll(manual) {
      if (expanding) return;
      expanding = true;
      try {
        if (panel) {
          panel.setStatus(
            manual ? "Loading every paper…" : "Loading the full publication list…",
          );
        }
        const result = await loadAllPapers((progress) => {
          if (panel) {
            panel.setStatus(`Loading papers… ${progress.loaded} rows (page ${progress.pages})`);
          }
        });
        absorbRows(readRowElements());
        if (panel) {
          panel.setStatus(
            result.complete
              ? `${result.loaded} papers loaded.`
              : `${result.loaded} papers loaded; Scholar stopped returning more.`,
          );
          window.setTimeout(() => panel && panel.setStatus(""), 4000);
        }
      } finally {
        expanding = false;
      }
    }

    if (state.autoExpand) void expandAll(false);

    // Follow the OS preference while the theme is on "auto".
    if (typeof matchMedia === "function") {
      const media = matchMedia("(prefers-color-scheme: dark)");
      const onSchemeChange = () => {
        if (state.theme === "auto" && panel) panel.syncTheme(state.theme);
      };
      if (media.addEventListener) media.addEventListener("change", onSchemeChange);
      else if (media.addListener) media.addListener(onSchemeChange);
    }

    onStorageChanged((changes) => {
      const change = changes[STORAGE_KEYS.settings];
      if (!change || !change.newValue) return;
      const fresh = normalizeSettings(change.newValue);
      let touched = false;
      for (const key of Object.keys(fresh)) {
        if (JSON.stringify(fresh[key]) !== JSON.stringify(state[key])) {
          state[key] = fresh[key];
          touched = true;
        }
      }
      if (!touched) return;
      if (panel) {
        panel.syncControls(state);
        panel.syncTheme(state.theme);
      }
      applyAll();
    });
  }

  let started = false;

  /** Bootstrap guard: only Scholar citations pages (and the test harness). */
  function shouldStart() {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return false;
    }
    const api = extensionApi();
    if (!api || !api.runtime || !api.runtime.id) return false; // extension context only
    if (query(SELECTORS.profileName) || query(SELECTORS.rowsBody)) return true;
    return (
      typeof location !== "undefined" &&
      /(^|\.)scholar\.google\.[a-z.]+$/i.test(location.hostname) &&
      /^\/citations/.test(location.pathname)
    );
  }

  function start() {
    if (started) return Promise.resolve();
    started = true;
    return documentReady()
      .then(() => waitForSelector(SELECTORS.profileName, LIMITS.profileWaitMs))
      .then((nameElement) => {
        if (!nameElement) return undefined;
        return run();
      })
      .catch((error) => {
        console.warn("[Scholar Highlights] disabled on this page:", error);
        return undefined;
      });
  }

  // =========================================================================
  // 15. Public surface
  // =========================================================================

  const publicApi = {
    VERSION,
    ROLE_KEYS,
    ROLE_LABELS,
    ROLE_NOTES,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    SELECTORS,
    LIMITS,
    KNOWN_PROFILES,
    // pure helpers (also exercised by tests/run.js)
    fold,
    foldForSearch,
    stripDiacritics,
    normalizeTitle,
    splitNameList,
    splitByline,
    scanFragment,
    hasCorrespondingMarker,
    nameParts,
    buildIdentities,
    scoreIdentity,
    findOwnerInByline,
    emptyRoles,
    activeRoleKeys,
    parseRoleList,
    classifyPosition,
    classifyPaper,
    parseOverrideValue,
    normalizeOverrideMap,
    parseOverrideLines,
    formatOverrideLines,
    parseAliasLines,
    resolveOverride,
    computeIndices,
    summarizePapers,
    buildYearSeries,
    isYearInRange,
    matchesRoleFilter,
    evaluateRow,
    positionalAccent,
    normalizeSettings,
    // browser layer
    build,
    query,
    queryAll,
    loadSettings,
    saveSettings,
    loadOverrides,
    saveOverrides,
    loadAliases,
    saveAliases,
    onStorageChanged,
    readProfile,
    detectKnownProfile,
    readProfileTotals,
    classifyRow,
    rowData,
    applyState,
    applyNameMarking,
    markOwnerName,
    clearNameMarks,
    loadAllPapers,
    resolveTheme,
    applyDocumentTheme,
    mountPanel,
    start,
    shouldStart,
  };

  return publicApi;
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ScholarHighlights;
}

if (typeof globalThis !== "undefined") {
  globalThis.ScholarHighlights = ScholarHighlights;
}

if (ScholarHighlights.shouldStart()) {
  void ScholarHighlights.start();
}
