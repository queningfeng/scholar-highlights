# 验证记录 / Verification record

本文件记录本次交付**实际执行过**的校验、命令输出，以及**未能执行**的部分和原因。
所有命令都用绝对路径的 Node 调用（本机 Node 不在 PATH 上）：

```
C:\Users\LEGION\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
```

## 1. 单元 / 集成测试

```
node tests/run.js
```

```
author matching: 26 passed
role classification: 27 passed
manual overrides: 16 passed
metrics: 17 passed
filters: 8 passed
sample profile fixture: 10 passed
shipped preset for ZxrkoP4AAAAJ: 12 passed
policy: 13 passed

128 passed, 0 failed (128 tests)
```

测试直接 `require` 生产文件 `src/content.js`（同一份代码同时是浏览器 content script），
没有在测试里重写任何业务逻辑。

`tests/run.js` 通过 `readdirSync` **自动发现** `tests/cases/*.test.js`。此前它是一份手写清单，
导致新加的 `preset.test.js` 被静默跳过——这类"测试没跑却显示全绿"的坑已经堵上。

## 2. 清单一致性

```
node scripts/check-manifest-parity.mjs
```

```
manifest parity: PASS (21/21 checks passed)
```

（两个 manifest 逐键比较，只允许 `browser_specific_settings` 不同；`permissions` 恰好 `["storage"]`；
无 `background`、无 `host_permissions`、无 `web_accessible_resources`；匹配模式为
`https://scholar.google.com/citations*`；描述 ≤ 132 字符；两个 manifest 引用的每个文件都存在。）

## 3. 语法

```
node scripts/check-syntax.mjs
```

```
syntax: PASS (15/15 files parsed)
```

（对 `src/`、`tests/`、`scripts/`、`tools/` 下每个 `.js` / `.mjs` 执行 `node --check`。）

## 4. CSS

`tests/cases/policy.test.js` 中包含：

- 两个样式表括号配平、每行声明以 `;` 结束、引号成对（浏览器对坏 CSS 是静默忽略的，所以必须机械检查）；
- 角色色板在 `styles/content.css` 与 `styles/options.css` 中完全一致（浅色与深色两套都比对）；
- 每个角色都有色块、行内左侧强调规则、以及 `shx-r-*` 标记类；
- 扩展依赖的**每一个选择器**（`#gsc_prf_in`、`.gsc_prf_il`、`#gsc_a_t`、`#gsc_a_b`、`tr.gsc_a_tr`、
  `a.gsc_a_at`、`div.gs_gray`、`a.gsc_a_ac`、`span.gsc_a_h`、`#gsc_bpf_more`、`#gsc_rsb_st`、`#gsc_rsb_cit`、
  `#gsc_rsb`）都真实存在于 `tests/fixtures/sample-profile.html` 中。

## 5. fixture 主页

`tests/cases/fixture.test.js` 从 `tests/fixtures/sample-profile.html` 文本中抽出全部 20 行论文的
作者、引用数、年份，跑生产分类器，逐行比对手算期望（`tests/fixtures/expected-profile.json`），并核对：

- 12 行首页 + 8 行 “Show more” 分页 = 20 行；
- 至少 3 篇作者共享 `*` 的共同一作论文（实际 4 篇 cofirst，其中 3 篇用 `*`，1 篇用 `†`）；
- 每种角色都出现过，且角色计数与手算一致（cofirst 4 / first 2 / second 6 / corresponding 4 / last 3 / middle 5）；
- 侧栏 `#gsc_rsb_st` 的官方数字（128 / h 7 / i10 5）与逐行重算结果一致；
- 全部 20 行的重算结果（196 引用、h 9、i10 8）与手算一致。

## 6. 真实浏览器端到端（已执行并通过）

```
node tools/verify-chrome.mjs
```

```
  ..   C:\Program Files\Google\Chrome\Application\chrome.exe refuses --load-extension; trying the next one
  ok   a local browser that honours --load-extension was found
  ..   using C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
  ...
verify: PASS (35/35 checks passed)
```

早期版本的这份记录写着"本环境无法启动 Chromium"。那是**沙箱的命名管道限制**，不是环境缺陷：
在允许创建命名管道的进程里，无头 Chromium 运行正常。现已实际跑通 35 项断言，覆盖：

1. 面板真的被插入 `#gsc_rsb` 侧栏、紧跟 Scholar 自己的 `#gsc_rsb_cit`，且默认折叠在 OPTIONS 后面；
2. 自动点击 `#gsc_bpf_more`，20 行全部加载，指标随之重算；
3. 每一行的角色 class 与左侧强调色，含共同一作、二作、通讯、末位、仅通讯无位置角色；
4. 四种配色确实互不相同，且共同一作用的是紫色强调（`rgb(124, 77, 255)`）；
5. 姓名标记的 DOM 操作（`.shx-me`），且等贡献符号留在标记之外；
6. 角色筛选 / 专注模式 / 年份区间点击后的真实行为；
7. `storage.sync` 的读写往返（设置被持久化并回读）；
8. 颜色主题解析并发布到 `<html data-shx-theme>`。

### 6.1 品牌版 Chrome 会拒绝加载未打包扩展

这是踩过的坑，值得写下来：

```
WARNING:extension_service.cc:423] --load-extension is not allowed in Google Chrome, ignoring.
```

**Google Chrome（品牌版）从构建层面忽略 `--load-extension`**，与功能开关无关
（`--disable-features=DisableLoadExtensionCommandLineSwitch` 也无效）。只有 Chromium、
Chrome for Testing 或 Edge 才会真正加载。因此 harness 现在会**逐个探测候选浏览器**，
自动跳过拒绝加载的那个，并在全部不可用时给出明确提示。

### 6.2 fixture 的身份是合成的

`tests/fixtures/sample-profile.html` 里的 profile 叫 **Alex Rivera**，不是作者本人。原因：

- 这个 fixture 的职责是覆盖分类器的**全部分支**，包括作者本人并没有的"通讯作者"和"末位作者"论文，
  所以它只能是合成的，不能同时充当作者的真实履历；
- 早期版本用了作者真名，导致 `KNOWN_PROFILES` 里的内置预设被自动套用到 fixture 上，
  与手写期望互相打架（6 项断言因此失败）。

现在职责分离：fixture 测**纯检测**；作者的**真实身份与预设**由 `tests/cases/preset.test.js` 的 12 项测试覆盖。

### 6.3 仍未验证：Firefox

本机没有安装 Firefox，所以 Firefox 的加载路径仍未在真机验证（manifest 一致性已覆盖静态部分）。

