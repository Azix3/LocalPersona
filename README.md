# LocalPersona

A Windows-friendly Electron app for local character chat with Ollama.

## What it does

- Installs Ollama automatically on first launch when it is missing.
- Starts or reconnects to the local Ollama API at `http://127.0.0.1:11434`.
- Browses local models and the public Ollama model library.
- Pulls models into the user's local Ollama installation.
- Provides a character browser, character creator, and persistent chat sessions.
- Supports global and per-character user names that are passed into the hidden prompt.
- Switches between saved chats with Alt+Up and Alt+Down.
- Imports and exports the local character/session workspace as JSON.
- Checks GitHub Releases for app updates once on launch, with a manual `check for update` button.
- Keeps installer and portable updates separate: installed builds use the setup installer metadata, and portable builds download the matching portable executable.

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

## Build an exe

```powershell
npm.cmd run dist
```

The Windows installer and portable executable are written to `release/`.

## Publish updates

Create a GitHub Release in `Azix3/LocalPersona` and upload:

- `release/LocalPersona-Setup-<version>-x64.exe`
- `release/LocalPersona-Setup-<version>-x64.exe.blockmap`
- `release/LocalPersona-Portable-<version>-x64.exe`
- `release/latest.yml`
