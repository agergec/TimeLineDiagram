# Timeline Diagram Editor & SIP Log Parser

A web-based toolkit for creating timeline diagrams and analyzing Genesys SIP call flows.

![Made by UCS](https://img.shields.io/badge/Made%20by-UCS-blue)
![Version](https://img.shields.io/badge/version-2.1.0-6366f1)

---

## Timeline Diagram Editor

Visual tool for creating timeline diagrams to map processes, API calls, and sequences.

### Features

- **Visual Timeline Creation** - Click and drag to create time boxes on lanes
- **Multiple Lanes** - Organize events by component, service, or actor
- **Drag & Resize** - Move and resize boxes to adjust timing
- **Right Sidebar** - Properties panel for settings, lane, and box editing
- **Dark/Light Theme** - Toggle with persistent preference
- **Measurement Tool** - Cmd/Ctrl + Click to measure time distances with snapping
- **Pin Measurements** - Keep measurements visible in the toolbar bar, included in exports
- **SVG Alignment Overlay** - Colored per-lane dashed lines at box start/end times
- **Gap Compression** - Compress empty gaps to focus on activity periods
- **Compact View** - Hide lane labels to maximize canvas space
- **Minimap** - Draggable overview for navigating large diagrams
- **Zoom** - 1% to 666,666% with click-to-reset zoom label
- **Diagrams Modal** - Manage up to 10 auto-saved diagrams
- **Sharing & Export** - URL sharing, PNG (2x), SVG, and JSON save/load
- **Click-Outside-Close** - Sidebar and modals close on outside click

### Quick Start

1. **Add Lanes** - Click `+ Add` in the toolbar
2. **Create Boxes** - Click and drag on any lane track
3. **Customize** - Click boxes to edit labels, colors, and timing in the right sidebar
4. **Share** - Click `Share` to copy a shareable URL

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl` + Click + Drag | Measure time distance |
| `Delete` / `Backspace` | Delete selected box |
| `Escape` | Deselect / Cancel / Close sidebar |

---

## SIP Log Parser

Parses **Genesys SIP Span Quick Flow** output and displays SIP messages, Events, and Requests in an interactive grid with timing analysis.

### Views

- **SIP Span** - All messages in chronological order with full detail columns
- **Kazimir** - Events & Requests arranged in a grid by Device Number (DN)

### Filtering & Analysis

- **Type Filters** - Toggle SIP, Events, Requests independently
- **CID Tags** - Enable/disable individual Call IDs with color-coded tags
- **Delta Modes** - Per-CID, Cross-CID (across filtered CIDs), or Both
- **Speed Dots** - Visual latency indicators (1 green < 100ms, 2 amber < 500ms, 3 red >= 500ms)
- **Elapsed Column** - Milliseconds since first message

### Bookmarking

- **Click rows** to bookmark them and see step/cumulative time deltas
- **Per-view bookmarks** - SIP Span and Kazimir maintain separate selections
- **Auto-persist** - Bookmarks save automatically with the log file

### File Management

- **Save/Load** - Up to 20 logs in browser storage with duplicate prevention
- **Auto-load** - Single saved log loads automatically on page open
- **Export** - Extract INVITE-ACK pairs to create Timeline Diagrams

### Other

- **Dark/Light theme** with persistent preference
- **In-app help** (? button) with full feature reference
- **Esc** closes any modal

---

## Tech Stack

- Pure HTML/CSS/JavaScript (no frameworks)
- html2canvas for PNG export
- localStorage for persistence

## Local Development

Open `index.html` in a browser, or serve with any static file server:

```bash
python -m http.server 8000
# or
npx serve .
```

## Deployment

GitHub Pages - push to `main` to trigger automatic deployment.

## JSON Format

Diagram JSON structure, defaults, and import compatibility examples are documented in:

- `JSON_FORMAT.md`

## Files

```
├── index.html          # Timeline Diagram Editor
├── app.js              # Editor logic
├── JSON_FORMAT.md      # Diagram JSON schema, defaults, and examples
├── styles.css          # Editor styling
├── help.html           # Editor help & tutorial
├── sip-parser.html     # SIP Log Parser (HTML + CSS)
├── sip-parser.js       # SIP Log Parser (JS)
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Pages deployment
```

## License

MIT

---

Made by UCS
