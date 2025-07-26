# gweld

A minimal SimpleHttpServer/http.server alternative in Node.js with live-reload.

Supports:

- "Smart" live-reloading to trigger when an request file is changed (i.e reload index.html if it uses main.css, and main.css changes)
- ESM-imports client-side
- Video streaming
- Very quick

[Screen recording 2025-07-26 17.57.58.webm](https://github.com/user-attachments/assets/a254a0fc-9840-405d-a6fe-2f44f39d19ec)

# Install

```
npm install -g @eeue56/gweld
```

# Usage

```
gweld <folder> [PORT]
```

or via npx

```
npx @eeue56/gweld <folder> [PORT]
```

# What

Intended for when working with pure client-side applications.

- Serve .html files with live refresh (if any files in the dir change, reload)
- Serve other files as normal chunked files
- Uses brotili by default
- Uses only Node stdlib

# Why

- `python3 -m http.server` doesn't have a live reload
- All the Node alternatives import like a thousand libraries
- I don't like adding dependencies that aren't needed to provide some core functionality

# Name

Gweld is the Welsh for "watch". Gweld is part of the [Hiraeth collection](https://github.com/eeue56/hiraeth).

```

```
