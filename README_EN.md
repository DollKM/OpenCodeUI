# OpenCodeUI

[中文](./README.md) | English

A third-party Web frontend for [OpenCode](https://github.com/anomalyco/opencode).

**This project is entirely built with AI-assisted programming (Vibe Coding)** — from the first line of code to the final release, all features were developed through conversations with AI.

> **Disclaimer**: This project is for learning and communication purposes only. We are not responsible for any issues arising from the use of this project. The project is in its early stages and may contain bugs and instabilities.

## Preview

<img width="2298" height="1495" alt="image" src="https://github.com/user-attachments/assets/dc68837b-0560-4701-b6ab-ecb13fdc1f4f" />
<img width="2296" height="1500" alt="image" src="https://github.com/user-attachments/assets/7a8d9754-69c4-49c5-99ee-6452d94f5420" />

## Features

- **Full Chat Interface** — Message streaming, Markdown rendering, code highlighting (Shiki)
- **Built-in Terminal** — Web terminal based on xterm.js with WebGL rendering
- **File Browsing & Diff** — Browse workspace files, multi-file diff comparison
- **Theme System** — 3 built-in themes (Eucalyptus / Claude / Breeze), light/dark mode toggle and custom CSS
- **PWA Support** — Installable as a desktop/mobile app
- **Mobile Friendly** — Safe area handling, touch optimization, responsive layout
- **Browser Notifications** — Push notifications when AI replies are complete
- **@ Mentions & / Slash Commands** — Quickly reference files and execute commands in conversations
- **Custom Shortcuts** — Configurable key bindings
- **Desktop App** — Native client based on Tauri (macOS / Linux / Windows)

## Tech Stack

| Category          | Technology                     |
| ----------------- | ------------------------------ |
| Framework         | React 19 + TypeScript          |
| Build             | Vite 7                         |
| Styling           | Tailwind CSS v4                |
| Code Highlighting | Shiki                          |
| Terminal          | xterm.js (WebGL)               |
| Markdown          | react-markdown + remark-gfm    |
| Desktop           | Tauri 2                        |
| Deployment        | Static Files / Nginx / Caddy |

## Quick Start

No deployment needed — after starting the OpenCode backend locally, access the hosted frontend directly:

```bash
opencode serve --cors "https://lehhair.github.io"
```

Then open https://lehhair.github.io/OpenCodeUI/

## Local Development

Requires a running [OpenCode](https://github.com/anomalyco/opencode) backend.

```bash
opencode serve

# In another terminal
git clone https://github.com/lehhair/OpenCodeUI.git
cd OpenCodeUI
npm install
npm run dev
```

Vite starts at `http://localhost:5173`, `/api` is automatically proxied to `http://127.0.0.1:4096`.

### Pre-PR Validation

Before opening a PR, run the same validation steps locally that CI uses:

```bash
npm run validate
```

This command runs TypeScript validation, ESLint, unit tests, and a production build in sequence.

If you prefer the hyphenated name, this alias is also available:

```bash
npm run type-check
```

GitHub Actions runs the same checks in the `Build Validation` workflow for every PR and every push to `main`.

### Release Preparation

For a real release, prefer the command below. It runs the full validation suite first, then updates versions and the changelog:

```bash
npm run release:prepare -- 0.2.0
```

After it finishes, follow the printed `git commit`, `git tag`, and `git push` steps.

## Desktop App

Download the installer from [Releases](https://github.com/lehhair/OpenCodeUI/releases), or build locally:

```bash
npm install
npm run tauri build
```

## Project Structure

```
src/
├── api/                 # API request wrappers
├── components/          # Common components (Terminal, DiffView, etc.)
├── features/            # Business modules
│   ├── chat/            #   Chat interface
│   ├── message/         #   Message rendering
│   ├── sessions/        #   Session management
│   ├── settings/        #   Settings panel
│   ├── mention/         #   @ mentions
│   └── slash-command/   #   Slash commands
├── hooks/               # Custom Hooks
├── store/               # State management
├── themes/              # Theme presets
└── utils/               # Utility functions

src-tauri/               # Tauri desktop app (Rust)
```

## Design Notes

Some UI styles are inspired by the [Claude](https://claude.ai) interface design.

## License

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

_This project is driven by Vibe Coding. If you're also interested in AI-assisted programming, feel free to connect._
