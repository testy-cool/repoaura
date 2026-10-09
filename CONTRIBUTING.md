# Contributing to RepoAura

Thank you for contributing to RepoAura! We keep the development loop fast and lean.

## Prerequisites

- Node.js 22+
- Google Chrome or a Chromium-based browser

## Quickstart

1. **Install dependencies:**
   ```bash
   npm ci
   ```

2. **Run tests and build:**
   ```bash
   npm run check
   ```
   This compiles TypeScript, runs the unit and contract suites, builds the public
   package at `.build/chrome-mv3` and the personal package at
   `.build/chrome-mv3-personal`, and checks the package boundaries.

3. **Load in Chrome:**
   - Open `chrome://extensions` in your browser.
   - Toggle **Developer mode** on (top right).
   - Click **Load unpacked** and select the `.build/chrome-mv3` folder.

4. **Watch mode during development:**
   ```bash
   npm run dev
   ```

## Development Principles

- **Zero visual noise:** Injected UI must remain quiet, calm, and readable. We adhere to high-legibility engineering aesthetics—no greebling, decorative clutter, or faux badges.
- **Font size floor:** Injected text must never be smaller than 12px.
- **Contract tests:** Changes to DOM insertion, layout anchoring, or caching must include corresponding tests in `tests/`.
- **Privacy:** RepoAura does not embed telemetry or vendor analytics. Tokens stay in `chrome.storage.local` and may be sent only to `https://api.github.com`.
- **Build separation:** Public builds must exclude archive delivery and encounter collection.
  Use `npm run dev:personal` to work on the personal archive integration.

## Finding Issues

Look for open issues labeled [`good first issue`](https://github.com/testy-cool/repoaura/labels/good%20first%20issue). Feel free to submit a draft PR early to discuss architecture.
