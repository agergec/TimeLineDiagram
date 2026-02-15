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

Single-page vanilla JavaScript web applications. No frameworks, no build step.

### Files
- `index.html` - Timeline Diagram Editor (HTML)
- `app.js` - Editor logic (v2.0.0, ~7100 lines)
- `styles.css` - Editor styling
- `help.html` - Help documentation
- `sip-parser.html` - SIP Log Parser (HTML + inline CSS)
- `sip-parser.js` - SIP Log Parser logic (v2.0.0)
- `_archive/` - Historical backups (not tracked by git)

### Key Constants
- `APP_VERSION` in `app.js` line 5
- `SIP_PARSER_VERSION` in `sip-parser.js` line 3
- `.gitignore` uses whitelist pattern (must `!filename` to track new files)
- localStorage keys: `timeline_diagrams`, `sip_saved_logs`, `sip_parser_theme`

## app.js Architecture

The file has three layers:

### Layer 1: Core Logic (lines 1–4932)
Original application code: data model, rendering, event handling, export, auto-save, compression, measurement, minimap. All functions are global.

### Layer 2: V2 Object (lines 4933–5476)
The `V2` singleton detects the V2 HTML layout (`#right-sidebar` element) and patches core functions to work with the new UI: right sidebar, diagrams modal, theme toggle, timeline duration setting, click-to-activate lane controls.

Key method: `V2.patchFunctions()` (line ~5243) overrides:
- `showSettingsPanel` → opens right sidebar
- `updatePropertiesPanel` → manages sidebar visibility
- `deselectBox` → closes sidebar
- `showLanePropertiesPanel` → sidebar lane mode
- `renderDiagramsList` → badge count
- `toggleDiagramsPanel` → modal
- `updateLockState` → header badge

### Layer 3: IIFE Refinement Modules (lines 5479–7086)
~11 self-invoking functions that further override core and V2 functions. Each IIFE follows the pattern:

```javascript
(function() {
    const _origFn = functionName;
    functionName = function(...args) {
        if (!V2.isV2) { _origFn(...args); return; }
        // V2-specific implementation
    };
})();
```

**Frequently overridden functions** (stacked across multiple IIFEs):
- `renderLaneList` - div-based lane names, double-click editing
- `renderLanesCanvas` - strict timeline duration enforcement
- `renderTimelineRuler` - uses `settings.timelineDuration`
- `renderTimeMarkers` - uses `settings.timelineDuration`
- `updatePropertiesPanel` - sidebar management refinements
- `selectBox` - prevents panel opening during drag/resize

**Standalone modules:**
- `PropertiesCard` (line ~6850) - V1 floating card (unused in V2 HTML but kept for compatibility)
- `renderAlignmentCanvasOverlay` (line ~7017) - SVG overlay for alignment lines

### Override Chain Pattern
When fixing a function, find its **last override** (furthest down in the file). That's the version that actually runs. Earlier overrides are captured as `_orig*` references in the chain.

## UI Architecture

- **Header Bar**: Logo, title input, version label, lock badge
- **Toolbar**: File group, export group, tools, zoom controls, measurement bar, settings, theme toggle
- **Left Sidebar**: Lane list with click-to-expand controls, drag reordering
- **Canvas**: Timeline ruler, lane tracks, SVG alignment overlay, time markers, minimap footer
- **Right Sidebar**: Slide-out panel with 3 modes (Settings, Lane Properties, Box Properties)
- **Diagrams Modal**: Modal dialog for diagram management
