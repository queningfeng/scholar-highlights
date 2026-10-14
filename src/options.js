/*!
 * Scholar Highlights - options page logic.
 *
 * Plain classic script on purpose: it consumes the very same implementation as
 * the content script (options.html loads src/content.js first, which publishes
 * `globalThis.ScholarHighlights`), so the role parser, the override parser and
 * the settings normaliser can never drift from the runtime.
 *
 * License: MIT (c) Ningfeng Que
 */

"use strict";

(function () {
  const SH = globalThis.ScholarHighlights;
  if (!SH) {
    console.error("[Scholar Highlights] options: shared core missing");
    return;
  }

  const el = (id) => document.getElementById(id);
  const form = {
    aliases: el("aliases"),
    overrides: el("overrides"),
    overrideReport: el("override-report"),
    roleList: el("role-list"),
    autoExpand: el("auto-expand"),
    markName: el("mark-name"),
    focusMode: el("focus-mode"),
    usePreset: el("use-preset"),
    theme: el("theme"),
    presetDetails: el("preset-details"),
    presetList: el("preset-list"),
    reset: el("reset"),
    status: el("status"),
    version: el("version"),
  };

  let settings = SH.normalizeSettings(null);
  let saveTimer = null;

  function setStatus(message, kind) {
    form.status.textContent = message || "";
    form.status.dataset.state = kind || "";
  }

  function buildRoleList() {
    form.roleList.textContent = "";
    for (const key of SH.ROLE_KEYS) {
      const input = SH.build("input", {
        type: "checkbox",
        id: `role-${key}`,
        dataset: { role: key },
        on: { change: () => scheduleSave() },
      });
      input.checked = Boolean(settings.enabledRoles[key]);
      form.roleList.append(
        SH.build("label", { class: "opt-role", for: `role-${key}` }, [
          input,
          SH.build("span", {
            class: `opt-swatch opt-swatch-${key}`,
            "aria-hidden": "true",
          }),
          SH.build("span", { class: "opt-role-text" }, [
            SH.build("strong", { text: SH.ROLE_LABELS[key] }),
            SH.build("span", { class: "opt-role-note", text: SH.ROLE_NOTES[key] }),
          ]),
        ]),
      );
    }
  }

  function buildPresetList() {
    const presets = [];
    for (const profile of Object.values(SH.KNOWN_PROFILES)) {
      for (const [title, role] of Object.entries(profile.presetOverrides || {})) {
        presets.push(`${title} => ${role}  (${profile.label})`);
      }
    }
    form.presetDetails.hidden = presets.length === 0;
    form.presetList.textContent = "";
    for (const entry of presets) {
      form.presetList.append(SH.build("li", { text: entry }));
    }
  }

  function readRolesFromForm() {
    const roles = {};
    for (const key of SH.ROLE_KEYS) {
      roles[key] = Boolean(form.roleList.querySelector(`#role-${key}`)?.checked);
    }
    return roles;
  }

  function reportOverrideErrors(errors) {
    if (!errors.length) {
      form.overrideReport.dataset.state = "ok";
      form.overrideReport.textContent = "";
      return;
    }
    form.overrideReport.dataset.state = "error";
    form.overrideReport.textContent = errors
      .map((error) => `第 ${error.line} 行被忽略：${error.reason} — ${error.text}`)
      .join("\n");
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void save();
    }, 250);
  }

  async function save() {
    const aliases = SH.parseAliasLines(form.aliases.value);
    const { overrides, errors } = SH.parseOverrideLines(form.overrides.value);
    reportOverrideErrors(errors);

    settings = SH.normalizeSettings({
      enabledRoles: readRolesFromForm(),
      autoExpand: form.autoExpand.checked,
      highlightName: form.markName.checked,
      focusMode: form.focusMode.checked,
      theme: form.theme.value,
      useProfilePreset: form.usePreset.checked,
    });

    await Promise.all([
      SH.saveSettings(settings),
      SH.saveOverrides(overrides),
      SH.saveAliases(aliases),
    ]);
    setStatus(
      errors.length
        ? `已保存（${errors.length} 行无效，已忽略），共 ${Object.keys(overrides).length} 条覆盖、${aliases.length} 个别名`
        : `已保存 · ${Object.keys(overrides).length} 条覆盖 · ${aliases.length} 个别名`,
      errors.length ? "error" : "ok",
    );
  }

  function render() {
    form.aliases.value = (settings.aliases || []).join("\n");
    form.autoExpand.checked = Boolean(settings.autoExpand);
    form.markName.checked = Boolean(settings.highlightName);
    form.focusMode.checked = Boolean(settings.focusMode);
    form.usePreset.checked = Boolean(settings.useProfilePreset);
    form.theme.value = settings.theme;
    buildRoleList();
  }

  async function load() {
    const [storedSettings, overrides, aliases] = await Promise.all([
      SH.loadSettings(),
      SH.loadOverrides(),
      SH.loadAliases(),
    ]);
    settings = { ...storedSettings, aliases };
    render();
    form.overrides.value = SH.formatOverrideLines(overrides);
    form.version.textContent = `v${SH.VERSION}`;
  }

  for (const input of [
    form.aliases,
    form.overrides,
    form.autoExpand,
    form.markName,
    form.focusMode,
    form.usePreset,
    form.theme,
  ]) {
    input.addEventListener("input", scheduleSave);
    input.addEventListener("change", scheduleSave);
  }

  form.reset.addEventListener("click", async () => {
    if (!window.confirm("恢复默认设置并清空别名与手动覆盖？")) return;
    settings = SH.normalizeSettings(null);
    form.aliases.value = "";
    form.overrides.value = "";
    reportOverrideErrors([]);
    render();
    await Promise.all([
      SH.saveSettings(settings),
      SH.saveOverrides({}),
      SH.saveAliases([]),
    ]);
    setStatus("已恢复默认设置", "ok");
  });

  buildPresetList();
  void load().then(() => setStatus("", ""));
})();
