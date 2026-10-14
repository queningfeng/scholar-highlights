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
policy: 13 passed

117 passed, 0 failed (117 tests)
```

测试直接 `require` 生产文件 `src/content.js`（同一份代码同时是浏览器 content script），
没有在测试里重写任何业务逻辑。

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
syntax: PASS (14/14 files parsed)
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

## 6. 未能执行：真实浏览器端到端

```
node tools/verify-chrome.mjs      # ← 本环境无法运行
```

该脚本会在无头 Chrome 里加载临时构建的扩展、打开 fixture 主页，并通过 DevTools 协议断言
面板注入、20 行加载、每行角色 class、四种配色互不相同、姓名标记、指标数字，以及
角色筛选 / 专注模式 / 年份区间被点击后的行为。

**本项目的构建环境无法启动 Chromium**：该沙箱禁止进程打开命名管道，Chromium 的多进程架构因此失败：

```
[ERROR:third_party\crashpad\...\crashpad_client_win.cc:430] OpenProcess: 拒绝访问。 (0x5)
[FATAL:mojo\public\cpp\platform\platform_channel.cc:187] Check failed: ... 拒绝访问。 (0x5)
crash server failed to launch, self-terminating
```

已尝试 Chrome 155 与 Edge、`--disable-breakpad`、`--no-sandbox`、`--headless=old`、`--single-process`、
不同的 `--user-data-dir`，全部以同一错误退出（退出码 -36863 / -1）。这是环境限制，不是扩展问题。

因此以下行为**尚未在真实页面上验证**，需要在普通桌面环境里跑一次上面的脚本（或在浏览器里手工加载）：

1. 面板真的被插入侧栏、折叠在 OPTIONS 后面；
2. `storage.sync` 的读写往返（`callStorage` 同时兼容 Promise 与回调两种返回风格）；
3. 自动点击 `#gsc_bpf_more` 直到列表加载完；
4. 姓名标记的 DOM 操作（`splitText` + `.shx-me`）；
5. Firefox 上的加载路径（本机也没有安装 Firefox）。

这些路径的**逻辑**已由第 1–5 节覆盖到（尤其是 `fixture.test.js` 用的是同一个 fixture 主页），
剩下的风险集中在 DOM API 的使用细节上。
