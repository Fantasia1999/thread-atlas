# ThreadAtlas 架构重构实施规格

> 评审日期：2026-07-06 · 基线：`main @ d698706` · 全部源码约 26k 行（不含测试）
>
> **本文档是给 AI 编码助手的实施规格。** 请严格按阶段顺序执行，每个阶段结束时运行验证命令并确认验收标准，全部通过后再进入下一阶段。行号基于上述基线 commit，若代码已变动请以符号名（函数/类名）定位。

---

## 0. 执行者必读：全局约束

以下规则优先级高于本文档任何具体指令，若冲突以本节为准：

1. **不引入任何前端框架 / 虚拟 DOM / 状态管理库 / CSS 框架**。项目刻意保持无框架（见 `AGENTS.md` Working Rules）。
2. **不修改 API 契约**：
   - `GET /api/local/scan` 只返回 `SessionDescriptor[]`，不得内联文件内容；
   - `GET /api/local/session?key=...` 返回一个含原始文件内容的 `SessionBundle`；
   - Antigravity `.pb` 解码是唯一的后端解码例外，后端可以产出 `#chat.jsonl`，但不得产出归一化 `Session`。
3. **不为 server 引入数据库、长驻缓存或后台任务**。保持请求级、无状态。
4. **不"去重" parser 间的相似代码**。各 parser 的相似逻辑是对不同上游格式的独立容错，合并会引入跨格式耦合。
5. **保持 parser 容错哲学**：解析失败必须降级为 `buildFallbackSession`（`src/parsers/utils.ts`），不得抛出到 UI。
6. 每个阶段是**独立可提交单元**：完成→验证→commit，再开始下一阶段。不要跨阶段混改。
7. 所有被测试直接 import 的符号（见 §0.2）在搬移后必须**在原文件保留 re-export**，或同步更新测试 import 路径（二选一，优先改测试）。
8. 验证命令（每阶段必跑）：

```bash
npm run typecheck   # tsc -p tsconfig.app.json + tsconfig.server.json
npm test            # node --import tsx --test tests/*.test.ts
npm run build       # vite build + server tsc + agent bundle，确认产物完整
```

### 0.1 现状架构速览

```
server/                Express (localhost:3030)，请求级、无状态
  index.ts             全部路由 + 静态托管（424 行）
  scanner.ts           本地扫描 + 各 source 描述符构建（880 行）
  antigravity.ts       .pb 解码 / transcript 转换（2206 行，本次拆分重点）
  antigravityDescriptors.ts  protobuf 描述符快照
  platformRoots.ts     跨平台扫描根目录解析（已经是良好抽象，保留）
  ssh.ts / remote.ts   SSH 同步与远程中继
  agent.ts / agentConfig.ts  独立 agent 可执行入口

src/parsers/           source 检测 + 归一化
  types.ts             SessionDescriptor/SessionBundle/Session 契约（89 行，前后端共用）
  detect.ts            启发式检测 + parse switch 分发（111 行）
  codex/claude/gemini/opencode/antigravity/copilot.ts  各 parser
  utils.ts             buildFallbackSession 等共用工具

src/store/
  sessionStore.ts      状态容器 + fetch + localStorage + 过滤排序（711 行）
  connection.ts        远程连接管理 + 另一批 fetch（362 行）

src/ui/                无框架 DOM UI
  app.ts               ThreadAtlasApp 编排（879 行）
  chatView.ts          会话视图（1616 行，本次拆分重点）
  sidebar.ts           侧栏（943 行）
  sshModal / connectionModal / exportMdModal / filePreviewModal / importModal
  markdown.ts / mermaidRender.ts / utils.ts

src/index.css          全部样式（4342 行，本次拆分重点）
src/main.ts            入口：import index.css + 构造 SessionStore + ThreadAtlasApp
```

### 0.2 测试对源码符号的直接依赖（搬移时的红线）

`tests/*.test.ts` 直接 import 以下模块，搬移其中符号时必须处理：

| 测试 import | 涉及符号（部分） |
|---|---|
| `../src/ui/chatView.ts`（4 个测试文件） | `renderChatView`、`filterMessagesForView`、`isToolOnlyMessage`、`buildCodexResumeCommand`、`buildClaudeResumeCommand`、`buildAntigravityResumeCommand`、`buildCopilotResumeCommand`、`createCopyResumeButton`、`MessageViewFilter` |
| `../src/parsers/detect.ts` | `detectSessionSource`、`parseSessionBundle` |
| `../src/parsers/types.ts`（11 个测试文件） | 类型 |
| `../src/store/sessionStore.ts` | `SessionStore` 等 |
| `../src/ui/sidebar.ts`、`../src/ui/markdown.ts`、`../src/ui/exportMdModal.ts` | 渲染函数 |

---

## 阶段 1：纯搬家拆分（零行为变化）

目标：消灭三个巨型文件。**本阶段禁止任何逻辑修改**——只允许移动代码、调整 import/export、新建目录。diff 中除 import/export 行外，函数体必须逐字节不变。

### 1.1 拆分 `src/index.css`（4342 行 → 按区块多文件）

文件内已有区块注释（`/* ... */` 标题行），按注释边界机械切分：

1. 新建 `src/styles/` 目录，按下表切分（行号为基线行号，以注释标题为准）：

| 新文件 | 内容（源文件区块） |
|---|---|
| `styles/base.css` | 文件头部 reset、`:root` 变量、字体、主题变量（1 行 ~ 243 行） |
| `styles/topbar.css` | "High-Contrast Precise Topbar"(244)、"Minimalist Stark Theme Toggle"(298)、"Technical stark solid buttons"(329)、"Badges & Status Pills"(419) |
| `styles/layout.css` | "Layout Shells & Rails"(473)、"Ultra-slim, precise Rails"(544)、"Responsive Styles"(2442) |
| `styles/sidebar.css` | "Sidebar Styling"(594) ~ "Clean, flat, high-contrast badges"(846) 区间、"Group Headers inside Sidebar"(2867) 起的 sidebar 相关区块、"Filter active source-specific brand colors"(2728) |
| `styles/chat.css` | "Chat Detail Layout"(979) ~ "Flat solid left indicators"(1499) 区间（含 Timeline、Log Cards、Commentary、Memory Citation） |
| `styles/code.css` | "Stark precise Code Blocks"(1745)、"Tool Call Blocks Details tag"(2054)、"Flat solid details indicator"(2090) |
| `styles/modals.css` | "Technical, Flat Modals"(2123)、"File Import Dropzone"(2305)、"Optimized SSH Hub Styling"(2529) ~ "Discovered Results Styling"(2667) 区间 |
| `styles/misc.css` | "Beautiful Custom Micro Pill Scrollbars"(2406)、"CSS Keyframe Animations"(2425)、"Stunning Premium Toast Notifications"(2789)、其余未归类区块 |

2. `src/index.css` 改为只含 `@import "./styles/base.css";` 等 8 行（顺序必须与上表一致，`base.css` 必须最先——后续文件依赖其 CSS 变量）。`src/main.ts:5` 的 `import "./index.css"` 不动，Vite 会解析 `@import`。
3. **切分规则**：不修改任何选择器和声明；区块间如有归属模糊的规则，跟随其上方最近的区块注释走；2863 行附近的分节大注释保留在对应新文件顶部。
4. **验收**：`npm run build` 成功；`dist/` 中产出的 CSS 与重构前的产物做规则数量对比（可用 `grep -c '{' dist/assets/*.css` 前后对比，允许因文件合并顺序产生的微小差异，但规则总数必须一致）；手动 `npm run dev` 打开页面，明暗主题、侧栏、会话视图、modal 外观无变化。

### 1.2 拆分 `server/antigravity.ts`（2206 行 → `server/antigravity/` 目录）

按现有符号分组搬移（符号 → 新文件）：

| 新文件 | 迁入符号（源文件行号） |
|---|---|
| `server/antigravity/paths.ts` | `isAntigravityConversationPath`(101)、`isAntigravityTranscriptPath`(110)、`antigravitySessionIdFromPath`(119)、`resolvePreferredAntigravitySessionPath`(133)、`isScannableAntigravitySessionPath`(175)、`resolveBrainDirFromConversationPath`(1836)、`resolveTranscriptPathFromConversationPath`(1850)、`resolveConversationPathFromTranscriptPath`(1860) |
| `server/antigravity/pbDecoder.ts` | `DirectPbDecoder` 类(593)、`getSharedDirectPbDecoder`(1010)、`tryDecodeAntigravityTrajectory`(987)、`decodeAntigravityTrajectory`(295)、`isTrajectoryDecodeUsable`(1154)、`hasDecodedPayload`(1170) |
| `server/antigravity/descriptors.ts` | `loadBundledDescriptorFiles`(1017)、`loadExtensionDescriptorFiles`(1025)、`discoverExtensionBundle`(1041)、`descriptorMapFromBase64`(1078)、`descriptorMapFromExtensionSource`(1086)、`extractDescriptorFileName`(1104)；并将现有 `server/antigravityDescriptors.ts` 移动为 `server/antigravity/descriptorSnapshot.ts` |
| `server/antigravity/records.ts` | `buildChatRecords`(1423)、`buildChatRecordsFromTranscriptRows`(1588)、`transcriptToolName`(1740)、`toolNameForStep`(1752)、`stepPayload`(1137)、`extractText`(1192)、`extractArtifactUris`(1244)、`inferRole`(1254)、`compactSummaryText`(1276)、`latestStepByType`(1292)、`inferDirectSummaryText`(1306)、`stepTimes`(1337)、`synthesizeDirectSummary`(1356)、`decodeToolCall`(1121)、`parseMaybeJson`(1109) |
| `server/antigravity/bundle.ts` | `loadAntigravityBundle`(354)、`loadAntigravityTranscriptBundle`(412)、`buildAntigravityDescriptor`(213)、`findWorkspaceFromHistory`(333)、`artifactRecords`(1771)、`collectMarkdownFiles`(1817)、`buildAntigravityTitle`(1967)、`extractPrimaryWorkspace`(1974)、`toMetadataValue`(1998)、`stringifyMetadata`(2011) |
| `server/fsUtils.ts`（通用，不放 antigravity 下） | `fileExists`(1900)、`parseJsonLines`(1909)、`hasJsonLinesParseError`(1958 附近的 `stringifyJsonValue` 一并评估：若仅 antigravity 使用则留在 `records.ts`)、`isParseableJsonLinesFile`(1872) |

执行要求：

1. `server/antigravity.ts` 保留为**汇聚 re-export 文件**（`export * from "./antigravity/paths.js"` 等），这样 `server/scanner.ts`、`server/index.ts` 的 import 不用改；确认无循环依赖后，也可以直接更新调用方 import 并删除旧文件——优先后者，仅在出现循环时用前者。
2. 文件顶部的常量、正则、模块级 `const` 跟随其唯一使用者迁移；被多个新文件使用的放 `server/antigravity/shared.ts`。
3. 注意 ESM 相对导入必须带 `.js` 后缀（项目 `"type": "module"`，现有代码风格如此）。
4. **验收**：`npm run typecheck && npm test` 通过（重点：`tests/antigravity-title.test.ts`、`tests/scanner-mtime-slice.test.ts`）；`git diff --stat` 中旧文件删除行数 ≈ 新文件新增行数（允许 import/export 差异）。

### 1.3 从 `src/ui/chatView.ts` 抽出纯函数与图标

| 新文件 | 迁入符号（chatView.ts 行号） | 备注 |
|---|---|---|
| `src/ui/icons.ts` | `clipboardIcon`(622)、`spinnerIcon`(630)、`successIcon`(638)、`errorIcon`(646)、`timelineIcon`(654)、`pinIcon`(662) | 改为 `export`，供 sidebar/modal 后续复用 |
| `src/ui/messageFilter.ts` | `MessageViewFilter` 类型(14)、`FILTER_OPTIONS`(38)、`filterMessagesForView`(1481)、`isToolOnlyMessage`(1501)、`getFinalAssistantMessageIds`(670)、`partitionMessages`(695) | 全是纯函数，无 DOM 依赖 |
| `src/ui/resumeCommands.ts` | `buildCodexResumeCommand`(526)、`buildAntigravityResumeCommand`(539)、`buildClaudeResumeCommand`(552)、`buildCopilotResumeCommand`(574) | 阶段 3 会再迁入 source 注册表，此处先落脚 |
| `src/ui/timeline.ts` | `renderTimelineButton`(1067)、`buildAnchorId`(1505)、`buildTimelinePreview`(1510)、`timelineLabel`(1536)、`timelineEmoji`(1544) | |

执行要求：

1. `chatView.ts` 中保留 re-export：`export { filterMessagesForView, isToolOnlyMessage } from "./messageFilter.js";` 等——或更新 §0.2 表中 4 个测试文件与 `app.ts` 的 import。**优先更新测试与调用方**，`chatView.ts` 不留兼容层。
2. `MessageViewFilter` 类型被 `app.ts:5` import，一并更新。
3. **验收**：`npm run typecheck && npm test`（重点：`tests/chat-view-filter.test.ts`、`tests/chat-view-scroll.test.ts`、`tests/resume-command.test.ts`、`tests/subagent-notification.test.ts`）。

### 阶段 1 整体验收

- 三条验证命令全绿。
- `chatView.ts` 降到约 1100 行以下；`server/antigravity.ts`（或其目录中最大文件）低于 700 行。
- 提交信息建议：`refactor: split index.css / server antigravity / chatView into modules (no behavior change)`。

---

## 阶段 2：建立 `shared/` 层，理顺 server → src 依赖

目标：契约类型与跨端工具放到中立位置；消除前后端重复实现。

### 2.1 建立 `shared/` 目录

1. 新建根级 `shared/` 目录（与 `src/`、`server/` 平级）。
2. 将 `src/parsers/types.ts` **整体移动**为 `shared/types.ts`。在 `src/parsers/types.ts` 位置保留单行 re-export：`export * from "../../shared/types.js";`——因为 11 个测试文件和大量源码 import 它，全量替换 import 路径放到本阶段末尾统一做（见第 5 步）。
3. 新建 `shared/pathUtils.ts`，收敛以下重复实现（保留一份，删除其余）：
   - `normalizePathForMatch`：现存两份——`server/scanner.ts:613`（export）与 `src/parsers/detect.ts:109`（私有）。以 scanner 版为准（两者语义相同：反斜杠转正斜杠 + lowercase；若实现有差异，以 `tests/path-compat.test.ts` 通过为准）。
   - `isWithinPathRoot`（`server/scanner.ts:607`）。
   - `basenameFromAnyPath`（`server/scanner.ts:834`）。
4. 新建 `shared/descriptors.ts`，收敛 `compareDescriptors` 的两份实现：`server/scanner.ts:848` 与 `src/store/sessionStore.ts:668`。**先 diff 两份实现**：若排序键不同（例如一侧比较 mtime、另一侧还比较 title），说明是有意分化——此时不合并，改为在两处各加一行注释说明差异原因，并在本文档执行记录中注明。
5. 全仓更新 import：`src/`、`server/`、`tests/` 中所有 `parsers/types.js` 的 import 改为指向 `shared/types.js`；完成后删除 `src/parsers/types.ts` 兼容 re-export。
6. tsconfig 处理：`tsconfig.app.json` 与 `tsconfig.server.json` 的 `include` 都要覆盖 `shared/`（检查两个文件现有 include 配置并追加）。注意 `scripts/build-agent.mjs` 的 esbuild 入口是否受路径影响（grep `parsers/types` 确认）。

### 2.2 澄清 server 对 parser 辅助函数的依赖

server 目前从 `src/parsers/` import 的不只是类型，还有若干**纯提取函数**（用于构建描述符标题/CWD，不产出归一化 `Session`，因此不违背契约，但属于跨层引用）：

- `server/scanner.ts:19` ← `src/parsers/codex.ts` 的 `extractCodexPreviewTitle` / `extractCodexCwd` / `extractCodexParentThreadId` / `extractCodexSessionId`
- `server/scanner.ts:20` ← `src/parsers/claude.ts` 的 `extractClaudePreviewTitle` / `extractClaudeCwd`
- `server/scanner.ts:21` ← `src/parsers/utils.ts` 的 `parseJsonLines`
- `server/antigravity.ts:11` ← `src/parsers/antigravity.ts` 的 `extractAntigravityPreviewTitle`

处理方式：

1. 确认这些函数是**无 DOM、无 node:fs 依赖的纯函数**（读字符串→返回字符串），确认后将它们移入 `shared/extractors/{codex,claude,antigravity}.ts`（`parseJsonLines` 移入 `shared/jsonl.ts` 或与 §1.2 的 `server/fsUtils.ts` 决策合并——注意它同时被前端 parser 使用，必须放 `shared/`，不能放 `server/`）。原 parser 文件从 `shared/extractors/` re-import 使用，测试 import 路径同步更新。
2. 若某个函数不是纯函数（意外依赖浏览器或 node API），停止搬移并在执行记录中上报。
3. 完成后验证：`grep -rn "src/parsers" server/` 结果为空——server 对 `src/` 的依赖完全消除。

### 阶段 2 验收

- 三条验证命令全绿，重点 `tests/path-compat.test.ts`（475 行，该文件就是路径兼容的回归防线）。
- 全仓 `grep -rn "normalizePathForMatch" src server shared` 只剩 `shared/pathUtils.ts` 一处定义。
- 提交信息建议：`refactor: introduce shared/ layer for cross-runtime types and path utils`。

---

## 阶段 3：source 适配器注册表

目标：把"新增一个 source"从改 7+ 个文件收敛为"新建 1-2 个文件 + 注册一行"。分前端、后端两个子阶段，**先前端**（改动闭环小、测试密）。

### 3.1 前端注册表 `src/sources/`

1. 新建 `src/sources/types.ts`：

```ts
import type { Session, SessionBundle, SessionSource } from "../../shared/types.js";

export interface SourceAdapter {
  id: SessionSource;
  /** UI 展示名，如 "Codex CLI" */
  label: string;
  /** 内容/路径启发式检测。registry 按数组顺序调用，首个返回 true 者胜出 */
  detect(bundle: SessionBundle, ctx: DetectContext): boolean;
  parse(bundle: SessionBundle): Session;
  /** 可选：构建 resume 命令，无法构建返回 null */
  buildResumeCommand?(session: Session): string | null;
}

export interface DetectContext {
  /** normalizePathForMatch(primaryPath + 所有 file.path) 的结果，预计算避免每个 adapter 重复拼接 */
  combinedPath: string;
  /** bundle.files[0]?.content ?? "" */
  firstContent: string;
  trimmed: string;
}
```

2. 新建 `src/sources/{codex,claude,copilot,opencode,antigravity,gemini}.ts`，每个文件导出一个 `SourceAdapter`：
   - `detect` 的实现**逐字迁移** `src/parsers/detect.ts:10-81` 中对应 source 的条件分支（含全部字符串字面量，一个都不能改）；
   - `parse` 直接引用现有 `parseXxxSession`；
   - `buildResumeCommand` 迁入阶段 1.3 的 `src/ui/resumeCommands.ts` 中对应函数的函数体（迁移后删除 `resumeCommands.ts`；claude/codex/antigravity/copilot 有实现，gemini/opencode 省略该字段）。
3. 新建 `src/sources/registry.ts`：

```ts
export const SOURCE_ADAPTERS: SourceAdapter[] = [
  codexAdapter, copilotAdapter, claudeAdapter,
  opencodeAdapter, antigravityAdapter, geminiAdapter,
];
export function getAdapter(id: SessionSource): SourceAdapter | undefined { ... }
```

   **数组顺序必须与 `detect.ts:10-81` 现有 if 链的判断顺序完全一致**（codex → copilot → claude → opencode → antigravity → gemini），这个顺序承载检测优先级语义，改变顺序=改变行为。
4. 重写 `src/parsers/detect.ts`（保持导出签名不变，测试直接依赖它）：
   - `detectSessionSource`：保留 `bundle.source` 短路（第 11-13 行）；构建 `DetectContext`；遍历 `SOURCE_ADAPTERS` 调 `detect`；**保留兜底链**——现在 72-80 行有三条兜底规则（`{`+`"messages"` → gemini；`{`/`[` 开头 → opencode；默认 → claude），这三条留在 `detectSessionSource` 末尾，不进 adapter。
   - `parseSessionBundle`：switch 改为 `getAdapter(source)?.parse(bundle)`，catch 与 fallback 逻辑不变。
5. 更新 `chatView.ts` 中 resume 按钮的调用点：原来按 source 逐个调 `buildXxxResumeCommand` 的地方，改为 `getAdapter(session.source)?.buildResumeCommand?.(session) ?? null`。`tests/resume-command.test.ts` 改为从 adapter 导入（或测 registry 行为）。
6. sidebar/sshModal/exportMdModal 中 source 的展示 label 若为硬编码 map/switch（grep `codex` 等确认），改为读取 `getAdapter(...).label`。仅替换等价映射，不改任何显示文案。

**验收**：`npm test` 全绿，重点 `tests/*` 中 2 个依赖 `detect.ts` 的测试与所有 parser 测试；`grep -rn "buildCodexResumeCommand" src tests` 无残留（或只在 adapter 内）。

### 3.2 后端注册表 `server/sources/`

后端不能与前端共用 adapter（依赖 `node:fs`/`sqlite`，不能进浏览器 bundle），单独一套：

1. 新建 `server/sources/types.ts`：

```ts
export interface ServerSourceAdapter {
  id: SessionSource;
  /** 返回该 source 的本地扫描根（含平台差异，内部使用 platformRoots.ts） */
  scanRoots(roots: LocalScanRoots): string[];
  /** 路径归属判断，替代 inferSourceFromPath 中对应分支 */
  matchPath(absolutePath: string): boolean;
  /** 可选：非文件树扫描的 source 自行实现发现逻辑（opencode sqlite、copilot 目录、antigravity brain） */
  scan?(ctx: ScanContext): Promise<SessionDescriptor[]>;
  /** 可选：自定义 bundle 加载（默认实现=读 primaryPath + relatedPaths 文本） */
  loadBundle?(key: string): Promise<SessionBundle | undefined>;
}
```

2. 迁移映射（源 → adapter）：

| source | 迁移内容 |
|---|---|
| codex / claude / gemini | 走默认文件树扫描（`scanFileTree`），adapter 只提供 `scanRoots` + `matchPath`（来自 `inferSourceFromPath`(scanner.ts:570) 对应分支） |
| antigravity | `scan` ← `scanAntigravitySessions`(278) + `loadAntigravityHistoryMap`(256)；`loadBundle` ← `loadAntigravityBundle`；`matchPath` ← `preferAntigravityPath`(593) 相关判断 |
| copilot | `scan` ← `scanCopilotSessionDirectories`(397) + `scanCopilotSessionDirectoriesInRemoteMirror`(376)；`loadBundle` ← `loadCopilotBundle`(505)；descriptor 构建 ← `buildCopilotDescriptor`(696) 及 `readCopilotWorkspaceFile`/`inferCopilotTitle`/`inferCopilotMtimeMs`/`parseSimpleYamlRecord` |
| opencode | `scan` ← `scanOpenCodeDatabase`(433) + `scanOpenCodeDatabasesInRemoteMirror`(366)；`loadBundle` ← `loadOpenCodeBundle`(456)；`querySqlite`(866) 移入 `server/fsUtils.ts` 或 opencode adapter 私有 |

3. 重写 `scanner.ts` 的两个 export 入口（**签名不变**，`server/index.ts` 不感知变化）：
   - `scanLocalSessions()`：默认文件树扫描一次 + 遍历 registry 调用各 `scan?()`，结果合并后走现有 `dedupeAndSortDescriptors`(839)；
   - `loadLocalSessionBundle(key)`：先按 key 归属找 adapter 的 `loadBundle`，无则走默认文本读取；
   - `inferSourceFromPath` 改为遍历 registry 的 `matchPath`，**遍历顺序与原 if 链一致**。
4. remote/SSH 路径（`server/ssh.ts`、`server/remote.ts`）本阶段**不动**——远程扫描根列表如有硬编码，只加 `// TODO: unify with server/sources registry` 注释。

**验收**：`npm run typecheck && npm test`（重点 `tests/scanner-mtime-slice.test.ts`、`tests/opencode-sqlite.test.ts`、`tests/copilot-session.test.ts`）；手动 `npm run dev` 确认本地扫描出的会话列表与重构前一致（source 徽章、数量、排序）。

### 3.3 收尾：新增 source 的操作手册

在 `src/AGENTS.md`（或新建 `docs/adding-a-source.md`）写明新流程：新增 source = ① `shared/types.ts` 加枚举值 → ② 新建 `src/sources/<name>.ts` + 注册 → ③ 新建 `src/parsers/<name>.ts` → ④（如需扫描）新建 `server/sources/<name>.ts` + 注册 → ⑤ 补一个 parser 测试。

提交建议：3.1 与 3.2 分两次 commit。

---

## 阶段 4：分区渲染（唯一有行为风险的阶段，放最后）

### 4.1 问题定位

`src/ui/app.ts:293` `render(state)` 在每次 store 通知时全量重建：

- `sessionStore.ts` 的 `updateState`（私有，10 个调用点）对任何字段变更都广播完整 `StoreState`；
- `app.ts:325` `sidebarMount.replaceChildren(renderSidebar(...))` + `app.ts:396` `mainMount.replaceChildren(renderChatView(...))` 每次都执行；
- 为掩盖副作用存在的补丁：搜索框焦点/光标保存恢复（319-322、381-390）、`captureSidebarScroll`/`restoreSidebarScroll`、status pill "copied" class 特判(310)、每次 `cleanupMermaid()`(394)。

后果：搜索框每敲一个字符都重建整个 chat 视图（可能数千条消息 + mermaid + 代码高亮）。

### 4.2 实施步骤

**步骤 A：store 通知携带变更域。**

1. `sessionStore.ts` 中定义 `export type StateScope = "sidebar" | "session" | "all";`，`Listener` 签名改为 `(state: StoreState, scope: StateScope) => void`。
2. `updateState(partial, scope)` 增加第二参数，10 个调用点逐一标注：
   - `setSearch`、`setSourceFilter`、`togglePin`、`toggleFavorite`、`favoriteMetadata` 更新、`toggleSessionCollapse`、`hideProject` 系列 → `"sidebar"`（注意：pin/favorite 同时影响 chat 头部按钮状态——检查 `renderChatView` 的 options 用到 `pinnedKeys/favoriteKeys`，因此 pin/favorite 用 `"all"`，其余用 `"sidebar"`）；
   - `selectSession` 中间态与完成态 → `"all"`（选中变化影响两侧）；
   - `refreshLocalScan` → `"all"`。
   - **判定原则**：某字段被 `renderChatView` 的 options 引用 → 不能只标 `"sidebar"`。逐字段核对 `app.ts:396-430` 传给 `renderChatView` 的每个 option。
3. `subscribe` 初始回调传 `"all"`。

**步骤 B：`app.ts` 分区渲染。**

1. `render(state)` 拆为三个私有方法：`renderShellState(state)`（class toggle + status pill，廉价，总是执行）、`renderSidebarRegion(state)`、`renderMainRegion(state)`。
2. 订阅回调改为：`scope === "sidebar"` 时跳过 `renderMainRegion`；`scope === "session"` 时跳过 `renderSidebarRegion`；`"all"` 都执行。
3. `cleanupMermaid()` 只在 `renderMainRegion` 内调用。
4. app 本地 UI 状态（`this.sidebarOpen`、`this.timelineOpen`、`this.messageFilter` 等）变化时的手动 `this.render(...)` 调用点（grep `this.render(` 找全），改为调用对应分区方法。

**步骤 C：搜索输入框脱离重建循环。**

1. 检查 `sidebar.ts` 中搜索 `<input>` 的构建位置。将 sidebar 拆为"控件区（搜索框+过滤下拉，构建一次）"与"列表区（每次重建）"：`renderSidebar` 返回结构不变，但内部把列表容器做成独立函数 `renderSessionList(...)`，`renderSidebarRegion` 在搜索触发时只 `replaceChildren` 列表容器。
2. 实现方式允许两种，选改动小的：
   - a) `renderSidebarRegion` 保持全重建，但对 `scope === "sidebar"` 且仅 search 变化的场景，直接定位现有 DOM 中的列表容器做局部替换；
   - b) sidebar 改为"创建一次、持有引用、暴露 `update(state)` 方法"的组件模式（与 modal 的 `createXxxModal` 风格一致）。**推荐 b**，与现有 `createImportModal` 等命名/结构对齐。
3. 完成后**删除**以下补丁代码并验证行为仍正确：
   - `app.ts:319-322, 381-390` 焦点/光标保存恢复；
   - `captureSidebarScroll`/`restoreSidebarScroll`（若列表区仍整体重建，滚动恢复仍需要——此时保留但收窄到列表容器）；
   - status pill `"copied"` 特判(310)——status pill 更新移入 `renderShellState`，与 copied 计时器的交互重新审视：若 pill 文本仅在选中变化时更新，特判可简化。

**步骤 D：回归清单（手动，`npm run dev`）。**

- 搜索框连续输入不丢焦点、光标位置正确、列表实时过滤；
- 输入搜索时右侧 chat 视图 DOM 不重建（DevTools Elements 面板观察，或在 `renderMainRegion` 加临时 `console.count` 验证后删除）；
- 切换会话：chat 重建、timeline 正常、mermaid 图正常渲染且无重复实例（`cleanupMermaid` 生效）；
- pin/favorite 按钮：sidebar 与 chat 头部状态同步变化；
- 隐藏/恢复 workspace、Rescan local、导入文件、Esc 关 modal、明暗主题切换、sidebar/timeline 的 pin 与 hover 展开；
- 浏览器窗口缩放（`viewportWidth` 相关逻辑）。

**步骤 E：补自动化测试。** 在 `tests/` 新增 `render-scope.test.ts`（复用 `tests/dom-mock.ts`）：构造 store，订阅后调 `setSearch`，断言回调 scope 为 `"sidebar"`；调 `selectSession` 断言 `"all"`。UI 层至少覆盖：sidebar 更新不触碰 mainMount 子树（对比更新前后 `mainMount.firstChild` 引用相等）。

### 阶段 4 验收

- 三条验证命令 + 新增测试全绿；步骤 D 手动清单逐项确认。
- 提交建议：步骤 A+B 一个 commit，C 一个 commit，E 随 C。

---

## 阶段 5（可选，另行排期）：SessionStore 瘦身

优先级最低，前四阶段完成后视情况执行：

1. 新建 `src/api/client.ts`：收敛 `sessionStore.ts` 与 `connection.ts` 中所有 `fetch("/api/...")` 调用为函数集（`fetchLocalScan()`、`fetchSessionBundle(key)`、`fetchRemoteScan(id)` 等），统一错误处理；store 只依赖该模块。
2. 新建 `src/store/persistence.ts`：收敛 localStorage 读写——store 内的 pin/favorite/hidden 持久化 + `app.ts:803-860` 的 `getInitialTheme`/`getStoredBoolean`/`getStoredScrollPosition`/`setStoredScrollPosition`。所有 storage key 常量集中于此。
3. `getVisibleDescriptors`(171) 的过滤/排序逻辑抽为纯函数模块 `src/store/visibility.ts`，直接单测（现有 `tests/session-store.test.ts` 可简化）。

---

## 附录 A：阶段依赖与提交序列

```
阶段1.1 (css) ──┐
阶段1.2 (antigravity) ──┼── 互相独立，可任意顺序 ──→ 阶段2 (shared/) ──→ 阶段3.1 (前端registry)
阶段1.3 (chatView) ──┘                                                └→ 阶段3.2 (后端registry)
                                                                            └→ 阶段4 (分区渲染) → 阶段5 (可选)
```

每个编号一个独立 commit；commit message 用 `refactor:` 前缀并注明 "no behavior change"（阶段 4 除外）。

## 附录 B：执行记录（执行者填写）

| 阶段 | 状态 | commit | 偏差/上报事项 |
|---|---|---|---|
| 1.1 | 完成 | `2d5a074` | 无 |
| 1.2 | 完成 | `23be0c1` | 无 |
| 1.3 | 完成 | `bbaf4db` | 无 |
| 2 | 完成 | `d915fdb` | 无 |
| 3.1 | 完成 | `f2d7e42`、`63624b7` | 为保留已有的 Default/Unsafe resume 下拉行为，`buildResumeCommand` 签名扩展为接收可选的 `ResumeCommandOptions`；除此之外无偏差。 |
| 3.2 | 完成 | `a13af3b`、`6ebc1d6`、`4c86778` | 无 |
| 3.3 | 完成 | `402deb2` | 无 |
| 4 | 实现完成；自动验证通过；手动回归受阻 | `6b28b25`、`03e63f0`、`9921daf`、`b69830e` | store 变更域、持久 sidebar、延迟 transition 重验与 app 分区渲染分四次提交落地。最终自动验证为 typecheck 通过、测试 187/187 通过、build 通过。`npm run dev` 的 server 命令在当前 Node/tsx 环境把 `watch` 解析为入口模块，改用等价的 `NODE_OPTIONS=--max-old-space-size=256 npx tsx watch server/index.ts` 配合 `npm run dev:web` 后服务可启动；但 browser-client 未发现可用的 in-app browser（browser list 为空），因此步骤 D 的搜索 DOM identity、跨区联动、chat-local、modal/theme 与响应式检查均未执行、未标记通过，也未使用替代 browser automation。 |
