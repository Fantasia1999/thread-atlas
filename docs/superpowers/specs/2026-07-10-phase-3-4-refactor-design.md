# 阶段 3–4 架构重构设计

## 背景与范围

本设计以 `docs/architecture-refactor.md`（commit `3b2e1b493028d755a5ded8eb98bfd47b1631cb19`）为权威规格，并以当前 `main` 的阶段 1、2 成果为起点。此次只完成必做的阶段 3 和阶段 4，不包含规格中明确标为可选、另行排期的阶段 5。

当前代码在阶段 2 之后增加了 unsafe resume 命令下拉和 Claude subagent 会话导航。本次重构必须保留这些新增行为，并在原规格接口上做必要的类型扩展。

## 执行前基线

- `npm test`：155 项通过。
- `npm run build`：通过。
- `npm run typecheck`：在 `src/ui/app.ts:194` 失败。

类型失败的根因是 Claude subagent 导航将通用 `MetadataValue` 直接赋给 `string | undefined` 字段，未先收窄为字符串。实施阶段先做一个独立的最小修复，恢复三项验证全绿，再开始架构改动。

## 阶段 3：Source Adapter 注册表

### 前端注册表

在 `src/sources/` 建立前端 adapter 层：

- `types.ts` 定义 `SourceAdapter`、`DetectContext` 和 resume 命令选项类型。
- 每个已支持 source 各有一个 adapter，负责检测、调用现有 parser、提供显示 label，并按需构建 resume 命令。
- `registry.ts` 以固定顺序注册 adapter：Codex、Copilot、Claude、OpenCode、Antigravity、Gemini。该顺序保持当前检测优先级。
- `src/parsers/detect.ts` 继续保留显式 `bundle.source` 短路、三个通用 fallback 和 parser 异常时的 readable fallback；source 特定检测与 parse 分派改由 registry 完成。

原规格中的 `buildResumeCommand(session)` 扩展为接收可选的 `{ unsafe?: boolean }`，以保留当前 UI 的 Default/Unsafe 下拉。Codex、Claude、Antigravity 和 Copilot adapter 实现该能力；Gemini 与 OpenCode 不实现。

现有硬编码 source label 在文案完全等价时改为从 registry 获取。未知 source 仍使用当前 fallback 文案，不因注册表缺项而中断渲染。

### 后端注册表

在 `server/sources/` 建立 Node 专用 adapter 层，不与浏览器 adapter 混用：

- Codex、Claude、Gemini 提供扫描根和路径匹配，并复用默认文本文件树扫描与 bundle 加载。
- Antigravity、Copilot、OpenCode 分别拥有其特殊扫描、descriptor 构建和 bundle 加载流程。
- registry 固定路径匹配优先级；`server/scanner.ts` 收敛为根目录解析、adapter 调度、结果合并、去重与排序的编排层。
- 对 source 扫描失败的容错、扫描上限、mtime 排序、父会话恢复、key 格式和 API 返回 shape 全部保持不变。
- SSH 与 remote 发现/同步逻辑不迁移，只按原规格标记未来统一点。

完成后补充新增 source 指南，明确 shared 类型、前端 adapter、parser、后端 adapter 和测试的修改顺序。

## 阶段 4：分区渲染

### Store 变更域

`SessionStore` 的 listener 增加 `sidebar | session | all` scope。初次订阅使用 `all`。当前代码已有 17 个 `updateState` 调用点，实施时逐一按实际消费者标注，而不是照搬旧规格中的 10 个调用点数量。

- 只影响搜索、source 过滤、隐藏项目和树展开状态的更新使用 `sidebar`。
- 只影响当前 session 区域且不改变列表选择的局部更新可使用 `session`。
- 选择、扫描、导入、descriptor/session 集合变化，以及 pin/favorite 等同时影响两侧的状态使用 `all`。

判定依据是状态字段的真实渲染消费者；任何被 chat header 或 sidebar 同时读取的字段不得降为单区更新。

### App 渲染边界

`ThreadAtlasApp` 将全量 `render` 拆为：

- `renderShellState`：同步轻量 class、status 和壳层状态。
- `renderSidebarRegion`：更新 sidebar 控件与 session list。
- `renderMainRegion`：清理 Mermaid 并重建当前 session 视图。

store scope 决定调用哪些区域；本地 UI 状态变化直接调用其真正影响的区域。搜索与 source 过滤不得调用 `renderMainRegion`。

### 稳定 Sidebar 组件

Sidebar 使用持久化根节点、搜索框、source dropdown 和 list mount。更新时同步控件状态并只替换 session list 内容，因而搜索输入不会丢失焦点或光标，也不会重建 chat DOM。

为保持现有测试和调用兼容，`renderSidebar` 继续提供一次性渲染入口；App 使用新的可更新 sidebar controller。自定义 dropdown 增加受控更新能力，避免捕获过期的 selected value。

当稳定节点替代全量 sidebar 重建后，删除不再必要的搜索焦点/selection 恢复逻辑。Sidebar list 的滚动位置由稳定 list 节点自然保留；若某个列表内容更新确实改变滚动位置，只在 list mount 内做最窄范围恢复。Mermaid cleanup 仅属于 main region。

## 数据流与容错

前端 bundle 流程保持为：bundle → registry detection → source parser → normalized `Session`。检测不到或 parser 抛错时仍由 `detect.ts` 构建 fallback session。

后端扫描流程保持为：platform roots → registry adapters/default scan → descriptors → dedupe/sort。bundle 请求按 key/source 交给特殊 adapter；无特殊 loader 时读取原始文本文件。后端不生成 normalized `Session`，Antigravity protobuf 解包仍是唯一例外。

## 测试与验收

采用测试驱动顺序：

1. 用现有失败的 typecheck 复现并最小修复 subagent metadata 收窄问题。
2. 先补前端 registry 的顺序、fallback、parse 分派和 unsafe resume 测试，再迁移实现。
3. 先补后端 registry/path routing 的行为测试，再迁移 scanner 逻辑；现有 scanner、OpenCode、Copilot、Antigravity 回归测试作为主要防线。
4. 先增加 `render-scope.test.ts`，覆盖 scope 通知、搜索不替换 `mainMount.firstChild`、会话选择会更新 main，再实现分区渲染和稳定 sidebar。
5. 每个独立阶段运行 `npm run typecheck`、`npm test`、`npm run build`。
6. 最后通过浏览器手动验证搜索焦点、source 过滤、会话切换、timeline、Mermaid、pin/favorite、隐藏/恢复 workspace、导入、扫描、modal、主题和响应式行为。

提交保持阶段独立：基线类型修复、阶段 3.1、阶段 3.2/3.3、阶段 4 可分别审阅和回退。现有未跟踪的 `.antigravitycli/` 不纳入任何提交。
