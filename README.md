# AWScreen

AWScreen is a local-first Electron desktop interface for ActivityWatch. ActivityWatch remains the only activity collector and source of recorded activity; AWScreen reads its local REST API and presents summaries, categories, and timelines.

## Requirements

- macOS 12 or later
- Node.js 20 or later and npm
- ActivityWatch running locally, normally at `http://localhost:5600`

Xcode is not required. Electron provides the desktop runtime and app bundling.

## Run

```sh
npm install
npm start
```

On first install, npm may request permission to run Electron's install hook so it can fetch the Electron runtime. Approve `electron` only.

## Build

Create a macOS `.app` bundle:

```sh
npm run build
```

The result is `dist/AWScreen.app`. The script uses a safe temporary build path because this workspace's folder name contains a character electron-builder rejects. Code signing and notarization are not configured yet.

## Features

- Today overview with active tracked time, hourly chart, category totals, and top applications.
- Timeline with window activity and AFK intervals.
- Application and window-title detail views.
- Hierarchical ActivityWatch category editing, App/Title regex testing, and rule persistence to ActivityWatch's native `classes` setting.
- Configurable local server URL, refresh interval, and launch-at-login.
- macOS tray/menu-bar access; closing the window hides AWScreen and leaves background refresh running.
- Always-on-top glance widget, accessible from the tray menu or dashboard toolbar, with visibility remembered across launches.

## Data and privacy

All ActivityWatch requests run in Electron's main process and are restricted to local HTTP loopback addresses. Renderer content receives data through a context-isolated preload API. Preferences are stored in Electron's local user-data directory. AWScreen does not add its own activity tracking, telemetry, cloud service, or external database.

## Development checks

```sh
npm test
npm run build
```

This is an Electron desktop widget window, not a Notification Center WidgetKit extension.
