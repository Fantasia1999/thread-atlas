# Timeline 悬停闪屏修复设计

## 背景

未固定的 timeline 在鼠标进入右侧按钮 50ms 后展开，在鼠标离开区域 80ms 后收起。当前两次状态变化都会调用 `renderMainRegion()`，通过 `replaceChildren()` 重建标题、消息列表、timeline 和滚动控件。新消息列表在分批渲染完成前保持透明，因此长会话会在展开和收起时各闪一次。

浏览器复现使用 500 条消息时确认：hover 后原消息节点被替换，新列表约 280ms 处于 `opacity: 0`，期间发生 50 次分批 DOM 更新。问题与服务绑定地址无关，但最终验收使用用户实际的 `npm start -- --host=0.0.0.0` 和默认端口 3030。

## 目标

- 保留现有悬停展开、移开收起、点击、固定、Escape 和响应式行为。
- timeline 状态变化时不替换消息列表，不让正文消失、跳动或丢失滚动位置。
- 会话选择、消息筛选和数据变化仍可沿用完整主区域渲染。

## 设计

`ThreadAtlasApp` 继续持有 `timelineOpen` 和 `timelinePinned`。新增一个只同步现有视图状态的方法，根据当前状态更新：

- shell 和 main panel 的 `timeline-open` / `timeline-pinned` class
- timeline dock 的 `open` / `pinned` class
- 展开按钮的 title 与 `aria-label`
- 固定按钮的 active class、title 与 `aria-label`

`toggleTimelineOpen()` 和 `toggleTimelinePin()` 只更新状态、持久化设置并调用该同步方法，不再调用 `renderMainRegion()`。Escape 和窗口尺寸变化中仅涉及 timeline 展示状态的分支也使用同一方法。完整渲染结束后仍执行一次状态同步，保证新建视图与应用状态一致。

不采用仅删除消息列表透明样式的方案，因为它仍会在每次 hover 时重复解析和创建全部消息，只是把闪白变成可见的渐进重建。

## 测试与验收

- DOM 回归测试覆盖展开和收起，断言 `.chat-messages` 始终是同一个节点。
- 验证 dock、main panel、按钮 title/ARIA 和固定状态正确同步。
- 运行完整测试、类型检查和生产构建。
- 在 `http://localhost:3030` 使用长会话逐帧复测：进入与离开时消息节点身份不变，opacity 始终为 1，滚动位置不变。
