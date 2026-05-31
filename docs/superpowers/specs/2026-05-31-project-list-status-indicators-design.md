# 项目列表状态指示器设计

## 概述

在 OpenCodeUI 侧边栏的项目下拉选择器中，为项目条目添加工作状态和未读通知状态的视觉指示，同时移除全局项目项。

## 改动范围

仅作用于 `SidePanel.tsx` 中的**项目下拉选择器**（`projects.map` 渲染的 dropdown 列表），不涉及 `FolderRecentList`。

## 功能 1：移除全局项目

- **现状**：`projects = [globalProject, ...selectorProjectGroups]`，`globalProject` 始终排在列表第一位
- **改动**：
  - 删除 `globalProject` useMemo 定义
  - `projects` 直接引用 `selectorProjectGroups`
  - `currentProject` 在 `currentDirectory` 为 `undefined` 时返回 `null`
  - 项目选择器标题在无当前目录时显示中性占位文本（如 `"选择项目..."`），图标使用 FolderIcon
  - 无当前目录时，session 列表仍保持跨目录展示（`showDirectory` 模式）
  - 删除所有 `isGlobal`/`project.id === 'global'` 条件分支
  - `handleSelectProject` 不再处理 global 逻辑

## 功能 2：工作中动画 — 点阵流动

- **触发条件**：项目有活跃 session（`activeSessionStore.useBusySessions()` 中任意 session 的 `directory` 匹配该项目）
- **视觉**：
  - 项目名下方一行 12 个圆点
  - 圆点直径 5px，使用主题色（`accent-main-100`）
  - 从左到右循环流动（CSS `@keyframes` + `translateX`）
  - 每点透明度梯度变化形成流动感
  - 纯 CSS 实现，无 JS 定时器

## 功能 3：未读通知状态 — 静态圆点

- **触发条件**：项目有未读 completed 通知（`notificationStore` 中 `type === 'completed' && !read` 的 entry 的 `directory` 匹配该项目）
- **视觉**：
  - 文件夹图标右侧一个静态圆点
  - 直径 5px，主题色（`accent-main-100`）
  - 无动画
  - **与工作动画互斥**：有活跃 session 时显示流动点阵，不显示静态点；有未读通知时显示静态点

## 数据映射

每个项目（`ProjectItem`）通过 `worktree`（目录路径）与 `busySessions`/`notifications` 关联：

```
project.worktree → busySessions[i].directory / notifications[i].directory
```

项目可能有多个 `workspaceDirectories`，任意子目录匹配即视为该项目有状态。

## 状态优先级

1. 有活跃 session → 显示流动点阵（工作动画）
2. 无活跃 session 但有未读通知 → 显示静态圆点
3. 两者都没有 → 不显示任何指示器

## 文件修改清单

- `src/features/chat/sidebar/SidePanel.tsx` — 主要改动
  - 移除 `globalProject`
  - 添加状态计算逻辑
  - 更新项目列表渲染
  - 添加流动点阵动画 CSS（使用 Tailwind 或内联 style）
