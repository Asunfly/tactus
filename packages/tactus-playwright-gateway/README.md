# tactus-playwright-gateway

Local gateway wrapper used by Tactus to run `@playwright/mcp` against the built-in browser bridge.

## What it does

- Starts the local HTTP MCP service used by Tactus
- Starts an internal CDP relay on a separate WebSocket port
- Lets the Tactus extension own tab binding, debugger lifecycle, and target switching

## What it does not do

- It does not replace the Tactus extension
- It does not require the official Playwright browser bridge extension
- It is not intended to be launched inside the browser

## Current model

- The local gateway process is started manually by the user
- The browser debugger session is attached on demand by Tactus
- Idle debugger sessions are detached automatically
- New tabs and target switching are coordinated through the internal relay runtime
