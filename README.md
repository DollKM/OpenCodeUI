# OpenCodeUI

中文 | [English](./README_EN.md)

一个为 [OpenCode](https://github.com/anomalyco/opencode) 打造的第三方 Web 前端界面。

**本项目完全由 AI 辅助编程（Vibe Coding）完成**——从第一行代码到最终发布，所有功能均通过与 AI 对话驱动开发。

> **免责声明**：本项目仅供学习交流使用，不对因使用本项目导致的任何问题承担责任。项目处于早期阶段，可能存在 bug 和不稳定之处。

## 预览

<img width="2298" height="1495" alt="image" src="https://github.com/user-attachments/assets/dc68837b-0560-4701-b6ab-ecb13fdc1f4f" />
<img width="2296" height="1500" alt="image" src="https://github.com/user-attachments/assets/7a8d9754-69c4-49c5-99ee-6452d94f5420" />
<img width="411" height="906" alt="image" src="https://github.com/user-attachments/assets/0cfbf8b2-3fed-4e3c-8b49-1175c6e12f54" />
## 特性

- **完整的 Chat 界面** — 消息流、Markdown 渲染、代码高亮（Shiki）
- **内置终端** — 基于 xterm.js 的 Web 终端，支持 WebGL 渲染
- **文件浏览与 Diff** — 查看工作区文件、多文件 diff 对比
- **主题系统** — 3 套内置主题（Eucalyptus / Claude / Breeze），支持明暗模式切换和自定义 CSS
- **PWA 支持** — 可安装为桌面/移动端应用
- **移动端适配** — 安全区域、触摸优化、响应式布局
- **浏览器通知** — AI 回复完成时推送通知
- **@ 提及与 / 斜杠命令** — 对话中快速引用文件和执行命令
- **自定义快捷键** — 可配置的键位绑定
- **桌面应用** — 基于 Tauri 的原生客户端（macOS / Linux / Windows）

## 技术栈

| 类别     | 技术                           |
| -------- | ------------------------------ |
| 框架     | React 19 + TypeScript          |
| 构建     | Vite 7                         |
| 样式     | Tailwind CSS v4                |
| 代码高亮 | Shiki                          |
| 终端     | xterm.js (WebGL)               |
| Markdown | react-markdown + remark-gfm    |
| 桌面     | Tauri 2                        |
| 部署     | 静态文件 / Nginx / Caddy |

## 快速体验

无需部署，在本地启动 OpenCode 后端后直接访问托管版前端：

```bash
opencode serve --cors "https://lehhair.github.io"
```

然后打开 https://lehhair.github.io/OpenCodeUI/

## 本地开发

需要一个运行中的 [OpenCode](https://github.com/anomalyco/opencode) 后端。

```bash
opencode serve

# 另一个终端
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI
npm install
npm run dev
```

Vite 启动在 `http://localhost:5173`，`/api` 自动代理到 `http://127.0.0.1:4096`。

### 提交前校验

提交 PR 前，建议先在本地跑一遍和 CI 相同的校验：

```bash
npm run validate
```

这条命令会顺序执行 TypeScript 检查、ESLint、单元测试和生产构建。

如果你习惯 `type-check` 这个命名，也可以使用：

```bash
npm run type-check
```

GitHub Actions 的 `Build Validation` workflow 会在 PR 和 `main` 分支 push 时运行同一套校验。

### 发版准备

正式发版时，优先使用下面这条命令，它会先跑完整校验，再执行版本号和 changelog 更新：

```bash
npm run release:prepare -- 0.2.0
```

命令完成后，再按提示执行 `git commit`、`git tag` 和 `git push`。

## 桌面应用

从 [Releases](https://github.com/lehhair/OpenCodeUI/releases) 下载安装包，或本地构建：

```bash
npm install
npm run tauri build
```

## 项目结构

```
src/
├── api/                 # API 请求封装
├── components/          # 通用组件（Terminal、DiffView 等）
├── features/            # 业务模块
│   ├── chat/            #   聊天界面
│   ├── message/         #   消息渲染
│   ├── sessions/        #   会话管理
│   ├── settings/        #   设置面板
│   ├── mention/         #   @ 提及
│   └── slash-command/   #   斜杠命令
├── hooks/               # 自定义 Hooks
├── store/               # 状态管理
├── themes/              # 主题预设
└── utils/               # 工具函数

src-tauri/               # Tauri 桌面应用（Rust）
```

## 设计说明

部分 UI 风格参考了 [Claude](https://claude.ai) 的界面设计。

## 许可证

[GPL-3.0](./LICENSE)

## Star History

<a href="https://www.star-history.com/#lehhair/OpenCodeUI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=lehhair/OpenCodeUI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=lehhair/OpenCodeUI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=lehhair/OpenCodeUI&type=Date" />
 </picture>
</a>

---

_本项目由 Vibe Coding 驱动开发，如果你也对 AI 辅助编程感兴趣，欢迎交流。_
