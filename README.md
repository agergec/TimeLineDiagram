# Timeline Diagram Editor

A web-based tool for creating beautiful timeline diagrams to visualize processes, API calls, and sequences.

![Timeline Diagram Editor](https://img.shields.io/badge/Made%20by-UCS-blue)

## Features

### Core Functionality
- **Visual Timeline Creation** - Click and drag to create time boxes on lanes
- **Multiple Lanes** - Organize events by component, service, or actor
- **Drag & Resize** - Move and resize boxes to adjust timing
- **Smart Colors** - Auto-assigned contrasting colors for better readability

### Measurement Tool
- **Cmd/Ctrl + Click** to measure time distances between any two points
- **Smart Snapping** - Automatically snaps to box start/end edges
- **Pin Measurements** - Keep measurements visible with the 📌 button
- **Export Support** - Pinned measurements included in PNG/SVG exports

### Sharing & Export
- **URL Sharing** - Share diagrams instantly via encoded URL
- **PNG Export** - High-quality raster images (2x resolution)
- **SVG Export** - Scalable vector graphics for documentation
- **JSON Save/Load** - Backup and restore diagrams

### Auto-Save
- **Automatic Saving** - Work saved to browser localStorage
- **Diagram Management** - Switch between up to 10 saved diagrams
- **Never Lose Work** - Survives page refresh and browser closure

## Quick Start

1. **Add Lanes** - Click `+ Add` to create lanes for your components
2. **Create Boxes** - Click and drag on any lane to create time boxes
3. **Customize** - Click boxes to edit labels, colors, and timing
4. **Share** - Click `Share` to copy a shareable URL

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl` + Left Click + Drag | Measure time distance |
| `Delete` / `Backspace` | Delete selected box |
| `Escape` | Deselect / Cancel / Close |

## Use Cases

- **API Call Flows** - Visualize request timing between services
- **Process Documentation** - Map business processes and workflows
- **Performance Analysis** - Identify bottlenecks and latency issues
- **System Architecture** - Show sequence of operations in distributed systems

## Tech Stack

- Pure HTML/CSS/JavaScript (no frameworks)
- html2canvas for PNG export
- localStorage for persistence

## Local Development

Simply open `index.html` in a browser, or serve with any static file server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .
```

## Deployment

This project is configured for GitHub Pages. Push to `main` branch to trigger automatic deployment.

## Files

```
├── index.html          # Main application
├── app.js              # Application logic
├── styles.css          # Styling
├── help.html           # Tutorial & documentation
├── test-data.js        # Sample data for testing
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Pages deployment
```

## License

MIT

---

Made by UCS with 💙
