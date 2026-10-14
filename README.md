# Scholar Highlights

> 给 Google Scholar 作者主页按**你自己的作者身份**着色，并按筛选结果重新计算指标。
> 共同第一作者（共同一作）是一等公民，与“第二作者”完全分开。

Google Scholar 的作者主页把所有论文平铺成一长串，看不出“这篇我是一作、那篇我是共同一作、那篇我是通讯作者”。
Scholar Highlights 在你自己的主页（以及任何学者的主页）上做四件事：

1. **按作者角色给论文行着色** —— 一作、**共同一作**、通讯作者、第二作者、末位作者、中间作者各有一套颜色；
2. **加筛选器** —— 角色复选、年份区间、专注模式（只看被高亮的论文）；
3. **高亮你自己的名字** —— 在作者列表里把你标出来；
4. **重算指标** —— 只统计被高亮的那部分论文的论文数、引用数、h-index、i10-index，并画一张逐年论文数柱状图。

同时它会自动点完 “Show more”，把全部论文都加载出来，指标才覆盖整份论文列表。

---

## 目录

- [安装](#安装)
- [界面与用法](#界面与用法)
- [角色与配色](#角色与配色)
- [共同第一作者识别规则](#共同第一作者识别规则)
- [手动覆盖（overrides）](#手动覆盖overrides)
- [别名与内置预设](#别名与内置预设)
- [指标口径](#指标口径)
- [隐私](#隐私)
- [技术选择说明](#技术选择说明)
- [目录结构](#目录结构)
- [开发与校验](#开发与校验)
- [已知限制](#已知限制)
- [License](#license)
- [English summary](#english-summary)

---

## 安装

扩展没有任何构建步骤：仓库里的文件就是最终产物。

### Chrome / Edge（加载已解压的扩展程序）

1. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`）；
2. 右上角打开 **开发者模式**；
3. 点 **加载已解压的扩展程序**，选择本目录（包含 `manifest.chrome.json` 的那一层）；
4. 打开 `https://scholar.google.com/citations?user=ZxrkoP4AAAAJ`，侧栏应该出现 **Highlights** 小节。

> Chrome 只会读 `manifest.json`。本目录里的 `manifest.json` 是 Firefox 版（多了 `browser_specific_settings`），
> Chrome 会忽略这个不认识的键并给出无害提示。
> 想彻底避免提示，可以把 `manifest.chrome.json` 复制成 `manifest.json` 再加载（两者除该键外逐字节一致，
> `node scripts/check-manifest-parity.mjs` 会校验这一点）。

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`；
2. **临时附加组件** → **载入临时附加组件** → 选择本目录里的 `manifest.json`；
3. 打开学者主页即可。

正式签名（`about:addons` 永久安装）需要把目录打包上传 AMO；`browser_specific_settings.gecko.id`
已固定为 `scholar-highlights@ningfeng.dev`，请勿更改。

---

## 界面与用法

侧栏出现的小节就是插件注入的，位置和排版都跟随 Google Scholar 自己的样式（同一套字体、同一条 `#e5e5e5` 细线、同样的数字对齐方式）：

```
Highlights                              OPTIONS      ← 点它展开控制区
─────────────────────────────────────────────────
                Highlighted   All loaded
Papers                  4          20
Citations              40         196
h-index                 4           9
i10-index               0           8
Scholar's own totals: 128 citations · h-index 7 · i10-index 5

   [逐年论文数柱状图：灰 = 全部，蓝 = 被高亮]
```

- 控制区默认**折叠**在 **OPTIONS** 后面，所以默认视图和原生主页一模一样；展开后有：图例、角色复选、年份区间、专注模式、姓名高亮、自动加载开关、`Load all papers` 和 `Settings…`。
- 每行论文的背景色 = 位置角色（一作 / 共同一作 / 第二 / 末位 / 中间），
  左边一条 4px 色带；如果是通讯作者，右边再加一条绿色色带。
  鼠标停在行上会显示 `Scholar Highlights: Co-first + Corresponding` 这样的提示，方便不依赖颜色判断。
- 年份区间只在你选了起点或终点后才生效；一旦设了区间，没有年份的论文会被隐藏、也不计入指标。
- 专注模式只保留被高亮的行（不影响 “Show more” 按钮，它不在表格里）。

---

## 角色与配色

| 角色 | 键 | 浅色 | 深色 | 判定 |
| --- | --- | --- | --- | --- |
| 一作 First | `first` | 琥珀 `#f2b705` | `#fdd663` | 排第一位，且没有与人共享的同等贡献标记 |
| **共同一作 Co-first** | `cofirst` | 紫 `#7c4dff` | `#b388ff` | **与其他作者共享同等贡献标记**（见下节） |
| 通讯作者 Corresponding | `corresponding` | 绿 `#137333` | `#81c995` | 名字带 `✉`，或（未截断时）是最后一位作者且全篇没有 `✉` |
| 第二作者 Second | `second` | 橙 `#e8710a` | `#ffb26b` | 排第二位且不是共同一作 |
| 末位作者 Last | `last` | 蓝 `#1a73e8` | `#8ab4f8` | 未截断的作者列表里的最后一位 |
| 中间作者 Middle | `middle` | 灰 `#9aa0a6` | `#9aa0a6` | 既不是第一、第二，也不是最后一位 |

- 一个角色一个颜色、一个滤镜开关、一条图例条目 —— 共同一作**不是**第二作者的一种。
- `cofirst` 为真时 `first` 和 `second` 一定是假：共同一作就是共同一作。
- 一篇论文可以同时命中多个角色（例如“共同一作 + 通讯作者”“末位 + 通讯作者”），
  背景色按 `cofirst > first > second > last > middle` 取位置角色，通讯作者始终体现在右侧色带上。
- 深色配色在你把主题设为 `dark`、或者插件检测到页面本身是深色时启用（见下）。

---

## 共同第一作者识别规则

核心痛点：**Google Scholar 经常把作者列表里的 `*`、`†`、`✉` 等上标抹掉**。
因此识别分三层，逐层兜底：

| # | 规则 | 结果 |
| --- | --- | --- |
| 1 | 你（按显示名 / 别名 / “Also published as” 匹配到的那个作者）身上有同等贡献标记，且**另一位作者带同一个标记** | `cofirst` |
| 2 | 你排在**第一位**，但另一位作者带相同标记 | `cofirst`（**不是** `first`） |
| 3 | 你排在**第二位**，且与第一位共享同一标记 | `cofirst`（**不是** `second`） |
| 4 | 你与另一位作者共享 `✉`，且对方在作者列表的前两位 | `cofirst` + `corresponding` |
| 5 | 你带 `✉`（不论位置） | `corresponding` |
| 6 | 你是最后一位作者，且整条作者列表里没有任何 `✉` | `corresponding` |
| 7 | 你排在最后一位，但别人带了 `✉` | 只有 `last`，不算通讯 |
| 8 | 作者列表被 “et al.” / “…” 截断 | 永远不会判为 `last`（也就不用规则 6） |
| 9 | 其他情况 | 按位置给 `first` / `second` / `last` / `middle` |

认可的标记：

| 类别 | 字符 |
| --- | --- |
| 符号 | `*` `†` `‡` `§` `¶` `#` `✉` |
| Unicode 上标 | `¹²³⁴⁵⁶⁷⁸⁹⁰`、`ᵃᵇᶜᵈᵉᶠ` |
| 数字脚注 | 末尾的 ASCII 数字（`Que1`、`Que1,2`） |
| 字母脚注 | 紧贴数字或符号的字母（`Que1a`、`Que*a`） |

**刻意不支持**“空格 + 单个字母”形式（`Que a`）：一半的姓氏都以 a–f 结尾，
把 `Ningfeng Que` 读成带 `e` 标记会凭空造出一堆假的共同一作。
这一类情况请用上标字符或手动覆盖表达。

作者名匹配同时处理：

- 全名（`Ningfeng Que`）、缩写（`N. Que`、`N Que`、`N. F. Que`）、中间名首字母；
- 倒装（`Que, Ningfeng`、`Que, N.`、`Que Ningfeng`）—— 按“片段合并”匹配，不会被逗号切坏位置；
- 变音符号（`Zoë Müller` ↔ `Z. Muller`）、大小写、多余标点；
- 别名列表与主页上的 “Also published as” 一行（读到就用，读不到也能靠别名列表工作）；
- 中文名（`阙宁峰`）、全角逗号分隔的作者列表。

---

## 手动覆盖（overrides）

标记被 Scholar 抹掉、或者你想直接指定时，用选项页里的**手动覆盖**。格式是一行一条：

```
论文标题 => 角色
```

- 角色可写 `first`、`cofirst`、`corresponding`、`second`、`last`、`middle`；
- 也可以组合：`cofirst, corresponding`；
- 写 `none` 表示“这篇不要高亮”；
- 同义词可用：`1st`、`equal first`、`co first`、`corr`、`senior`、`2nd`；
- 标题匹配忽略大小写、标点、连字符与变音符号（`VTCNet: A Feature…` 和 `vtcnet — a feature…` 视为同一篇）；
- `#` 或 `//` 开头的行是注释；
- **手动覆盖优先级最高，会完全替代自动识别结果**；写错角色名（例如 `cofrist`）会被选项页标红并忽略，不会把论文“清空”。

示例：

```
adaptive spatial transcriptomics interpolation via cross modal cross slice modeling => cofirst
StateXDiff: Cell State-Contextualized Multimodal Diffusion for Single-Cell Perturbation Prediction => cofirst, corresponding
# 这篇其实是末位通讯
some paper title => last, corresponding
```

---

## 别名与内置预设

- **别名列表**（选项页第一栏，一行一个）：用于识别不同拼写的你，例如 `N. Que`、`Que, Ningfeng`、`阙宁峰`。
  注意**不要用逗号分隔**一条别名 —— 倒装写法本身就带逗号。
- 插件会尽力读取主页 `#gsc_prf_i` 里的 “Also published as” 行（若不存在就跳过，绝不依赖它）；
  这条路径在 `src/content.js` 的 `readProfile()` 中。
- **内置预设**：针对本仓库作者的主页 `ZxrkoP4AAAAJ`（也支持用显示名 `Ningfeng Que` / `阙宁峰` 识别），
  插件附带三条不显示在 Scholar 页面上的共同一作记录（*Adaptive Spatial Transcriptomics Interpolation*、
  *Advances in Hydrogel-Based Electronic Skins*、*VTCNet*）。它们**只在你的覆盖列表里没有同名条目时生效**，
  选项页里有开关，也可以被同名的覆盖条目直接顶掉。其他学者主页不会应用这个预设。

---

## 指标口径

- **Papers / Citations / h-index / i10-index** 各两列：`Highlighted`（当前筛选命中的论文）与 `All loaded`（已加载的全部论文，仍受年份区间约束）。
- 表格下方一行 `Scholar's own totals` 直接读取主页侧栏 `#gsc_rsb_st` 的 **All** 列，便于和官方数字对照。
- **h-index**：把引用数从大到小排序，最大的 k 满足第 k 篇的引用数 ≥ k。
- **i10-index**：引用数 ≥ 10 的论文数。
- **逐年柱状图**：纯内联 SVG（没有第三方库），从最早一年画到最晚一年，中间没有论文的年份也会留出空位；
  灰色柱子 = 全部论文，蓝色覆盖部分 = 被高亮的论文，柱子上悬停显示 “2025: 3 of 7 highlighted”。
- 年份区间一旦设置，`All loaded` 也只统计区间内的论文；没有年份的论文在设置区间后被排除。

---

## 自动加载全部论文

打开主页后插件会连续点击 `#gsc_bpf_more`（“Show more”），直到：

- 按钮消失、被禁用或不可见；或
- 点击后行数不再增加；或
- 达到硬上限（60 页 ≈ 1200 篇）或总预算（90 秒）。

加载过程中侧栏会显示进度；结束后提示已加载多少篇。选项页可以关掉自动加载，侧栏里也有 `Load all papers` 手动按钮。
新加载出来的行会经过和首屏完全相同的分类流程（批量处理，避免大主页上的平方级开销）。

---

## 隐私

- **权限只有 `storage`**，没有 `host_permissions`，没有后台脚本，没有 `web_accessible_resources`；
- 代码里没有 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`，**任何数据都不离开浏览器**；
- 唯一的浏览器 API 是 `storage.sync`（保存设置/别名/覆盖）和用户点击 `Settings…` 时的 `runtime.openOptionsPage()`；
- 选项页在本地解析你的输入，选项页上的统计/图表全部在页面内计算，不发请求；
- `tests/cases/policy.test.js` 会用正则机械地检查上述几条约定，防止以后被破坏。

---

## 技术选择说明

**最终形态：一个自包含的经典（非 module）content script `src/content.js`，没有构建步骤。**

为什么不用 `import()` 动态加载 ES module（题目里提到的首选方案）：

- MV3 的 content script **不支持静态 `import`**；
- 在 content script 里对 `chrome-extension://` 资源做动态 `import()` 需要一个
  `web_accessible_resources` 白名单，这会把插件文件暴露给页面脚本（指纹识别面），
  而且 Firefox 与 Chromium 对 content script 内 `import()` 的解析基准/时序并不一致
  （不同版本行为不同，无法在本机 Firefox 上验证 —— 本机没有装 Firefox）；
- 单文件经典脚本在两个引擎里的语义完全一致、不需要任何打包、审计时“你看到的就是运行的”。

因此三条约束（无构建步骤 / Chrome MV3 与 Firefox MV3 都能直接加载 / 可被 Node 测试直接引用）用同一个文件满足：

- 浏览器里：`manifest.json` 通过 `content_scripts.js` 直接加载它；
- 测试里：`tests/run.js` 用 `require("../../src/content.js")` 引用**同一份生产代码**（文件末尾导出 `module.exports`，浏览器里 `module` 不存在，这段不会执行）；
- 选项页里：`options.html` 先加载 `src/content.js`，再由 `src/options.js` 使用 `globalThis.ScholarHighlights`，所以
  解析器、角色规则、设置归一化逻辑三处共用一份实现，不会漂移。

启动条件是显式的：只有在扩展上下文里（`runtime.id` 存在）、且页面有 `#gsc_prf_in` / `#gsc_a_b`
或地址是 `scholar.google.*/citations` 时才运行，所以选项页不会被误当成学者主页。
仓库里仍然有 ES module（`scripts/*.mjs`），它们在 Node 里运行，不存在 CSP 问题。

样式走 `content_scripts.css`（浏览器原生注入），不写 `<style>`，也就没有 CSP 与 `web_accessible_resources` 的问题。

---

## 目录结构

```
scholar-highlights/
├── manifest.json                 # Firefox MV3（含 browser_specific_settings）
├── manifest.chrome.json          # Chrome / Edge MV3（除该键外与上面逐字节一致）
├── options.html                  # 选项页
├── package.json                  # 只有脚本，没有依赖
├── README.md  VERIFICATION.md  LICENSE  .gitignore
├── src/
│   ├── content.js                # 唯一的 content script：纯逻辑 + DOM + 面板（同时被测试引用）
│   └── options.js                # 选项页逻辑（复用 content.js 导出的实现）
├── styles/
│   ├── content.css               # 主页注入样式：行高亮 + 侧栏面板（跟随 Scholar 排版，明暗两套）
│   └── options.css               # 选项页样式（与上面共用同一套角色色板）
├── assets/
│   ├── icon.svg                  # 图标源文件
│   └── icons/icon-{16,32,48,96,128}.png
├── scripts/
│   ├── check-manifest-parity.mjs # 两个 manifest 的一致性 + 引用文件存在性
│   ├── check-syntax.mjs          # 对每个 JS 文件跑 node --check
│   └── make-icons.py             # 用 Pillow 重新生成图标（含 icon.svg）
├── tests/
│   ├── run.js  harness.js        # 零依赖测试运行器
│   ├── cases/*.test.js           # 6 组用例
│   └── fixtures/                 # 用例数据 + sample-profile.html（真实 DOM 结构）
└── tools/
    ├── verify-chrome.mjs         # 用无头 Chrome 真机跑一遍 content script（见下）
    └── README-verify.md          # 该脚本的说明与环境注意事项
```

本次交付实际跑过的校验、完整输出，以及**没有跑成**的部分和原因，都记在
[VERIFICATION.md](VERIFICATION.md) 里。

---

## 开发与校验

本机 Node 不在 PATH 里时用绝对路径调用，例如：
`C:\Users\LEGION\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`。

### 测试

```sh
node tests/run.js
```

覆盖范围（全部跑**生产代码**，不在测试里重写逻辑）：

- `tests/cases/name-matching.test.js` —— 全名、缩写、倒装、变音符号、中文别名、近名误匹配、内置预设识别；
- `tests/cases/roles.test.js` —— 单独一作、共享 `*` / `†` / 上标 / 数字脚注的共同一作、第二作者、
  `✉` 通讯、末位兜底通讯、中间作者、截断列表、假阳性回归；
- `tests/cases/overrides.test.js` —— 手动覆盖优先级、`none`、组合角色、同义词、错别字回退、文本格式往返；
- `tests/cases/metrics.test.js` —— h-index / i10-index / 论文数 / 逐年计数，全部对照手算结果；
- `tests/cases/filters.test.js` —— 年份区间（含无年份论文）、角色开关、专注模式、指标与区间的联动；
- `tests/cases/fixture.test.js` —— 直接从 `tests/fixtures/sample-profile.html` 文本里抽出 20 行论文的
  作者、引用数与年份，跑分类器并比对手算期望（含 `expected-profile.json`）；
- `tests/cases/policy.test.js` —— 无 `innerHTML` / `eval` / 网络 API、权限面、色板一致性、文件树完整性。

### 清单一致性

```sh
node scripts/check-manifest-parity.mjs
```

逐键比较两个 manifest（只允许 `browser_specific_settings` 不同）、校验 `permissions` 恰好是 `["storage"]`、
没有 `background` / `host_permissions`、匹配模式正确、描述长度 ≤ 132，并确认 manifest 引用的每个文件真实存在。

### 语法检查

```sh
node scripts/check-syntax.mjs
```

对 `src/`、`tests/`、`scripts/`、`tools/` 下每个 `.js` / `.mjs` 跑 `node --check`（等价于逐个手工执行）。

### 图标

```sh
python scripts/make-icons.py
```

用 Pillow 在 8 倍超采样下绘制（蓝色圆角底 + 白色放大镜 + 镜片内的深蓝五角星），
输出 `assets/icons/icon-{16,32,48,96,128}.png` 以及与几何完全一致的 `assets/icon.svg`。

### 真机（Chrome）端到端校验

```sh
node tools/verify-chrome.mjs
```

它会：起一个本地静态服务器、把扩展文件复制成一份匹配 `http://127.0.0.1/*` 的临时扩展、
用 `--headless=new --load-extension` 启动 Chrome 打开 `tests/fixtures/sample-profile.html`，
然后通过 DevTools 协议断言真实渲染结果（面板存在、20 行全部加载、各角色行的 class、
姓名标记、指标数字、四种配色互不相同、筛选/专注模式/年份区间点击后的行为）。成功后退出码为 0。
详见 `tools/README-verify.md`。

> ⚠️ **本项目的构建环境无法运行这个脚本**：该环境禁止进程创建命名管道，Chromium 因此无法启动
> （`[FATAL:mojo\public\cpp\platform\platform_channel.cc:187] Check failed: 拒绝访问 (0x5)`，
> crashpad 也报 `OpenProcess: 拒绝访问`）。这是环境限制，不是扩展问题。
> 请在你自己的桌面环境里跑一次；在无法启动浏览器的环境里，请把 Node 测试套件
> （尤其是 `tests/cases/fixture.test.js` —— 它分类的正是同一个 fixture 主页）当作替代验证。

---

## 已知限制

- **没有在真实浏览器里跑过**（构建环境不允许启动 Chromium，原因见上；Firefox 也没有安装）：
  - 已验证：全部纯逻辑（作者匹配、角色判定、覆盖优先级、指标、筛选）、fixture 主页 20 行论文的
    分类结果与手算指标、两个 manifest 的一致性、每个 JS 文件的语法、CSS 括号/分号合法性、
    以及“扩展依赖的每个选择器都存在于 fixture DOM 中”；
  - 未验证：真实页面上的面板渲染、`storage.sync` 往返、`Show more` 自动点击、姓名标记的 DOM 操作。
    这四件事都在 `tools/verify-chrome.mjs` 里有断言，装好浏览器后一条命令即可验证。
- Google Scholar 抹掉标记后无法从页面推断真实身份，必须靠[手动覆盖](#手动覆盖overrides)或内置预设补上。
- 主页上的 “Also published as” 交互区只有在页面已经渲染出该文本时才会被读取；插件不会去点它，也不会发请求。
- 不处理同一篇论文在 Scholar 上重复出现的情况（按行独立处理）。
- 行内提示（`title`）是本次为可访问性做的取舍：不往 Scholar 的表格里塞额外的标记节点。
- 作者名匹配以拉丁字母与中日韩字符为基础；其他文字（如纯西里尔/阿拉伯文姓名）按同样规则处理但未做专门测试。

---

## License

MIT © Ningfeng Que，见 [LICENSE](LICENSE)。

---

## English summary

**Scholar Highlights** is a dependency-free browser extension (MV3 for Chrome, Edge and Firefox) that enhances
Google Scholar author profile pages.

- **Role colouring** of every publication row by the *profile owner's* authorship role:
  `first`, **`cofirst`**, `corresponding`, `second`, `last`, `middle`.
  Co-first authorship (共同第一作者) is a first-class role with its own colour, its own filter and its own legend
  entry — it is never reported as "second author". It is detected whenever the owner shares an
  equal-contribution marker (`*`, `†`, `‡`, `§`, `¶`, `#`, superscripts, or an affiliation digit/letter) with
  another author, or shares the `✉` marker with one of the two leading authors.
- **Corresponding author detection**: the owner carries `✉`, or is the last author of an untruncated byline that
  contains no `✉` at all.
- **Filters**: independent role checkboxes, an inclusive year range, and a focus mode that hides everything that
  is not highlighted. All controls live behind an `OPTIONS` toggle in the section header, so the default view of
  a Scholar profile is unchanged.
- **Name marking** of the owner inside each byline.
- **Metrics for the highlighted subset** (papers, citations, h-index, i10-index) next to the profile's own totals,
  plus a papers-per-year bar chart drawn as plain inline SVG.
- **Full-list loading**: it clicks `#gsc_bpf_more` until the list is exhausted (hard caps: 60 pages, 90 seconds),
  so the metrics cover every paper.
- **Options page** for an alias list, a `normalized title => role` manual override map (overrides always win,
  which is the escape hatch for markers that Scholar strips), default roles, auto-expansion, name marking,
  the built-in preset for `ZxrkoP4AAAAJ`, and a light/dark/auto theme.
- **Privacy**: permission surface is exactly `["storage"]`, no host permissions, no background script, no network
  calls; settings live in `storage.sync` through a small promise wrapper that works on both
  `globalThis.browser` and `globalThis.chrome`.
- **No build step**: the runtime is one plain classic content script (`src/content.js`) that is also `require`d
  directly by the Node test suite, plus an options page that reuses the same implementation. The chosen module
  strategy and the reasons against dynamic `import()` in content scripts are explained above.

Run `node tests/run.js` for the suite, `node scripts/check-manifest-parity.mjs` for manifest parity,
`node scripts/check-syntax.mjs` for a `node --check` pass over every file, and `node tools/verify-chrome.mjs`
for a headless-Chrome end-to-end run against the offline profile fixture (see the caveat above: it needs a
normal desktop environment, because a sandbox that forbids named pipes cannot start Chromium at all).
