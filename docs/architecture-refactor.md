# ThreadAtlas 架构评审与重构建议

> 评审日期：2026-07-06 · 基线：`main @ bd3af98` · 全部源码约 26k 行（不含测试）

## 一、现状架构概览

```
server/            Express (localhost:3030)
  index.ts         路由：/api/local/scan|session|file、SSH、remote relay、静态托管
  scanner.ts       文件树扫描 + 各 source 的描述符构建（880 行）
  antigravity.ts   .pb 解码 / transcript 转换（2206 行）
  ssh.ts remote.ts SSH 同步与远程中继

src/parsers/       source 检测 + 各 source 归一化为统一 Session 模型
  types.ts         SessionDescriptor / SessionBundle / Session 契约（89 行，前后端共用）
  detect.ts        内容/路径启发式检测 + parse 分发

src/store/         SessionStore：状态 + API 调用 + localStorage 持久化（711 行）
src/ui/            无框架 DOM UI：app.ts 编排，chatView/sidebar/各 modal
src/index.css      全部样式（4342 行单文件）
```

**做得好的地方（重构中必须保留）：**

- 契约边界清晰且有文档约束（AGENTS.md）：scan 只返回描述符、session 返回原始 bundle、前端 parser 独占语义归一化、Antigravity `.pb` 是唯一后端解码例外。
- 无框架、无数据库、请求级后端，运维负担极低。
- parser 容错哲学统一：解析失败降级为 `buildFallbackSession` 而不是硬失败。
- 测试覆盖了最脆弱的部分（parser、路径兼容、DOM 行为）。

## 二、主要问题（按优先级）

### P1-1：全量重渲染 + 补丁式状态恢复

`app.ts:293` 的 `render(state)` 在**每次**状态变化时用 `replaceChildren` 重建整个 sidebar 和 chat 视图。为了掩盖副作用，已经堆积了多个补丁：

- 搜索框焦点/光标位置手动保存再恢复（`app.ts:319-322, 381-390`）
- sidebar 滚动位置手动 capture/restore（`captureSidebarScroll` / `restoreSidebarScroll`）
- status pill 的 "copied" class 特判（`app.ts:310`）
- 每次 render 都要 `cleanupMermaid()`（`app.ts:394`）

后果：搜索框每敲一个字符，整个 chat 视图（可能包含数千条消息、mermaid 图、高亮代码块）全部重建。这是目前最大的性能与复杂度税，而且每加一个有状态的 UI 元素都要再打一个恢复补丁。

**建议：分区渲染，不引入框架。**

1. `StoreState` 变化时携带变更域（例如 `notify({ scope: "sidebar" | "session" | "selection" })`，或 store 拆成多个可独立订阅的 slice）。
2. `render` 拆为 `renderSidebar(state)` / `renderMain(state)`，只重建变化的区域。搜索输入只触发 sidebar 列表区重建（甚至只重建列表 `<ul>`，输入框保持原 DOM 节点，焦点问题自然消失）。
3. 会话切换才重建 chat 视图；messageFilter 切换可以只重建消息列表容器。

这一步做完，`app.ts` 里的焦点/滚动恢复补丁可以直接删除。

### P1-2：source 适配逻辑横向散落，新增一个 source 要改 7+ 个文件

目前支持 6 个 source，每个 source 的知识分散在：

| 关注点 | 位置 |
|---|---|
| 类型枚举 | `src/parsers/types.ts`（`SessionSource` union） |
| 扫描根目录 | `server/scanner.ts` + `server/platformRoots.ts` |
| 路径推断 | `scanner.ts:570` `inferSourceFromPath` |
| 描述符构建特例 | `scanner.ts`（antigravity/copilot/opencode 各有专用分支） |
| 内容检测启发式 | `src/parsers/detect.ts:10-81`（顺序敏感的 if 链） |
| parse 分发 | `detect.ts:83-107`（switch） |
| resume 命令 | `src/ui/chatView.ts:526-585`（4 个 `buildXxxResumeCommand`） |
| UI 标签/徽章 | `sidebar.ts`、`sshModal.ts`、`exportMdModal.ts` |

**建议：引入 source 适配器注册表。**每个 source 一个模块，实现统一接口：

```ts
// src/sources/types.ts
interface SourceAdapter {
  id: SessionSource;
  label: string;
  // 检测：返回置信度或 boolean，detect.ts 变成按优先级遍历注册表
  detect(bundle: SessionBundle): boolean;
  parse(bundle: SessionBundle): Session;
  // UI 能力（可选）
  buildResumeCommand?(session: Session): string | null;
}

// server 侧另有一份 server 专属扩展（扫描根、描述符构建），
// 因为扫描依赖 node:fs，不能进浏览器 bundle
interface ServerSourceAdapter {
  id: SessionSource;
  scanRoots(): string[];
  matchPath(absolutePath: string): boolean;
  buildDescriptor?(...): SessionDescriptor;   // 无特例的 source 用默认实现
  loadBundle?(key: string): Promise<SessionBundle>; // opencode sqlite、copilot 目录、antigravity pb 各自实现
}
```

收益：新增 source 从"改 7 个文件"变成"新建 1-2 个文件 + 注册一行"；`detect.ts` 的顺序敏感 if 链变成显式优先级列表；`scanner.ts` 里的三处 source 特例分支（antigravity / copilot / opencode）收敛为注册表的默认路径 + 各自 override。

### P2-1：巨型文件拆分

| 文件 | 行数 | 混合的职责 |
|---|---|---|
| `src/index.css` | 4342 | 全部组件样式 |
| `server/antigravity.ts` | 2206 | 路径路由、`DirectPbDecoder`（~400 行类）、transcript 解析、extension.js 描述符提取、chat 记录构建、通用工具（`fileExists`、`parseJsonLines`） |
| `src/ui/chatView.ts` | 1616 | 会话头、消息渲染、timeline、resume 命令、SVG 图标、消息过滤纯逻辑 |
| `src/ui/sidebar.ts` | 943 | 列表、分组、搜索、过滤器、workspace 管理 |
| `src/ui/sshModal.ts` | 907 | 表单、连接测试、扫描、同步进度 |

**建议拆分（不改行为，纯搬家）：**

- `server/antigravity/` 目录：`paths.ts`（路径判定/解析）、`pbDecoder.ts`（`DirectPbDecoder`）、`descriptors.ts`（与现有 `antigravityDescriptors.ts` 合并）、`records.ts`（buildChatRecords/transcript）、`bundle.ts`（loadAntigravityBundle 入口）。`parseJsonLines`/`fileExists` 移入 `server/fsUtils.ts`。
- `chatView.ts` 拆出：`messageFilter.ts`（`filterMessagesForView`/`isToolOnlyMessage`/`partitionMessages` 等纯函数，测试也随之简化）、`resumeCommands.ts`（并入 source 适配器）、`icons.ts`（`clipboardIcon` 等 8 个图标函数，sidebar/modal 可复用）、`timeline.ts`。
- `index.css` 按组件切成 `src/styles/{base,topbar,sidebar,chat,timeline,modals,markdown}.css`，在入口 `@import` 或由 Vite 聚合。纯机械切分，零风险。

### P2-2：server → src 的反向依赖，共享层不明确

server 直接 import `../src/parsers/types.js`、`../src/parsers/{codex,claude,antigravity,utils}.js`。类型共享是合理需求，但放在 `src/parsers/` 下语义上是"前端目录"，且 `server/agent.ts` 引 parser 实现已经越过了 "backend 不产出归一化 Session" 的文档契约（如果这是 agent 导出场景的刻意例外，应在 AGENTS.md 写明）。

**建议：**建 `shared/` 目录（`shared/types.ts`、`shared/pathUtils.ts`），tsconfig 两侧都包含。`SessionDescriptor/SessionBundle/Session` 契约类型移过去——AGENTS.md 已经说"改 shape 先改 types.ts"，把它放到中立位置能让这条规则在目录结构上自解释。

### P3-1：`SessionStore` 职责过多（711 行）

同时承担：状态容器、fetch API 客户端、localStorage 持久化（pin/favorite/hidden）、过滤/排序/合并/选择解析逻辑。`connection.ts` 里又有另一批 fetch。

**建议：**拆出 `src/api/client.ts`（所有 `/api/*` fetch，含 token/错误处理统一）和 `src/store/persistence.ts`（localStorage 读写）。`getVisibleDescriptors` 这类过滤/排序纯逻辑可以移到独立模块，方便直接单测而不用 mock store。

### P3-2：小型重复

- `compareDescriptors` 在 `server/scanner.ts:848` 和 `src/store/sessionStore.ts:668` 各一份 → 移入 `shared/`。
- 路径归一化：`scanner.ts:613` `normalizePathForMatch` 与 `detect.ts:109` 同名同义 → 移入 `shared/pathUtils.ts`（`tests/path-compat.test.ts` 475 行说明这里已经是已知痛点）。
- `app.ts` 中 `getStoredBoolean`/`getStoredScrollPosition` 与 store 的持久化逻辑分裂 → 并入 P3-1 的 persistence 模块。

## 三、建议实施顺序

每一阶段独立可交付、可回归（`npm run typecheck && npm test`），互不阻塞：

1. **阶段 0（纯搬家，零行为变化）**：拆 `index.css`；拆 `server/antigravity/`；从 `chatView.ts` 抽出纯函数与图标。现有测试原样通过即验收。
2. **阶段 1（shared 层）**：建 `shared/`，迁移契约类型与路径工具，消除重复函数。改动面是 import 路径。
3. **阶段 2（source 注册表）**：先做前端侧（detect + parse + resumeCommand 收敛），再做 server 侧（scanRoots + 描述符特例收敛）。每迁一个 source 跑一次对应 parser 测试。
4. **阶段 3（分区渲染）**：store 通知带 scope，`render` 拆分，删除焦点/滚动恢复补丁。这是唯一有行为风险的阶段，放最后，且 `tests/dom-mock.ts` 体系已经能覆盖大部分回归。

## 四、明确不建议做的事

- **不引入前端框架/虚拟 DOM**。分区渲染足以解决当前问题，引入框架违反项目约束且收益不成比例。
- **不改 API 契约**（scan 只返回描述符、bundle 返回原始内容、antigravity 例外）。所有重构都在契约内部进行。
- **不为 server 引入数据库或缓存层**。请求级、无状态是刻意的设计。
- **不追求 parser 逻辑"去重"**。各 parser 间的相似代码是对不同上游格式的容错，强行抽象会让"某个上游格式变了"的修改变得危险。
