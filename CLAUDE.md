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
