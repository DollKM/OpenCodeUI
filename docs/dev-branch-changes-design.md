# OpenCode UI dev 分支设计变更文档

> 基于 `dev` 分支自 `main@0.6.11` 创建以来的全部修改整理，以最新改动为准，按模块和功能领域归纳为设计级描述。

---

## 1. 架构重构

### 1.1 单窗口模式

**变更前**：多窗口架构，支持 `open_new_window` 命令和 `create_hidden_content_window`，每次双击打开新窗口。

**变更后**：只保留一个 `main` 窗口，移除新建窗口按钮和所有多窗口创建逻辑。

- 删除 `src-tauri/src/app/mod.rs` 中 `create_hidden_content_window`、`create_new_window` 函数
- 删除 `open_new_window` Tauri 命令
- `single-instance` 插件回调中，二次启动不再创建新窗口，改为将目录传递给已有 main 窗口（`deliver_directory_to_main`）
- macOS 的 `open-url` 事件同理，统一走 `deliver_directory_to_main`
- 关闭窗口时直接判断 `we_started` 状态决定是否阻止关闭（不再检查窗口数量）

**设计要点**：
- 目录传递通过 `OpenDirectoryState`（`Arc<Mutex<HashMap>>`）+ `emit("open-directory")` 事件实现
- 最近一次右键/拖拽传入的目录覆盖上一次

### 1.2 移除 Docker / CI / Rust 路由

删除以下不再维护的模块：

| 删除项 | 文件 |
|--------|------|
| Docker 编排文件 | `docker-compose*.yml`, `docker/` 目录下全部文件 |
| CI 工作流 | `.github/workflows/docker-*.yml` |
| Rust 路由子项目 | `src-router/` 完整移除（含 `Cargo.toml`, `Cargo.lock`, `caddy.rs`, `router.rs` 等） |
| Dockerignore | `.dockerignore` |

**影响**：项目从 monorepo Docker 部署架构回归为纯 Tauri 桌面应用 + 前端 SPA。

### 1.3 移除 ChangeScope 概念

**变更前**：`useFileExplorer` 通过 `changeScopeStore` 支持四种变更对比模式（`session` / `turn` / `git` / `branch`），用户可在不同模式下查看文件变更。

**变更后**：固定使用 `git diff`，不再提供对比模式选择。

- 删除 `src/store/changeScopeStore.ts`
- `useFileExplorer.ts` 移除 `changeMode` 依赖，直接调用 `getVcsDiff('git', directory)`
- `session.ts` API 清理废弃的 `diff` 相关接口
- 删除 `turnCheckpointStore`（Turn Checkpoint 功能对应的 store）

**设计原因**：git diff 是最准确的变更来源，简化 UI 和状态管理。

---

## 2. 新功能模块

### 2.1 GitChangesPanel — Git 变更查看面板

**文件**：`src/components/GitChangesPanel.tsx`（约 900 行）

**定位**：独立于 session 的 Git 变更查看器，即使没有活跃会话也能显示 git diff。

**核心设计**：

```
┌─ 统计栏 ───────────────────────────────────────┐
│ +N -M N files  [提交模型] [批量提交] [列表/树] [统一/分栏] [刷新] │
├─ 文件列表（上方） ──────────────────────────────┤
│  🔽 src/                              +5 -2     │
│    M components/Button.tsx            +3 -1     │
│    A utils/helper.ts                  +2 -1     │
│  （可拖拽调整高度）                                │
├─ 分隔条 ────────────────────────────────────────┤
│  Diff 预览区（下方）                              │
│  [utils/helper.ts  ×] [+2 -1]   [🗖]            │
│  ┌─────────────────────────────────────────┐    │
│  │ unified / split 视图                      │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**关键设计决策**：

- **变更树结构** (`buildChangesTree`)：将扁平 diff 列表按路径构建为目录树，支持展开/折叠，自动汇总子目录的增删行数
- **文件状态推断** (`getFileStatus`)：根据 `status` 字段或 `additions`/`deletions` 分布判断 `added`/`modified`/`deleted`，不同状态使用不同颜色
- **预览标签栏**：仿 IDE 的 tabs 栏，支持打开多个 diff 文件预览、拖拽排序、关闭标签
- **全屏查看** (`FullscreenViewer`)：以遮罩层方式展示全屏 diff
- **垂直分割调整**：使用 `useVerticalSplitResize` hook，CSS 变量 + `requestAnimationFrame` 实现流畅的拖拽调整
- **目录切换时重置**：切换目录时清空所有状态并重新加载（通过 `useEffect` 监听 `directory` 变化）
- **patches 统计统一**：使用 `computePatchStats` 重新计算 `additions`/`deletions`，保证与 DiffViewer 渲染口径一致

**批量提交集成**：
- 从 `getCommitModel()` 读取全局配置的提交模型
- 调用 `createSession` + `sendMessageAsync` 发送"按修改分批提交git"指令
- 提交前校验模型是否已配置，未配置时按钮禁用

### 2.2 Header 工具栏按钮重构 — MCP/Skills 独立面板入口

**设计**：Header 工具栏中将 MCP 和 Skills 作为独立面板入口按钮，不再通过统一集成面板切换 Tab。

| 按钮 | 图标 | 行为 |
|------|------|------|
| Skills | Teach | `layoutStore.addSkillTab('right')` → 打开独立 SkillPanel |
| MCP | Plug | `layoutStore.addMcpTab('right')` → 打开独立 McpPanel |

**背景**：早期曾创建 `IntegrationsPanel`（`src/components/IntegrationsPanel.tsx`）将 MCP、Skills、Tools 统一在一个 Tab 面板中，后因交互体验不佳拆分为独立面板入口。该文件代码仍保留在仓库中，但 Header 已不再直接链接到它。

### 2.3 QuickSendButtons — 快捷发送按钮

**文件**：`src/features/chat/input/QuickSendButtons.tsx`

**定位**：在输入区域上方提供常用指令的快捷按钮，减少打字操作。

**按钮分类**：

| 分类 | 按钮 | 行为 |
|------|------|------|
| Skill 指令 | `/grill-me`、`/grill-with-docs` | 插入到输入框 |
| 通用指令 | 推荐方案、继续完成、确认执行、你觉得怎么处理？ | 直接发送 |

**设计要点**：
- 500ms 防抖防止重复点击
- Skill 系列按钮通过 `onInsertText` 插入到输入框而非直接发送，让用户可追加内容
- 仅在 session 存在且非 streaming 状态时显示
- 毛玻璃效果 (`backdrop-blur-md`) 融入输入区背景

### 2.4 Windows 右键菜单注册

**文件**：`src-tauri/src/app/mod.rs` 中的 `register_context_menu` 函数

**实现方式**：

- 使用 `reg add` 命令在 `HKCU\Software\Classes` 下注册两个菜单入口：
  - `Directory\shell\OpenCode` — 文件夹右键
  - `Directory\Background\shell\OpenCode` — 文件夹空白处右键
- 菜单标题："用 OpenCode 打开"
- 图标取自应用程序自身的 exe 图标
- 命令格式：`"exe路径" "%1"`（文件夹）/ `"exe路径" "%V"`（空白处）
- 在 `setup()` 中调用，每次启动自动注册

### 2.5 VSCode 打开

**Header 按钮**：
- 通过 `vscode://file/{directory}?windowId=_blank` 协议在新窗口打开当前工作目录
- Windows：使用 `@tauri-apps/plugin-opener` 的 `openUrl`
- Web：降级到 `window.open`

**前置条件**：
- `src-tauri/capabilities/default.json` 添加了 `vscode:` 协议 opener 权限
- 路径中的反斜杠统一替换为正斜杠

### 2.6 音频通知系统

**变更概览**：

- 内置 4 个 WAV 音频文件（`src/assets/audio/`）：会话完成、权限请求、错误、问题
- 首次启动时自动预加载到 IndexedDB（`maybePreloadDefaultCustomSounds`），并切换默认音效为 `'custom'`
- `prewarmAudioContext()` 提前激活 AudioContext 避免 autoplay 策略导致第一条通知无声
- `playBuiltinSound` 改为 async，必须 `await ctx.resume()` 确保振荡器正常播放
- 自定义音频未加载时自动回退到对应内置合成音效

**存储设计**：

```
localStorage:
  opencode:default-custom-sounds-loaded → 标记是否已预加载完成

IndexedDB (via soundStore):
  每类通知 → { soundId: 'custom', customBlob: ArrayBuffer }
```

### 2.7 技能使用统计 (skillUsageStore)

**文件**：`src/store/skillUsageStore.ts`

**数据模型**：

```typescript
class SkillUsageStore {
  usage: Map<string, number>          // 技能名 → 使用次数
  knownSkillNames: Set<string>        // 已知技能名（从 getSkills 注册）
  cachedUsage: Record<string, number> // 缓存快照，供 useSyncExternalStore 读取
}
```

**持久化**：
- `localStorage: opencode-skill-usage` — 使用次数
- `localStorage: opencode-known-skill-names` — 已知技能名列表

**数据采集**：在 `useGlobalEvents` 中监听 `partUpdated` 事件，当 `part.type === 'tool' && part.tool === 'skill'` 时提取 `part.state.input.name` 调用 `recordSkill()`

**消费场景**：
- **SkillPanel**：按使用次数排序 + 显示计数 badge
- **Header**：使用 `useSyncExternalStore` 订阅总使用次数（驱动 Header 重渲染）

### 2.8 Git 提交模型全局配置

**文件**：`src/utils/modelUtils.ts`（`CommitModelSelection` 相关）+ `src/features/settings/components/ModelsSettings.tsx`

**设计**：

- 设置页面新增"Git 提交模型"下拉选择器，从已启用的模型中选取
- 存储结构：`{ modelKey, providerId, modelId }` → `serverStorage`
- `GitChangesPanel` 读取 `getCommitModel()` 获取提交模型，未配置时显示警告
- 当前选择的模型被隐藏时自动清除选择（防止引用无效模型）

### 2.9 SidePanel — 项目工作状态指示

**设计**：当项目有活跃会话（busy session）时，在项目列表项下方显示流动点阵动画（`FlowingDots`）。

**实现**：
- `projectStatusMap`：遍历 `busySessions`，通过 `matchesProjectDirectory` 匹配所属项目
- `FlowingDots` 组件：25 个圆点，CSS `@keyframes dot-flow` 动画，每个点延迟 `i * 0.1s`
- `matchesProjectDirectory`：检查目录是否匹配项目的 `worktree` / `workspaceDirectories` / `memberDirectories`

### 2.10 MCP 健康检查降级方案

**文件**：`src/api/mcp.ts` 中的 `healthCheckMcpStatus`

**问题**：后端 `GET /mcp` 端点不可用（返回 404），无法通过标准 API 获取服务器列表。

**方案**：
1. 先尝试 `getMcpStatus()`（标准 API）
2. 失败后从两个来源合并服务器名：`getConfig().mcp`（配置）+ `localStorage` 注册表（动态添加过的）
3. 对每个服务器名调用 `connectMcpServer()` 探测连通性
4. 构建 `{ name: { status, error } }` 状态映射表

**注册表维护**：
- `addMcpServer` 后调用 `addKnownServer(name)` 更新 localStorage
- `recordMcpServerName` 供 SSE 事件回调使用

---

## 3. 数据流与状态管理

### 3.1 技能使用统计的数据流

```
SSE 事件 → useGlobalEvents.onPartUpdated
  → 识别 tool === 'skill'
  → 提取 part.state.input.name
  → skillUsageStore.recordSkill(name)
    → Map 更新 + localStorage 持久化
    → notify() → useSyncExternalStore 订阅者重渲染

SkillPanel:
  getSkills() → skillUsageStore.registerSkillNames(names)
  → knownSkillNames 持久化（用于区分已知/未知技能）
```

### 3.2 音频通知数据流

```
应用启动
  → initNotificationSound()
    → prewarmAudioContext() (1s 延迟)
    → maybePreloadDefaultCustomSounds()
      → fetch src/assets/audio/*.wav
      → soundStore.uploadCustomAudio(type, file)
      → localStorage 标记完成

通知到达
  → notificationStore.onPush()
  → playNotificationSoundDeduped(type)
    → 读取 soundStore 配置
    → 'custom' 且有 blob → 播放自定义音频
    → 'custom' 无 blob → 回退到内置合成音效
    → 'builtin:*' → playBuiltinSound(id, volume)
```

### 3.3 目录切换时的状态重置

当 `directory` prop 变化时：

```
GitChangesPanel:
  - diffRequestIdRef++ (取消旧请求)
  - 重置 project / diffs / loading / error
  - 重置 openDiffFiles / selectedFile / expandedDirs
  - resetSplitHeight()
  - 重新 loadProjectState()
```

---

## 4. 用户体验改进

### 4.1 侧边栏

- **启动时自动选择最近 session**：`pendingAutoSelectRef` 机制，在 sessions 加载完成后自动选中与当前目录匹配的最近 session
- **移除全局项目**：删除 `globalProject` 概念，"全局"概念不再作为项目选择项
- **编辑模式新增全选按钮**：`CheckSquareIcon` 一键全选/取消全选 session 和项目
- **项目排序**：`addedAt` 降序，不再依赖 `recentProjects` 时间戳

### 4.2 消息显示

- **模型 provider 名称**：`MessageRenderer` 中显示格式为 `{providerName} / {modelID}` 而非仅 `modelID`
- **代码换行快捷键**：支持 `Shift+Enter` 换行，默认发送键改为 `Enter`

### 4.3 启动体验

- **右侧面板默认关闭**：`layoutStore` 恢复时 `rightPanelOpen` 强制设为 `false`，避免后端未就绪时面板加载失败
- **无 messages 时 session 恢复**：修复 session 恢复逻辑，防止空 session 导致的显示异常

### 4.4 错误处理与调试

- **fetchActiveScopeData 详细日志**：各 API 失败时输出 `console.error` 带具体错误信息
- **Rust 后端 npm 路径搜索**：`spawn_opencode_serve` 增强回退机制，自动在 app 目录和 npm 全局目录搜索 opencode 二进制文件
- **MCP 状态 API 空返回处理**：`healthCheckMcpStatus` 中当 `Object.keys(status).length === 0` 时继续走 fallback
- **通知拉取异常处理**：`getSession` 失败时自动 dismiss 对应通知

---

## 5. 技术细节

### 5.1 垂直分割调整 (useVerticalSplitResize)

GitChangesPanel 中使用的拖拽调整 hook：
- 通过 CSS 变量 `--list-height` 控制上方和下方比例
- `requestAnimationFrame` 节流保证 60fps
- 支持鼠标和触摸事件
- `minPrimaryHeight` / `minSecondaryHeight` 最小高度保护

### 5.2 变更树构建算法 (buildChangesTree)

```
输入: FileDiff[]  (扁平列表)
输出: ChangesTreeNode[]  (树结构)

步骤：
1. 逐文件分割路径 → 逐层查找/创建节点
2. 目录节点聚合子节点的 additions/deletions
3. 目录状态从子节点推断（added/modified/deleted）
4. 排序：目录优先，同类型按名称字母序
```

### 5.3 computePatchStats 统一统计口径

通过重新计算 `extractContentFromUnifiedDiff` + `diffLines` 得到增删行数，确保与 `DiffViewer` 渲染的统计一致。

---

## 6. 配置与构建

### 6.1 应用标识

- `tauri.conf.json` 中 `identifier` 从 `com.opencodeui.app` 改为 `com.opencodeui.desktop`

### 6.2 构建脚本

- 新增 `scripts/build.mjs`：tauri build 封装
- 新增 `scripts/dev.mjs`：开发启动脚本

### 6.3 部署

- 新增 `public/.nojekyll` 文件，用于 GitHub Pages 禁用 Jekyll 处理

---

## 附录：变更文件清单

| 操作 | 文件 |
|------|------|
| **新增** | `src/components/GitChangesPanel.tsx` |
| **新增（已废弃）** | `src/components/IntegrationsPanel.tsx`（统一面板已拆分为独立 SkillPanel/McpPanel） |
| **新增** | `src/features/chat/input/QuickSendButtons.tsx` |
| **新增** | `src/store/skillUsageStore.ts` |
| **新增** | `src/assets/audio/*.wav` (4 个) |
| **新增** | `scripts/build.mjs`, `scripts/dev.mjs` |
| **新增** | `public/.nojekyll` |
| **删除** | `docker/`, `docker-compose*.yml`, `src-router/`, `.dockerignore` |
| **删除** | `src/store/changeScopeStore.ts` |
| **删除** | `src/components/SessionChangesPanel.tsx` → 重命名为 `GitChangesPanel.tsx` |
| **重写** | `src-tauri/src/app/mod.rs` (多窗口 → 单窗口) |
| **增强** | `src-tauri/src/app/commands/opencode.rs` (npm 路径搜索) |
| **增强** | `src/api/mcp.ts` (健康检查降级) |
| **增强** | `src/hooks/useGlobalEvents.ts` (技能使用采集) |
| **增强** | `src/utils/notificationSoundBridge.ts` (预加载 + 回退) |
| **增强** | `src/features/chat/Header.tsx` (工具栏按钮重构) |
| **增强** | `src/features/chat/sidebar/SidePanel.tsx` (项目状态/全选/简化) |
| **增强** | `src/features/message/MessageRenderer.tsx` (provider 名称) |
| **增强** | `src/features/settings/components/ModelsSettings.tsx` (提交模型配置) |
| **增强** | `src/utils/modelUtils.ts` (CommitModelSelection) |
| **增强** | `src/utils/diffUtils.ts` (computePatchStats) |
| **增强** | `src/utils/soundPlayer.ts` (prewarmAudioContext) |
| **简化** | `src/hooks/useFileExplorer.ts` (移除 change scope) |
| **清理** | `src/api/session.ts`, `src/store/index.ts`, `src/store/layoutStore.ts` |
