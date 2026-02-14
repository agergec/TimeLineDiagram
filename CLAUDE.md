# Claude Code Instructions for TimeLineDiagram

## Frequent Saves - IMPORTANT

To avoid losing work, create checkpoint commits frequently during development sessions:

### When to Create Checkpoints
- **After each working fix** - Once a bug fix is verified working, commit immediately
- **Before major changes** - Commit current state before refactoring or large modifications
- **Every 15-20 minutes** - During active development, make WIP commits regularly
- **When user confirms something works** - If user says "it works" or "good", commit right away

### How to Create Checkpoint Commits
```bash
git add -A && git commit -m "WIP: <brief description of current state>"
```

Examples:
- `WIP: Fix scroll sync - working`
- `WIP: Colorful alignment lines added`
- `WIP: Before refactoring export functions`

### Recovery
If something breaks, use reflog to find and restore a working state:
```bash
git reflog                     # Find the commit hash
git reset --hard <hash>        # Restore to that state
```

### Push Strategy
- Push to remote after completing a logical set of related changes
- Don't push WIP commits - squash them first if needed, or amend before push

## Project Structure

This is a single-page vanilla JavaScript web application for creating timeline diagrams.

Key files:
- `app.js` - Main application logic
- `styles.css` - All styling
- `index.html` - HTML structure
- `help.html` - Help documentation

## V2 Architecture

This project has two versions sharing the same core logic:

### Files
- **V1**: `index.html` + `app.js` + `styles.css`
- **V2**: `index-v2.html` + `app-v2.js` + `styles.css`

### V2 Design Pattern
- `app-v2.js` contains a complete copy of `app.js` (first ~4800 lines)
- V2 compatibility layer starts at line ~4867
- V2 module detects v2 HTML (checks for `#right-sidebar` element)
- When detected, patches core functions to work with new UI

### V2 UI Features
1. **Header Bar**: Logo icon, title input, lock badge indicator
2. **Toolbar**: Grouped controls (File, Export, Tools, Zoom, Settings)
3. **Right Sidebar**: Slide-out panel with 3 tabs (Settings, Lane Properties, Box Properties)
4. **Diagrams Modal**: Modal dialog for diagram management (replaces v1 sidebar panel)
5. **Dark Theme Default**: Dark theme applied at load
6. **Timeline Duration**: User-configurable timeline width (default 8000ms)
7. **Multiline Lane Names**: Div-based display supports multiple lines
8. **Double-Click Lane Editing**: Quick inline editing with textarea

### Patched Functions in V2
- `renderLaneList()` - Complete override using div for lane names with double-click editing
- `renderLanesCanvas()` - Strict timeline duration enforcement
- `renderTimelineRuler()` - Uses settings.timelineDuration
- `renderTimeMarkers()` - Uses settings.timelineDuration
- `showSettingsPanel()` - Opens right sidebar instead of floating panel
- `updatePropertiesPanel()` - Manages right sidebar visibility and content
- `deselectBox()` - Closes sidebar when in box properties mode
- `showLanePropertiesPanel()` - Opens right sidebar in lane properties mode
- `renderDiagramsList()` - Updates diagrams button badge count
- `toggleDiagramsPanel()` - Opens modal instead of sidebar panel
- `updateLockState()` - Updates header lock badge visual state

### Maintenance Notes
- When fixing bugs in `app.js`, check if the same fix is needed in `app-v2.js`
- V2 overrides like `renderLaneList()` are complete re-implementations
- Both versions use the same `styles.css` file
- CSS classes prefixed with `.diagrams-panel` are v1-only (removed in cleanup)
- `.diagram-item` and related classes are shared between v1 and v2
- Future consideration: Extract shared code to eliminate duplication
