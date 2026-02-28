# Contributing to SuperCmd

Thanks for your interest in contributing to SuperCmd! This guide will help you get started.

## Quick Links

- [Discord](https://discord.gg/CsdbknHqx5) — ask questions, discuss features
- [Issues](https://github.com/SuperCmdLabs/SuperCmd/issues) — report bugs or request features
- [README — Getting Started](./README.md#getting-started) — set up your dev environment

## Development Setup

1. Follow the [Getting Started](./README.md#getting-started) section in the README to clone, install, and run the project.
2. Make sure `npm run build` completes without errors before starting work.

## Project Architecture
```text
src/
├── main/           # Electron main process
│   ├── ipc/        # IPC handlers between main and renderer
│   ├── settings/   # App settings management
│   └── ...
├── renderer/       # React UI (Vite-powered)
│   └── src/
│       ├── raycast-api/   # Raycast API compatibility shims (@raycast/api, @raycast/utils)
│       ├── components/    # React components
│       ├── hooks/         # React hooks
│       └── ...
└── native/         # Swift helpers for macOS-native features
```

### Key principles

- **Raycast compatibility is the priority.** Extensions built for Raycast should work in SuperCmd with minimal or no changes. Before changing anything in `src/renderer/src/raycast-api/`, verify it doesn't break existing extensions.
- **System-level logic lives in `src/main/`.** IPC, settings, file access, and native module bridges belong here.
- **UI code lives in `src/renderer/src/`.** Views, hooks, and components go here.

## Making a Pull Request

### Branch naming

Use descriptive branch names with a prefix:

- `feat/description` — new feature
- `fix/description` — bug fix
- `docs/description` — documentation
- `chore/description` — maintenance, cleanup
- `test/description` — tests

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add clipboard history search
fix: resolve hotkey not registering on Sonoma
docs: update AI setup instructions
chore: remove unused dependencies
test: add unit tests for ai-provider
```

### PR checklist

Before submitting your PR, verify:

- [ ] `npm run build` completes without errors
- [ ] You've tested your changes locally with `npm run dev`
- [ ] Your PR description includes: what changed, why, compatibility impact, and how you tested it
- [ ] If you modified the Raycast API shims, you've tested with at least one existing Raycast extension

### PR size

Keep PRs focused. A single PR should address one concern. If you're working on a large feature, consider breaking it into smaller PRs.

## Working with Extensions

SuperCmd aims for compatibility with [Raycast extensions](https://www.raycast.com/store). When working on the runtime:

- Test against popular extensions (Calculator, Clipboard History, etc.)
- The API shims are in `src/renderer/src/raycast-api/` — check the [Raycast API docs](https://developers.raycast.com/api-reference/) for reference
- If an API is not yet implemented, add a stub that logs a warning rather than throwing

## Reporting Bugs

When opening an issue, include:

- macOS version
- Node.js version (`node -v`)
- SuperCmd version (Settings → About, or check `package.json`)
- Steps to reproduce
- Expected vs actual behavior
- Console logs if available (Cmd+Option+I to open DevTools)

## Code of Conduct

Be respectful. We're all here to build something great together.
