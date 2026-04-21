# LEARN

This document tracks key learnings about the Termix project for new contributors.

## What this project is

Termix is an Electron-based terminal and SSH client with support for:
- SSH connections
- SFTP file operations
- Port forwarding
- Serial port access
- Profiles and settings management

## High-level structure

- `index.js`: Electron main process entrypoint
- `commands/`: IPC command handlers grouped by feature
- `public/modules/`: Frontend modules and views
- `util/`: Shared utilities (connections, profiles, crypto, updater, etc.)
- `website/`: Project website assets and preview server

## Development notes

- Install dependencies: `npm install`
- Run app locally: `npm start`
- Build app: `npm run build`

## Important considerations

- Keep changes small and feature-focused.
- Reuse existing command and utility patterns.
- Avoid introducing breaking changes in IPC interfaces.
