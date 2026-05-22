# OpenChad 

![banner.png](https://raw.githubusercontent.com/openchad/docs/refs/heads/main/public/banner.png)

OpenChad enables you to build AI-driven applications with a customizable tool that accessible across the frontend, AI inference pipeline, and MCP clients.

---

[![nodejs]][nodejs#link] [![requires-python]][requires-python#link] [![Discord]][Discord#link]


[Discord]: https://img.shields.io/discord/1505493160623607820?logo=discord&label=discord
[Discord#link]: https://discord.gg/JWeqhecqBD'
[nodejs]: https://img.shields.io/badge/node.js-%3E%3Dv22.14.0-6DA55F?logo=nodedotjs&logoColor=white
[nodejs#link]: https://nodejs.org/en/about/previous-releases
[requires-python]: https://img.shields.io/python/required-version-toml?tomlFilePath=https%3A%2F%2Fraw.githubusercontent.com%2Fopenchad%2Fopenchadpy%2Frefs%2Fheads%2Fmain%2Fpyproject.toml&logo=python
[requires-python#link]: https://packaging.python.org/en/latest/specifications/core-metadata/#requires-python
---

## Quick Start


```sh
npm create openchad@latest
```

### Start the development

```sh
cd my-app
npm run dev
```

<img src="https://raw.githubusercontent.com/openchad/docs/refs/heads/main/public/preview.png" width="100%" />

## Your main workspace 
```
my-app/
├── Tools/ <-- python backend
└── src/ <-- frontend
```
---

Documentation: <http://openchad.github.com/docs/customization/custom-app.html>

Source Code: <https://github.com/openchad/openchad>

## Features

It ships with a built-in Tab Management System, AI Chatbot, Multiview Layout System, bidirectional frontend-backend communication layer. and MCP integration allows you to compose external MCP servers into your application or optionally expose your own tools as an MCP-compliant endpoint consumable by any MCP client.

### Tool being called by Claude Desktop as `MCP Client`
<img src="https://raw.githubusercontent.com/openchad/docs/refs/heads/main/public/mcp_client_preview.png" width="100%" />

### Multiview - Dock multiple apps inside a single tab
<img src="https://raw.githubusercontent.com/openchad/docs/refs/heads/main/public/multiview_preview.png" width="100%" />