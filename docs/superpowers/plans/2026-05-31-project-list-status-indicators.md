# 项目列表状态指示器 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从 SidePanel 项目下拉选择器中移除全局项目，为有活跃会话的项目添加点阵流动动画，为有未读通知的项目添加静态圆点

**架构：** 仅修改 `SidePanel.tsx` 一个文件，通过 `useMemo` 计算项目状态映射，用 CSS keyframes 实现点阵流动动画

**技术栈：** React + TypeScript + Tailwind CSS

---

### 任务 1：移除全局项目

**文件：**
- 修改：`src/features/chat/sidebar/SidePanel.tsx`

- [ ] **步骤 1：移除 `GlobeIcon` 导入**

```typescript
// 删除 GlobeIcon 从导入行
import {
  SidebarIcon,
  FolderIcon,
  // GlobeIcon,  ← 删除
  PlusIcon,
  TrashIcon,
  // ...
} from '../../../components/Icons'
```

- [ ] **步骤 2：删除 `globalProject` 常量**

```typescript
// 删除整个 globalProject useMemo（原 lines 475-482）
const globalProject = useMemo<ProjectItem>(
  () => ({
    id: 'global',
    worktree: t('sidebar.allProjects'),
    name: t('sidebar.global'),
  }),
  [t],
)
```

- [ ] **步骤 3：更新 `projects` 不再包含 global**

```typescript
// 从：return [globalProject, ...selectorProjectGroups]
// 改为：
const projects = useMemo<ProjectItem[]>(() => {
  return selectorProjectGroups
}, [selectorProjectGroups])
```

- [ ] **步骤 4：更新 `currentProject` 返回 `null` 而非 `globalProject`**

```typescript
// 类型改为 ProjectItem | null
const currentProject = useMemo<ProjectItem | null>(() => {
  if (!currentDirectory) return null
  // ... 其余逻辑不变
}, [currentDirectory, folderProjectGroups, gitWorkspaceCatalog, normalizedCurrentDirectory])
```

- [ ] **步骤 5：更新 `currentProjectLabel` 处理 null**

```typescript
// 在 options 中添加 'sessions' namespace 以使用 sessions.noProject 
const currentProjectLabel = useMemo(() => {
  if (!currentProject) return t('sessions.noProject') || '选择项目...'
  // ... 其余不变
}, [
  currentProject,
  currentDirectoryVcsInfo?.branch,
  isCurrentDirectoryVcsLoading,
  t,
])
```

- [ ] **步骤 6：修复 `currentProjectWorkspaceDirectories` null 安全**

```typescript
// 改为可选链
const currentProjectWorkspaceDirectories = useMemo(
  () => currentProject?.workspaceDirectories ?? [],
  [currentProject?.workspaceDirectories],
)
```

- [ ] **步骤 7：修复 `shouldRenderWorkspaceTreeOnly` null 安全**

```typescript
const shouldRenderWorkspaceTreeOnly =
  !search &&
  currentProject != null &&
  currentProjectWorkspaceDirectories.length > 1 &&
  // 不再需要 !== 'global'
  true
```

- [ ] **步骤 8：修复 `currentProjectTreeProjects` null 安全**

```typescript
const currentProjectTreeProjects = useMemo<ProjectItem[]>(() => {
  // 条件改为 currentProject == null
  if (!shouldRenderWorkspaceTreeOnly || currentProject == null) return []
  // ... 其余不变
}, [currentProject, currentProjectWorkspaceDirectories, shouldRenderWorkspaceTreeOnly])
```

- [ ] **步骤 9：更新 `project` 下拉列表渲染，移除 `isGlobal` 分支**

在项目下拉列表的 `projects.map` 循环中（原 lines 947-953）：
```typescript
// 原：
const isGlobal = project.id === 'global'
const isActive = currentProject?.id === project.id
// 改为：
const isActive = currentProject?.id === project.id

// 原 GlobeIcon 条件（line 973）：
{isGlobal ? <GlobeIcon size={14} className="text-accent-main-100" /> : <FolderIcon size={14} />}
// 改为永远使用 FolderIcon：
<FolderIcon size={14} />

// 原 path 显示（line 987-989）：
{isGlobal ? t('sidebar.globalProjectHint') : project.worktree ? getParentPath(project.worktree) : ''}
// 改为：
{project.worktree ? getParentPath(project.worktree) : ''}

// 原删除按钮条件（line 992-1005）：
{!isGlobal && (...)}
// 改为移除条件，永远显示删除按钮：
{(...)}

// 原项目名优先级（line 950-953）：
const itemLabel =
  isActive && !isGlobal
    ? currentProjectLabel
    : project.name || (isGlobal ? t('sidebar.global') : project.worktree)
// 改为：
const itemLabel =
  isActive
    ? currentProjectLabel
    : project.name || project.worktree
```

- [ ] **步骤 10：更新项目选择触发按钮，移除 global 图标**

在 SidePanel header 区域（原 lines 906-928）：
```typescript
// 原：
{currentProject?.id === 'global' ? (
  <GlobeIcon size={16} className="text-accent-main-100" />
) : (
  <FolderIcon size={16} />
)}
// 改为：
{currentProject != null ? (
  <FolderIcon size={16} />
) : (
  <FolderIcon size={16} className="text-text-400" />
)}
```

- [ ] **步骤 11：移除 `handleSelectProject` 中的 global 分支**

```typescript
// 原：
const handleSelectProject = useCallback(
  (projectId: string) => {
    if (projectId === 'global') {
      setCurrentDirectory(undefined)
    } else {
      setCurrentDirectory(projectId)
      pendingAutoSelectRef.current = true
    }
  },
  [setCurrentDirectory],
)
// 改为：
const handleSelectProject = useCallback(
  (projectId: string) => {
    setCurrentDirectory(projectId)
    pendingAutoSelectRef.current = true
  },
  [setCurrentDirectory],
)
```

- [ ] **步骤 12：更新 `handleSelect` 不再处理 global 模式**

```typescript
// 原：
const handleSelect = useCallback(
  (session: ApiSession) => {
    if (!currentDirectory && session.directory) {
      addDirectory(session.directory)
    }
    // ...
  },
  [currentDirectory, addDirectory, onSelectSession, onCloseMobile],
)
// 当没有 currentDirectory 时（global 模式移除后），这种行为已经不存在。
// 当前目录始终有值，所以 if (!currentDirectory) 分支永远不会触发。
// 可以删除这个分支，或者保持兼容：
const handleSelect = useCallback(
  (session: ApiSession) => {
    onSelectSession(session)
    if (window.innerWidth < 768 && onCloseMobile) {
      onCloseMobile()
    }
  },
  [onSelectSession, onCloseMobile],
)
```

- [ ] **步骤 13：移除 `t('sidebar.global')` 相关的翻译引用**（代码中已无 "global" 相关路径引用）

---

### 任务 2：添加项目状态计算逻辑

**文件：**
- 修改：`src/features/chat/sidebar/SidePanel.tsx`

- [ ] **步骤 1：添加 `ProjectStatus` 类型和计算函数**

在组件内添加状态计算使用的工具函数（可在 `buildProjectGroups` 附近或下方）：

```typescript
type ProjectStatus = 'working' | 'notification'
```

- [ ] **步骤 2：添加 `buildProjectStatusMap` 函数**

使用 `useMemo` 计算下拉列表中每个项目的状态：

```typescript
const projectStatusMap = useMemo(() => {
  const map = new Map<string, ProjectStatus>()

  // 1. 先标记有活跃 session 的项目为 'working'
  for (const entry of busySessions) {
    for (const project of selectorProjectGroups) {
      if (matchesProjectDirectory(entry.directory, project)) {
        map.set(project.id, 'working')
      }
    }
  }

  // 2. 再标记有未读通知且不在工作中的项目为 'notification'
  for (const notif of notifications) {
    if (notif.read || notif.type !== 'completed') continue
    for (const project of selectorProjectGroups) {
      if (map.get(project.id) === 'working') continue // 工作中的不覆盖
      if (matchesProjectDirectory(notif.directory, project)) {
        if (!map.has(project.id)) {
          map.set(project.id, 'notification')
        }
      }
    }
  }

  return map
}, [busySessions, notifications, selectorProjectGroups])
```

- [ ] **步骤 3：添加 `matchesProjectDirectory` 工具函数**

```typescript
function matchesProjectDirectory(directory: string | undefined, project: ProjectItem): boolean {
  if (!directory) return false
  if (isSameDirectory(project.worktree, directory)) return true
  if (project.workspaceDirectories?.some(wd => isSameDirectory(wd, directory))) return true
  if (project.memberDirectories?.some(md => isSameDirectory(md, directory))) return true
  return false
}
```

---

### 任务 3：添加流动点阵动画 + 未读通知静态圆点

**文件：**
- 修改：`src/features/chat/sidebar/SidePanel.tsx`

- [ ] **步骤 1：添加流动点阵 CSS @keyframes**

在组件函数顶部添加 `<style>` 标签注入（放在 return 之前，JSX 的某个位置）：

```typescript
const flowDotsStyleId = 'project-flow-dots-animation'

// 在组件内添加 style 注入（或使用 useEffect 注入）
useEffect(() => {
  if (document.getElementById(flowDotsStyleId)) return
  const style = document.createElement('style')
  style.id = flowDotsStyleId
  style.textContent = `
    @keyframes dot-flow {
      0%, 100% { opacity: 0.15; transform: scale(0.5); }
      50% { opacity: 1; transform: scale(1); }
    }
  `
  document.head.appendChild(style)
  return () => {
    const el = document.getElementById(flowDotsStyleId)
    if (el) el.remove()
  }
}, [])
```

- [ ] **步骤 2：添加 `FlowingDots` 子组件**

在文件末尾（`SidePanel` 组件外部或内部）添加流动点阵渲染组件：

```typescript
const DOT_COUNT = 12
const DOT_SIZE = 5 // px
const DOT_SPACING = 8 // px between dot centers

function FlowingDots({ colorClass = 'bg-accent-main-100' }: { colorClass?: string }) {
  const dots = useMemo(() => {
    return Array.from({ length: DOT_COUNT }, (_, i) => ({
      delay: `${i * 0.1}s`,
    }))
  }, [])

  return (
    <div className="flex items-center h-3 ml-1" style={{ gap: `${DOT_SPACING - DOT_SIZE}px` }}>
      {dots.map((dot, i) => (
        <span
          key={i}
          className={`rounded-full ${colorClass}`}
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            animation: 'dot-flow 1.2s ease-in-out infinite',
            animationDelay: dot.delay,
          }}
        />
      ))}
    </div>
  )
}
```

- [ ] **步骤 3：更新项目下拉列表的渲染，加入状态指示器**

在 `projects.map` 循环中的项目名下方加入状态指示：

```typescript
// 获取当前项目的状态
const projectStatus = projectStatusMap.get(project.id)

// 在项目名下方增加状态指示行（在 FolderIcon + name 区域的后面）
// 原渲染：一行显示图标 + 名称 + 路径 + 删除按钮
// 改为：两行结构

// 在按钮内容区域增加：
<div className="flex-1 min-w-0 text-left">
  {/* 第一行：名称 */}
  <div className="text-left text-[length:var(--fs-sm)]">
    <div className="overflow-hidden whitespace-nowrap text-left"
      style={{
        WebkitMaskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
        maskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
      }}
    >
      {itemLabel}
    </div>
  </div>
  {/* 第二行：路径 + 状态指示器 */}
  <div className="flex items-center gap-1">
    <span className="text-[length:var(--fs-xxs)] text-text-400 truncate opacity-70 font-mono">
      {project.worktree ? getParentPath(project.worktree) : ''}
    </span>
    {/* 工作中动画 */}
    {projectStatus === 'working' && (
      <FlowingDots />
    )}
    {/* 未读通知静态圆点 */}
    {projectStatus === 'notification' && (
      <span className="w-[5px] h-[5px] rounded-full bg-accent-main-100 shrink-0" />
    )}
  </div>
</div>
```

- [ ] **步骤 4：更新 `GlobeIcon` 替换逻辑**

确认所有 `GlobeIcon` 引用已从 SidePanel.tsx 中移除，如果不再使用则删除导入。

- [ ] **步骤 5：确认翻译字符串**

检查 `t('sidebar.global')`、`t('sidebar.allProjects')`、`t('sidebar.globalProjectHint')` 在 SidePanel.tsx 中是否已无引用。如有需要，将 `currentProjectLabel` 的 fallback 改为硬编码字符串或使用 `t('sessions.noProject')`。

---

### 验证步骤

- [ ] **步骤 1：TypeScript 编译检查**

```bash
npx tsc --noEmit
```
预期：无类型错误

- [ ] **步骤 2：运行测试**

```bash
npx vitest run
```
预期：所有测试通过（仅修改 SidePanel.tsx，相关测试应保持通过）
