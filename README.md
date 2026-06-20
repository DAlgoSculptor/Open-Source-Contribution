# Open-Source-Contribution

A transparent Electron overlay for live interview assistance. It listens to questions via your microphone, transcribes them with OpenAI Whisper, and generates resume-aware answers with GPT — all in a frameless overlay that stays on top and is hidden from screen sharing.

## Features

- Transparent, always-on-top overlay window
- Hidden from screen capture (`setContentProtection`)
- Microphone recording with Spacebar or mic button
- OpenAI Whisper transcription + GPT answers tailored to your resume
- Click-through overlay mode during interviews
- Global shortcut: **Ctrl+Shift+O** to show/hide the overlay
- Saves API key and resume locally between sessions

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- An [OpenAI API key](https://platform.openai.com/api-keys) with access to Whisper and chat models

## Run locally

```bash
npm install
npm start
```

## Build installers

```bash
# Windows (.exe installer in dist/)
npm run build:win

# macOS (.dmg in dist/)
npm run build:mac

# Linux (AppImage in dist/)
npm run build:linux
```

## Deploy via GitHub Actions

This repo includes CI that builds the Windows installer on every push to `main` and on manual trigger.

1. Push your changes to GitHub:
   ```bash
   git add .
   git commit -m "Your message"
   git push origin main
   ```

2. Open **Actions** → **Build Windows EXE** → download the `windows-installer` artifact.

To publish a GitHub Release with the installer attached, push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow will build the Windows installer and attach it to the release automatically.

## Usage

1. Launch the app.
2. Paste your resume and enter your OpenAI API key.
3. Click **Start Interview** — the overlay becomes click-through.
4. Press **Spacebar** (or the mic button) to record a question, then release to get an answer.
5. Click **Stop** to end the interview and restore normal controls.
6. Use **Ctrl+Shift+O** anytime to show or hide the overlay.

## Notes

- Your API key is stored in local app storage on your machine only.
- Screen-sharing protection works on most platforms but may vary by OS and conferencing app.
- Microphone permission is requested when you start an interview.
