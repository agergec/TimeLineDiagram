/* =====================================================
   Timeline Diagram Editor - Main Application Logic
   ===================================================== */

// =====================================================
// Data Model
// =====================================================
class TimelineDiagram {
    constructor() {
        this.title = 'Timeline Diagram';
        this.startTime = '00:00:00 000';
        this.lanes = [];
        this.boxes = [];
        this.nextLaneId = 1;
        this.nextBoxId = 1;
        this.locked = false;
    }

    addLane(name, baseColor = null) {
        const lane = {
            id: this.nextLaneId++,
            name: name,
            order: this.lanes.length,
            baseColor: baseColor // Optional: lane's base color for boxes
        };
        this.lanes.push(lane);
        return lane;
    }

    removeLane(laneId) {
        this.lanes = this.lanes.filter(l => l.id !== laneId);
        this.boxes = this.boxes.filter(b => b.laneId !== laneId);
        // Reorder remaining lanes
        this.lanes.forEach((lane, index) => {
            lane.order = index;
        });
    }

    renameLane(laneId, newName) {
        const lane = this.lanes.find(l => l.id === laneId);
        if (lane) {
            lane.name = newName;
        }
    }

    insertLaneAt(position, name) {
        const lane = {
            id: this.nextLaneId++,
            name: name,
            order: position
        };
        this.lanes.splice(position, 0, lane);
        // Reorder all lanes
        this.lanes.forEach((l, index) => {
            l.order = index;
        });
        return lane;
    }

    moveLane(laneId, direction) {
        const index = this.lanes.findIndex(l => l.id === laneId);
        if (index === -1) return false;

        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= this.lanes.length) return false;

        // Swap lanes
        [this.lanes[index], this.lanes[newIndex]] = [this.lanes[newIndex], this.lanes[index]];

        // Update order
        this.lanes.forEach((l, i) => {
            l.order = i;
        });
        return true;
    }

    addBox(laneId, startOffset, duration, label, color) {
        const box = {
            id: this.nextBoxId++,
            laneId: laneId,
            startOffset: startOffset, // in ms
            duration: duration, // in ms
            label: label,
            color: color
        };
        this.boxes.push(box);
        return box;
    }

    removeBox(boxId) {
        this.boxes = this.boxes.filter(b => b.id !== boxId);
    }

    updateBox(boxId, updates) {
        const box = this.boxes.find(b => b.id === boxId);
        if (box) {
            Object.assign(box, updates);
        }
        return box;
    }

    getBoxesForLane(laneId) {
        return this.boxes.filter(b => b.laneId === laneId)
            .sort((a, b) => a.startOffset - b.startOffset);
    }

    getTotalDuration() {
        if (this.boxes.length === 0) return 0;
        return Math.max(...this.boxes.map(b => b.startOffset + b.duration));
    }

    toJSON() {
        // Build measurement data if pinned
        let measurement = null;
        if (app.measurePinned && app.measureStart && app.measureEnd) {
            measurement = {
                startX: app.measureStart.x,
                endX: app.measureEnd.x
            };
        }

        return {
            title: this.title,
            startTime: this.startTime,
            lanes: this.lanes,
            boxes: this.boxes,
            nextLaneId: this.nextLaneId,
            nextBoxId: this.nextBoxId,
            locked: this.locked,
            settings: app.settings, // Include global settings
            measurement: measurement // Include pinned measurement
        };
    }

    fromJSON(data) {
        this.title = data.title || 'Timeline Diagram';
        this.startTime = data.startTime || '00:00:00 000';
        this.lanes = data.lanes || [];
        this.boxes = data.boxes || [];
        this.nextLaneId = data.nextLaneId || 1;
        this.nextBoxId = data.nextBoxId || 1;
        this.locked = data.locked || false;
        // Restore settings if present
        if (data.settings) {
            app.settings = { ...app.settings, ...data.settings };
        }
        // Restore measurement if present
        if (data.measurement) {
            app.pinnedMeasurementData = data.measurement;
        } else {
            app.pinnedMeasurementData = null;
        }
    }
}

// =====================================================
// Application State
// =====================================================
const app = {
    diagram: new TimelineDiagram(),
    selectedBoxId: null,
    selectedLaneId: null,
    pixelsPerMs: 0.15, // Default scale: 0.15px per ms
    minPixelsPerMs: 0.01,
    maxPixelsPerMs: 2,
    isDragging: false,
    dragData: null,
    boxGap: 4, // Gap between boxes in pixels

    // Measurement tool state
    isMeasuring: false,
    measurePinned: false,
    measureStart: null,
    measureEnd: null,
    pinnedMeasurementData: null, // Stored measurement from loaded diagram

    // Global settings
    settings: {
        timeFormatThreshold: 1000, // Switch from ms to seconds when duration > this value (0 = always ms)
        showAlignmentLines: true,  // Toggle vertical alignment lines
        showBoxLabels: false       // Toggle persistent floating labels above boxes
    },

    // DOM Elements
    elements: {}
};

// Color palette reordered to maximize difference between adjacent lanes
// Original: Red, Pink, Purple, Deep Purple, Indigo, Blue, Light Blue, Cyan,
//           Teal, Green, Light Green, Lime, Yellow, Orange, Deep Orange, Brown
// Reordered to alternate between warm/cool and spread hues
const PALETTE = [
    '#EF5350', // Red
    '#26A69A', // Teal (opposite)
    '#AB47BC', // Purple
    '#66BB6A', // Green (opposite)
    '#5C6BC0', // Indigo
    '#FFA726', // Orange (opposite)
    '#29B6F6', // Light Blue
    '#FF7043', // Deep Orange (opposite)
    '#7E57C2', // Deep Purple
    '#9CCC65', // Light Green (opposite)
    '#42A5F5', // Blue
    '#FFEE58', // Yellow (opposite)
    '#EC407A', // Pink
    '#26C6DA', // Cyan (opposite)
    '#8D6E63', // Brown
    '#D4E157'  // Lime (opposite)
];

function adjustColor(hex, amount) {
    let usePound = false;
    if (hex[0] === "#") {
        hex = hex.slice(1);
        usePound = true;
    }
    let num = parseInt(hex, 16);
    let r = (num >> 16) + amount;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    let b = ((num >> 8) & 0x00FF) + amount;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    let g = (num & 0x0000FF) + amount;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? "#" : "") + String(g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

// Adjust hue while keeping saturation and lightness high (bright colors)
function adjustHue(hex, hueShift) {
    // Convert hex to HSL
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    // Shift hue
    h = (h + hueShift / 360) % 1;
    if (h < 0) h += 1;

    // Keep saturation high (0.6-0.8) and lightness bright (0.5-0.65)
    s = Math.max(0.6, Math.min(0.85, s));
    l = Math.max(0.45, Math.min(0.65, l));

    // Convert back to RGB
    function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    }

    let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    let p = 2 * l - q;
    r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    g = Math.round(hue2rgb(p, q, h) * 255);
    b = Math.round(hue2rgb(p, q, h - 1/3) * 255);

    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function getAutoBoxColor(laneId) {
    const lane = app.diagram.lanes.find(l => l.id === parseInt(laneId));
    if (!lane) return '#6366F1';

    const laneIndex = app.diagram.lanes.indexOf(lane);

    // Use lane's base color if set, otherwise use palette
    const baseColor = lane.baseColor || PALETTE[laneIndex % PALETTE.length];

    // Get count of boxes in this lane for variation
    const laneBoxes = app.diagram.getBoxesForLane(laneId);
    const boxCount = laneBoxes.length;

    // Use hue shifts to create contrasting but related colors
    // Small hue shifts keep colors in same family but visually distinct
    const hueShifts = [0, 15, -12, 25, -20, 35, -30, 10]; // Degrees of hue rotation
    const hueShift = hueShifts[boxCount % hueShifts.length];

    return adjustHue(baseColor, hueShift);
}

function setLaneColor(laneId, color) {
    const lane = app.diagram.lanes.find(l => l.id === parseInt(laneId));
    if (lane) {
        lane.baseColor = color;
        // Update all boxes in this lane to use new color scheme
        const laneBoxes = app.diagram.getBoxesForLane(laneId);
        const hueShifts = [0, 15, -12, 25, -20, 35, -30, 10];
        laneBoxes.forEach((box, index) => {
            box.color = adjustHue(color, hueShifts[index % hueShifts.length]);
        });
        renderLanesCanvas();
    }
}

// =====================================================
// Toast Notification System
// =====================================================
const TOAST_ICONS = {
    warning: '⚠️',
    error: '❌',
    success: '✓',
    info: 'ℹ️'
};

function showToast(options) {
    const {
        type = 'info',
        title,
        message,
        duration = 4000,
        actions = null
    } = options;

    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let html = `
        <span class="toast-icon">${TOAST_ICONS[type]}</span>
        <div class="toast-content">
            ${title ? `<div class="toast-title">${title}</div>` : ''}
            ${message ? `<div class="toast-message">${message}</div>` : ''}
        </div>
    `;

    if (actions) {
        html += `<div class="toast-actions"></div>`;
    } else {
        html += `<button class="toast-close">×</button>`;
    }

    toast.innerHTML = html;

    // Add action buttons if provided
    if (actions) {
        const actionsContainer = toast.querySelector('.toast-actions');
        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = `toast-btn toast-btn-${action.type || 'cancel'}`;
            btn.textContent = action.label;
            btn.addEventListener('click', () => {
                hideToast(toast);
                if (action.onClick) action.onClick();
            });
            actionsContainer.appendChild(btn);
        });
    } else {
        // Close button
        toast.querySelector('.toast-close').addEventListener('click', () => hideToast(toast));
    }

    container.appendChild(toast);

    // Auto dismiss if no actions and duration > 0
    if (!actions && duration > 0) {
        setTimeout(() => hideToast(toast), duration);
    }

    return toast;
}

function hideToast(toast) {
    if (!toast || toast.classList.contains('hiding')) return;
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 200);
}

function showConfirmToast(options) {
    const { title, message, onConfirm, onCancel, confirmLabel = 'Delete', cancelLabel = 'Cancel' } = options;
    return showToast({
        type: 'warning',
        title,
        message,
        duration: 0,
        actions: [
            { label: confirmLabel, type: 'confirm', onClick: onConfirm },
            { label: cancelLabel, type: 'cancel', onClick: onCancel }
        ]
    });
}

// =====================================================
// Diagram Storage (localStorage)
// =====================================================
const STORAGE_KEY = 'timeline_diagrams';
const MAX_DIAGRAMS = 10;
let currentDiagramId = null;
let autoSaveTimeout = null;

function generateDiagramId() {
    return 'diag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getAllDiagrams() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('Failed to load diagrams from storage:', e);
        return [];
    }
}

function saveDiagramsList(diagrams) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(diagrams));
    } catch (e) {
        console.error('Failed to save diagrams to storage:', e);
        showToast({
            type: 'error',
            title: 'Storage Error',
            message: 'Could not save to browser storage.'
        });
    }
}

function saveCurrentDiagram() {
    if (!currentDiagramId) {
        currentDiagramId = generateDiagramId();
    }

    const diagrams = getAllDiagrams();
    const diagramData = {
        id: currentDiagramId,
        title: app.diagram.title,
        updatedAt: Date.now(),
        data: app.diagram.toJSON()
    };

    // Find existing or add new (keep original order, don't sort)
    const existingIndex = diagrams.findIndex(d => d.id === currentDiagramId);
    if (existingIndex >= 0) {
        diagrams[existingIndex] = diagramData;
    } else {
        diagrams.unshift(diagramData);
    }

    // Limit to MAX_DIAGRAMS (remove oldest if needed)
    const trimmedDiagrams = diagrams.slice(0, MAX_DIAGRAMS);

    saveDiagramsList(trimmedDiagrams);
    renderDiagramsList();
}

function autoSave() {
    // Debounce auto-save
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    autoSaveTimeout = setTimeout(() => {
        saveCurrentDiagram();
    }, 1000);
}

function loadDiagram(diagramId) {
    const diagrams = getAllDiagrams();
    const diagram = diagrams.find(d => d.id === diagramId);
    if (!diagram) {
        showToast({ type: 'error', title: 'Not Found', message: 'Diagram not found in storage.' });
        return false;
    }

    currentDiagramId = diagramId;
    app.diagram.fromJSON(diagram.data);
    app.elements.diagramTitle.value = app.diagram.title;
    app.elements.startTime.value = app.diagram.startTime;

    deselectBox();
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentMarkers();
    updateTotalDuration();
    renderDiagramsList();

    // Update lock state
    updateLockState();

    // Update box labels state
    updateBoxLabelsState();

    // Restore pinned measurement if present
    restorePinnedMeasurement();

    showToast({ type: 'success', title: 'Loaded', message: `"${diagram.title}" restored.`, duration: 2000 });
    return true;
}

function deleteDiagram(diagramId) {
    const diagrams = getAllDiagrams();
    const diagram = diagrams.find(d => d.id === diagramId);
    if (!diagram) return;

    // Prevent deleting locked diagrams
    if (diagram.data && diagram.data.locked) {
        showToast({
            type: 'warning',
            title: 'Diagram Locked',
            message: 'Unlock the diagram before deleting.',
            duration: 2500
        });
        return;
    }

    showConfirmToast({
        title: 'Delete Diagram?',
        message: `"${diagram.title}" will be permanently removed.`,
        onConfirm: () => {
            const filtered = diagrams.filter(d => d.id !== diagramId);
            saveDiagramsList(filtered);

            // If deleting current diagram, load another or create new
            if (diagramId === currentDiagramId) {
                if (filtered.length > 0) {
                    // Load the most recent remaining diagram
                    loadDiagram(filtered[0].id);
                } else {
                    // No diagrams left, create a new one
                    createNewDiagram();
                }
            } else {
                renderDiagramsList();
            }

            showToast({ type: 'success', title: 'Deleted', message: 'Diagram removed.', duration: 2000 });
        }
    });
}

function resetDiagram(diagramId) {
    const diagrams = getAllDiagrams();
    const diagram = diagrams.find(d => d.id === diagramId);
    if (!diagram) return;

    // Prevent resetting locked diagrams
    if (diagram.data && diagram.data.locked) {
        showToast({
            type: 'warning',
            title: 'Diagram Locked',
            message: 'Unlock the diagram before resetting.',
            duration: 2500
        });
        return;
    }

    showConfirmToast({
        title: 'Reset Diagram?',
        message: `All lanes and boxes in "${diagram.title}" will be cleared.`,
        confirmLabel: 'Reset',
        onConfirm: () => {
            // If it's the current diagram, reset in memory too
            if (diagramId === currentDiagramId) {
                app.diagram.lanes = [];
                app.diagram.boxes = [];
                app.diagram.nextLaneId = 1;
                app.diagram.nextBoxId = 1;
                app.diagram.addLane('Lane 1');
                app.selectedBoxId = null;
                app.selectedLaneId = null;

                closeMeasurement();
                deselectBox();
                renderLaneList();
                renderLanesCanvas();
                renderTimelineRuler();
                renderTimeMarkers();
                renderAlignmentMarkers();
                updateTotalDuration();
                saveCurrentDiagram();
            } else {
                // Reset the stored diagram
                diagram.data.lanes = [];
                diagram.data.boxes = [];
                diagram.data.nextLaneId = 2;
                diagram.data.nextBoxId = 1;
                diagram.data.lanes = [{ id: 1, name: 'Lane 1', order: 0 }];
                diagram.data.measurement = null;
                diagram.updatedAt = Date.now();
                saveDiagramsList(diagrams);
            }

            renderDiagramsList();
            showToast({ type: 'success', title: 'Reset', message: 'Diagram cleared.', duration: 2000 });
        }
    });
}

function purgeApplication() {
    const diagrams = getAllDiagrams();
    const lockedDiagrams = diagrams.filter(d => d.data && d.data.locked);
    const unlockedDiagrams = diagrams.filter(d => !d.data || !d.data.locked);
    const hasLocked = lockedDiagrams.length > 0;
    const hasUnlocked = unlockedDiagrams.length > 0;

    // If nothing to delete
    if (!hasUnlocked && !hasLocked) {
        showToast({ type: 'info', title: 'Nothing to Purge', message: 'No diagrams found.', duration: 2000 });
        return;
    }

    // Build message based on what will happen
    let message, title;
    if (hasLocked && hasUnlocked) {
        title = 'Purge Unlocked Diagrams?';
        message = `${unlockedDiagrams.length} unlocked diagram(s) will be deleted. ${lockedDiagrams.length} locked diagram(s) will be preserved.`;
    } else if (hasLocked && !hasUnlocked) {
        showToast({ type: 'info', title: 'All Diagrams Locked', message: 'No unlocked diagrams to purge.', duration: 2500 });
        return;
    } else {
        title = 'Purge Application?';
        message = 'ALL diagrams and settings will be permanently deleted. This cannot be undone!';
    }

    showConfirmToast({
        title: title,
        message: message,
        confirmLabel: hasLocked ? 'Purge Unlocked' : 'Purge All',
        onConfirm: () => {
            if (hasLocked) {
                // Keep only locked diagrams
                saveDiagramsList(lockedDiagrams);

                // If current diagram was deleted, load a locked one
                const currentStillExists = lockedDiagrams.some(d => d.id === currentDiagramId);
                if (!currentStillExists) {
                    const firstLocked = lockedDiagrams[0];
                    currentDiagramId = firstLocked.id;
                    app.diagram = TimelineDiagram.fromJSON(firstLocked.data);
                    app.elements.diagramTitle.value = app.diagram.title;
                    app.elements.startTime.value = app.diagram.startTime;
                    updateLockState();
                    restorePinnedMeasurement();
                }

                closeMeasurement();
                deselectBox();
                renderLaneList();
                renderLanesCanvas();
                renderTimelineRuler();
                renderTimeMarkers();
                renderAlignmentMarkers();
                updateTotalDuration();

                app.elements.propertiesPanel.classList.add('hidden');

                // Render diagrams list after a brief delay to ensure storage is synced
                setTimeout(() => {
                    renderDiagramsList();
                }, 50);

                showToast({ type: 'success', title: 'Purged', message: `${unlockedDiagrams.length} diagram(s) deleted. Locked diagrams preserved.`, duration: 3000 });
            } else {
                // Clear all localStorage data for this app
                localStorage.removeItem(STORAGE_KEY);

                // Reset app state
                currentDiagramId = generateDiagramId();
                app.diagram = new TimelineDiagram();
                app.diagram.title = generateDiagramTitle();
                app.diagram.addLane('Lane 1');
                app.selectedBoxId = null;
                app.selectedLaneId = null;
                app.settings = {
                    timeFormatThreshold: 1000,
                    showAlignmentLines: true,
                    showBoxLabels: false
                };

                closeMeasurement();

                app.elements.diagramTitle.value = app.diagram.title;
                app.elements.startTime.value = app.diagram.startTime;

                deselectBox();
                renderLaneList();
                renderLanesCanvas();
                renderTimelineRuler();
                renderTimeMarkers();
                renderAlignmentMarkers();
                updateTotalDuration();
                renderDiagramsList();

                // Save the fresh diagram
                saveCurrentDiagram();

                // Close the settings panel
                app.elements.propertiesPanel.classList.add('hidden');

                showToast({ type: 'success', title: 'Purged', message: 'All data has been removed.', duration: 3000 });
            }
        }
    });
}

function generateDiagramTitle() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `Diagram-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}

function createNewDiagram() {
    currentDiagramId = generateDiagramId();
    app.diagram = new TimelineDiagram();
    app.diagram.title = generateDiagramTitle();
    app.diagram.addLane('Lane 1');
    app.selectedBoxId = null;
    app.selectedLaneId = null;

    // Clear any pinned measurement
    closeMeasurement();

    app.elements.diagramTitle.value = app.diagram.title;
    app.elements.startTime.value = app.diagram.startTime;

    deselectBox();
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentMarkers();
    updateTotalDuration();
    renderDiagramsList();

    // Save the new empty diagram
    saveCurrentDiagram();
}

function loadMostRecentDiagram() {
    const diagrams = getAllDiagrams();
    if (diagrams.length > 0) {
        return loadDiagram(diagrams[0].id);
    }
    return false;
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

function renderDiagramsList() {
    const container = document.getElementById('diagrams-list');
    if (!container) return;

    const diagrams = getAllDiagrams();

    if (diagrams.length === 0) {
        container.innerHTML = '<div class="no-diagrams">No saved diagrams</div>';
        return;
    }

    container.innerHTML = diagrams.map(d => {
        const isLocked = d.data && d.data.locked;
        return `
        <div class="diagram-item ${d.id === currentDiagramId ? 'active' : ''}" data-diagram-id="${d.id}">
            <div class="diagram-item-info">
                <div class="diagram-item-title">${isLocked ? '🔒 ' : ''}${escapeHtml(d.title || 'Untitled')}</div>
                <div class="diagram-item-time">${formatTimeAgo(d.updatedAt)}</div>
            </div>
            <div class="diagram-item-actions">
                <button class="diagram-item-reset" data-diagram-id="${d.id}" title="Reset diagram">↺</button>
                <button class="diagram-item-delete" data-diagram-id="${d.id}" title="Delete diagram">×</button>
            </div>
        </div>`;
    }).join('');

    // Add click listeners
    container.querySelectorAll('.diagram-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('diagram-item-delete') ||
                e.target.classList.contains('diagram-item-reset')) return;
            const id = item.dataset.diagramId;
            if (id !== currentDiagramId) {
                loadDiagram(id);
            }
        });
    });

    container.querySelectorAll('.diagram-item-reset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetDiagram(btn.dataset.diagramId);
        });
    });

    container.querySelectorAll('.diagram-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteDiagram(btn.dataset.diagramId);
        });
    });
}

function toggleDiagramsPanel() {
    const panel = document.getElementById('diagrams-panel');
    if (panel) {
        panel.classList.toggle('open');
    }
}

// =====================================================
// Utility Functions
// =====================================================
function parseTime(timeStr) {
    // Parse "HH:MM:SS sss" format
    const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})\s*(\d{3})?/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const ms = parseInt(match[4] || '0', 10);
    return ((hours * 3600) + (minutes * 60) + seconds) * 1000 + ms;
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.round(ms % 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${String(milliseconds).padStart(3, '0')}`;
}

function formatDuration(ms) {
    const threshold = app.settings.timeFormatThreshold;

    // If threshold is 0, always show ms
    if (threshold === 0) {
        return `${Math.round(ms)}ms`;
    }

    // If duration exceeds threshold, show in appropriate unit
    if (ms >= threshold) {
        if (ms >= 60000) {
            // Show minutes and seconds
            const minutes = Math.floor(ms / 60000);
            const seconds = ((ms % 60000) / 1000).toFixed(1);
            return seconds === '0.0' ? `${minutes}m` : `${minutes}m ${seconds}s`;
        }
        // Show seconds
        const seconds = (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1);
        return `${seconds}s`;
    }
    return `${Math.round(ms)}ms`;
}

function msToPixels(ms) {
    return ms * app.pixelsPerMs;
}

function pixelsToMs(px) {
    return px / app.pixelsPerMs;
}

function getContrastColor(hexColor) {
    // Convert hex to RGB
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? '#000000' : '#ffffff';
}

// =====================================================
// Rendering Functions
// =====================================================
function renderLaneList() {
    const container = app.elements.laneList;
    container.innerHTML = '';
    const totalLanes = app.diagram.lanes.length;

    app.diagram.lanes.forEach((lane, index) => {
        const item = document.createElement('div');
        item.className = 'lane-item';
        item.dataset.laneId = lane.id;
        item.draggable = true;

        const isFirst = index === 0;
        const isLast = index === totalLanes - 1;

        const laneColorStyle = lane.baseColor ? `background-color: ${lane.baseColor}` : `background-color: ${PALETTE[index % PALETTE.length]}`;
        item.innerHTML = `
            <span class="lane-drag-handle" title="Drag to reorder">⋮⋮</span>
            <button class="lane-color-btn" data-lane-id="${lane.id}" title="Change lane color" style="${laneColorStyle}"></button>
            <input type="text" class="lane-name-input" value="${escapeHtml(lane.name)}" data-lane-id="${lane.id}">
            <div class="lane-controls">
                <button class="lane-control-btn move-up" data-lane-id="${lane.id}" title="Move up" ${isFirst ? 'disabled' : ''}>↑</button>
                <button class="lane-control-btn move-down" data-lane-id="${lane.id}" title="Move down" ${isLast ? 'disabled' : ''}>↓</button>
                <button class="lane-control-btn insert-before" data-lane-id="${lane.id}" data-index="${index}" title="Insert lane before">+↑</button>
                <button class="lane-control-btn insert-after" data-lane-id="${lane.id}" data-index="${index}" title="Insert lane after">+↓</button>
                <button class="lane-delete-btn" data-lane-id="${lane.id}" title="Delete lane">×</button>
            </div>
        `;

        container.appendChild(item);
    });

    // Add event listeners for lane name inputs
    container.querySelectorAll('.lane-name-input').forEach(input => {
        input.addEventListener('change', (e) => {
            if (!isEditingAllowed()) {
                e.target.value = app.diagram.lanes.find(l => l.id === parseInt(e.target.dataset.laneId, 10))?.name || '';
                return;
            }
            const laneId = parseInt(e.target.dataset.laneId, 10);
            app.diagram.renameLane(laneId, e.target.value);
            renderLanesCanvas();
        });
    });

    // Add event listeners for delete buttons
    container.querySelectorAll('.lane-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const laneId = parseInt(e.target.dataset.laneId, 10);
            const lane = app.diagram.lanes.find(l => l.id === laneId);
            const boxCount = app.diagram.getBoxesForLane(laneId).length;

            showConfirmToast({
                title: 'Delete Lane?',
                message: `"${lane?.name || 'Lane'}"${boxCount > 0 ? ` and its ${boxCount} box${boxCount > 1 ? 'es' : ''}` : ''} will be removed.`,
                onConfirm: () => {
                    app.diagram.removeLane(laneId);
                    renderLaneList();
                    renderLanesCanvas();
                    updateTotalDuration();
                }
            });
        });
    });

    // Add event listeners for move up buttons
    container.querySelectorAll('.lane-control-btn.move-up').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const laneId = parseInt(e.target.dataset.laneId, 10);
            if (app.diagram.moveLane(laneId, 'up')) {
                renderLaneList();
                renderLanesCanvas();
            }
        });
    });

    // Add event listeners for move down buttons
    container.querySelectorAll('.lane-control-btn.move-down').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const laneId = parseInt(e.target.dataset.laneId, 10);
            if (app.diagram.moveLane(laneId, 'down')) {
                renderLaneList();
                renderLanesCanvas();
            }
        });
    });

    // Add event listeners for insert before buttons
    container.querySelectorAll('.lane-control-btn.insert-before').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const index = parseInt(e.target.dataset.index, 10);
            const name = `Lane ${app.diagram.nextLaneId}`;
            app.diagram.insertLaneAt(index, name);
            renderLaneList();
            renderLanesCanvas();
        });
    });

    // Add event listeners for insert after buttons
    container.querySelectorAll('.lane-control-btn.insert-after').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const index = parseInt(e.target.dataset.index, 10);
            const name = `Lane ${app.diagram.nextLaneId}`;
            app.diagram.insertLaneAt(index + 1, name);
            renderLaneList();
            renderLanesCanvas();
        });
    });

    // Add event listeners for lane color buttons
    container.querySelectorAll('.lane-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const laneId = parseInt(e.target.dataset.laneId, 10);
            showLanePropertiesPanel(laneId);
        });
    });

    // Drag and drop for reordering
    setupLaneDragAndDrop();
}

function setupLaneDragAndDrop() {
    const container = app.elements.laneList;
    let draggedItem = null;

    container.querySelectorAll('.lane-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            if (app.diagram.locked) {
                e.preventDefault();
                return;
            }
            draggedItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedItem = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === item) return;

            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;

            if (e.clientY < midY) {
                item.classList.add('drag-over-top');
                item.classList.remove('drag-over-bottom');
            } else {
                item.classList.add('drag-over-bottom');
                item.classList.remove('drag-over-top');
            }
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over-top', 'drag-over-bottom');

            if (!draggedItem || draggedItem === item) return;

            const draggedLaneId = parseInt(draggedItem.dataset.laneId, 10);
            const targetLaneId = parseInt(item.dataset.laneId, 10);

            const draggedIndex = app.diagram.lanes.findIndex(l => l.id === draggedLaneId);
            let targetIndex = app.diagram.lanes.findIndex(l => l.id === targetLaneId);

            if (draggedIndex === -1 || targetIndex === -1) return;

            // Remove the dragged lane
            const [draggedLane] = app.diagram.lanes.splice(draggedIndex, 1);

            // Recalculate target index after removal
            targetIndex = app.diagram.lanes.findIndex(l => l.id === targetLaneId);

            const rect = item.getBoundingClientRect();
            const insertAfter = e.clientY > rect.top + rect.height / 2;

            if (insertAfter) {
                app.diagram.lanes.splice(targetIndex + 1, 0, draggedLane);
            } else {
                app.diagram.lanes.splice(targetIndex, 0, draggedLane);
            }

            // Update order
            app.diagram.lanes.forEach((l, i) => {
                l.order = i;
            });

            renderLaneList();
            renderLanesCanvas();
        });
    });
}

function renderTimelineRuler() {
    const ruler = app.elements.timelineRuler;
    const canvasWidth = app.elements.lanesCanvas.clientWidth -
        getComputedStyle(document.documentElement).getPropertyValue('--lane-label-width').replace('px', '');

    ruler.innerHTML = '';

    const totalDuration = Math.max(app.diagram.getTotalDuration(), 1000);
    const visibleMs = pixelsToMs(canvasWidth - 160); // Subtract lane label width

    // Calculate appropriate interval
    let interval = 100; // Start with 100ms
    const intervals = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];

    for (const int of intervals) {
        const pixelsPerInterval = msToPixels(int);
        if (pixelsPerInterval >= 60) {
            interval = int;
            break;
        }
    }

    // Add 20% padding beyond total duration
    const endTime = Math.max(totalDuration * 1.2, visibleMs);

    for (let time = 0; time <= endTime; time += interval) {
        const mark = document.createElement('div');
        mark.className = 'ruler-mark' + (time % (interval * 5) === 0 ? ' major' : '');
        mark.style.left = `${msToPixels(time)}px`;
        mark.innerHTML = `<span>${formatDuration(time)}</span>`;
        ruler.appendChild(mark);
    }
}

function renderLanesCanvas() {
    const canvas = app.elements.lanesCanvas;
    canvas.innerHTML = '';

    app.diagram.lanes.forEach(lane => {
        const row = document.createElement('div');
        row.className = 'lane-row';
        row.dataset.laneId = lane.id;

        const label = document.createElement('div');
        label.className = 'lane-label';
        label.textContent = lane.name;
        label.title = lane.name;

        const track = document.createElement('div');
        track.className = 'lane-track';
        track.dataset.laneId = lane.id;

        // Render boxes for this lane
        const boxes = app.diagram.getBoxesForLane(lane.id);
        boxes.forEach(box => {
            const boxEl = createBoxElement(box);
            track.appendChild(boxEl);
        });

        row.appendChild(label);
        row.appendChild(track);
        canvas.appendChild(row);
    });

    // Add event listeners for box creation (click and drag on track)
    canvas.querySelectorAll('.lane-track').forEach(track => {
        track.addEventListener('mousedown', handleTrackMouseDown);
    });

    renderTimelineRuler();
    renderAlignmentMarkers();
    renderTimeMarkers();
}

function createBoxElement(box) {
    const el = document.createElement('div');
    el.className = 'timeline-box' + (box.id === app.selectedBoxId ? ' selected' : '');
    el.dataset.boxId = box.id;

    const left = msToPixels(box.startOffset);
    const width = Math.max(msToPixels(box.duration), 20); // Minimum width of 20px

    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
    el.style.backgroundColor = box.color;
    el.style.color = getContrastColor(box.color);

    const labelText = box.label ? `${box.label} (${formatDuration(box.duration)})` : formatDuration(box.duration);
    const floatingLabelText = box.label ? `${box.label}: ${formatDuration(box.duration)}` : formatDuration(box.duration);

    el.innerHTML = `
        <div class="box-floating-label">${escapeHtml(floatingLabelText)}</div>
        <div class="box-resize-handle left"></div>
        <span class="box-label">${escapeHtml(labelText)}</span>
        <div class="box-resize-handle right"></div>
    `;

    // Floating tooltip on hover
    el.addEventListener('mouseenter', (e) => {
        showBoxTooltip(box, e);
    });

    el.addEventListener('mousemove', (e) => {
        moveBoxTooltip(e);
    });

    el.addEventListener('mouseleave', () => {
        hideBoxTooltip();
    });

    // Box click/selection
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectBox(box.id);
    });

    // Box dragging (move)
    el.addEventListener('mousedown', (e) => {
        if (app.isPicking) {
            e.stopPropagation();
            e.preventDefault();
            completePickStart(box.id);
            return;
        }

        if (e.target.classList.contains('box-resize-handle')) {
            handleResizeStart(e, box.id);
        } else {
            handleBoxDragStart(e, box.id);
        }
        hideBoxTooltip(); // Hide tooltip while dragging
    });

    return el;
}

function showBoxTooltip(box, e) {
    const tooltip = app.elements.tooltip;
    if (!tooltip) return;

    const baseTime = parseTime(app.diagram.startTime);
    const endOffset = box.startOffset + box.duration;

    tooltip.innerHTML = `
        <div class="tooltip-label">${escapeHtml(box.label || 'Untitled Box')}</div>
        <div class="tooltip-row">
            <span class="label">Start:</span>
            <span class="value">+${formatDuration(box.startOffset)} (${formatTime(baseTime + box.startOffset)})</span>
        </div>
        <div class="tooltip-row">
            <span class="label">Duration:</span>
            <span class="value">${formatDuration(box.duration)}</span>
        </div>
        <div class="tooltip-row">
            <span class="label">End:</span>
            <span class="value">+${formatDuration(endOffset)} (${formatTime(baseTime + endOffset)})</span>
        </div>
    `;

    tooltip.style.left = `${e.clientX + 15}px`;
    tooltip.style.top = `${e.clientY + 15}px`;
    tooltip.classList.add('visible');
}

function moveBoxTooltip(e) {
    const tooltip = app.elements.tooltip;
    if (!tooltip) return;

    tooltip.style.left = `${e.clientX + 15}px`;
    tooltip.style.top = `${e.clientY + 15}px`;
}

function hideBoxTooltip() {
    const tooltip = app.elements.tooltip;
    if (!tooltip) return;

    tooltip.classList.remove('visible');
}

function renderAlignmentMarkers() {
    const svg = app.elements.alignmentMarkers;
    const canvas = app.elements.lanesCanvas;

    svg.innerHTML = '';
    svg.style.display = 'none';

    // Check setting
    if (!app.settings.showAlignmentLines) return;
    if (app.diagram.boxes.length === 0) return;

    // Collect all unique time points
    const timePoints = new Set();
    app.diagram.boxes.forEach(box => {
        timePoints.add(box.startOffset);
        timePoints.add(box.startOffset + box.duration);
    });

    svg.style.display = 'block';

    // Get offset for lane label width
    const laneLabelWidth = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--lane-label-width').replace('px', ''), 10) || 160;
    const sidebarWidth = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-width').replace('px', ''), 10) || 220;
    const headerHeight = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--header-height').replace('px', ''), 10) || 60;
    const rulerHeight = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--ruler-height').replace('px', ''), 10) || 40;

    const offsetX = sidebarWidth + laneLabelWidth;
    const offsetY = headerHeight + rulerHeight;
    const canvasHeight = canvas.scrollHeight;

    timePoints.forEach(time => {
        const x = offsetX + msToPixels(time);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'alignment-line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', offsetY);
        line.setAttribute('x2', x);
        line.setAttribute('y2', offsetY + canvasHeight);

        svg.appendChild(line);
    });
}

function updateTotalDuration() {
    const duration = app.diagram.getTotalDuration();
    app.elements.totalDuration.textContent = formatDuration(duration);
    // Auto-save on any change that updates duration
    autoSave();
}

function updatePropertiesPanel() {
    const panel = app.elements.propertiesPanel;
    const boxProps = document.getElementById('box-props');
    const laneProps = document.getElementById('lane-props');
    const settingsProps = document.getElementById('settings-props');
    const propsTitle = document.getElementById('props-title');

    if (!app.selectedBoxId) {
        panel.classList.add('hidden');
        return;
    }

    const box = app.diagram.boxes.find(b => b.id === app.selectedBoxId);
    if (!box) {
        panel.classList.add('hidden');
        return;
    }

    // Show box properties, hide others
    if (boxProps) boxProps.classList.remove('hidden');
    if (laneProps) laneProps.classList.add('hidden');
    if (settingsProps) settingsProps.classList.add('hidden');
    if (propsTitle) propsTitle.textContent = 'Box Properties';

    panel.classList.remove('hidden');

    app.elements.boxLabel.value = box.label;
    app.elements.boxColor.value = box.color;
    app.elements.boxStart.value = box.startOffset;
    app.elements.boxDuration.value = box.duration;

    // Show end time (start + duration)
    if (app.elements.boxEnd) {
        app.elements.boxEnd.value = box.startOffset + box.duration;
    }

    // Calculate absolute times
    const baseTime = parseTime(app.diagram.startTime);
    app.elements.boxTimeStart.textContent = formatTime(baseTime + box.startOffset);
    app.elements.boxTimeEnd.textContent = formatTime(baseTime + box.startOffset + box.duration);
}

function renderTimeMarkers() {
    const container = app.elements.timeMarkers;
    if (!container) return;

    container.innerHTML = '';

    if (app.diagram.boxes.length === 0) return;

    // Collect all time points
    const markers = [];

    app.diagram.boxes.forEach(box => {
        markers.push({
            time: box.startOffset,
            type: 'start',
            boxId: box.id,
            color: box.color,
            label: formatDuration(box.startOffset)
        });
        markers.push({
            time: box.startOffset + box.duration,
            type: 'end',
            boxId: box.id,
            color: box.color,
            label: formatDuration(box.startOffset + box.duration)
        });
    });

    // Sort by time
    markers.sort((a, b) => a.time - b.time);

    // Layout Logic: Horizontal text with vertical stacking for collisions
    const levels = [];
    const charWidth = 7;
    const padding = 10;

    markers.forEach(m => {
        const x = msToPixels(m.time);
        const text = `${m.type === 'start' ? 'S' : 'E'}: ${m.label}`;
        const width = text.length * charWidth + padding;
        const startX = x - (width / 2);
        const endX = startX + width;

        let level = 0;
        let placed = false;

        while (!placed) {
            if (!levels[level] || levels[level] < startX) {
                levels[level] = endX;
                m.level = level;
                m.text = text;
                placed = true;
            } else {
                level++;
            }
            if (level > 20) { m.level = level; m.text = text; placed = true; }
        }
    });

    markers.forEach(m => {
        const x = msToPixels(m.time);

        const el = document.createElement('div');
        el.className = 'time-marker-h';
        el.style.left = `${x}px`;
        el.style.bottom = `${4 + (m.level * 16)}px`;
        el.style.color = m.color;

        const tick = document.createElement('div');
        tick.className = 'time-marker-tick';
        tick.style.backgroundColor = m.color;

        const label = document.createElement('span');
        label.className = 'time-marker-text';
        label.textContent = m.text;

        el.appendChild(tick);
        el.appendChild(label);
        container.appendChild(el);
    });
}

// =====================================================
// Interaction Handlers
// =====================================================
function selectBox(boxId) {
    // Deselect previous
    document.querySelectorAll('.timeline-box.selected').forEach(el => {
        el.classList.remove('selected');
    });

    app.selectedBoxId = boxId;

    // Select new
    const boxEl = document.querySelector(`.timeline-box[data-box-id="${boxId}"]`);
    if (boxEl) {
        boxEl.classList.add('selected');
    }

    updatePropertiesPanel();
}

function deselectBox() {
    app.selectedBoxId = null;
    document.querySelectorAll('.timeline-box.selected').forEach(el => {
        el.classList.remove('selected');
    });
    app.elements.propertiesPanel.classList.add('hidden');
}

function handleTrackMouseDown(e) {
    // Don't create boxes while measuring
    if (app.isMeasuring || e.ctrlKey || e.metaKey) {
        return;
    }

    // Don't allow editing if diagram is locked
    if (app.diagram.locked) {
        return;
    }

    if (e.target.classList.contains('timeline-box') ||
        e.target.closest('.timeline-box')) {
        return; // Let box handle its own events
    }

    // If in picking mode, clicking empty space cancels it
    if (app.isPicking) {
        app.isPicking = false;
        document.body.style.cursor = '';
        const btn = document.getElementById('pick-start-btn');
        if (btn) btn.classList.remove('active');
        return;
    }

    const track = e.currentTarget;
    const laneId = parseInt(track.dataset.laneId, 10);
    const rect = track.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startOffset = pixelsToMs(startX);

    // Create temporary box for preview
    const tempBox = document.createElement('div');
    tempBox.className = 'timeline-box creating';
    tempBox.style.left = `${startX}px`;
    tempBox.style.width = '0px';
    tempBox.style.backgroundColor = '#4CAF50';
    track.appendChild(tempBox);

    app.isDragging = true;
    app.dragData = {
        type: 'create',
        laneId: laneId,
        startX: startX,
        startOffset: startOffset,
        track: track,
        tempBox: tempBox
    };

    e.preventDefault();
}

function handleBoxDragStart(e, boxId) {
    e.stopPropagation();

    // Don't allow dragging if locked
    if (app.diagram.locked) return;

    const box = app.diagram.boxes.find(b => b.id === boxId);
    if (!box) return;

    const boxEl = e.currentTarget;
    const rect = boxEl.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;

    app.isDragging = true;
    app.dragData = {
        type: 'move',
        boxId: boxId,
        offsetX: offsetX,
        originalStart: box.startOffset
    };

    selectBox(boxId);
    e.preventDefault();
}

function handleResizeStart(e, boxId) {
    e.stopPropagation();

    // Don't allow resizing if locked
    if (app.diagram.locked) return;

    const box = app.diagram.boxes.find(b => b.id === boxId);
    if (!box) return;

    const isLeft = e.target.classList.contains('left');

    app.isDragging = true;
    app.dragData = {
        type: 'resize',
        boxId: boxId,
        side: isLeft ? 'left' : 'right',
        originalStart: box.startOffset,
        originalDuration: box.duration
    };

    selectBox(boxId);
    e.preventDefault();
}

function handleMouseMove(e) {
    if (!app.isDragging || !app.dragData) return;

    if (app.dragData.type === 'create') {
        const rect = app.dragData.track.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        // Support dragging in both directions
        const left = Math.min(currentX, app.dragData.startX);
        const width = Math.max(Math.abs(currentX - app.dragData.startX), 10);
        app.dragData.tempBox.style.left = `${left}px`;
        app.dragData.tempBox.style.width = `${width}px`;
    } else if (app.dragData.type === 'move') {
        const box = app.diagram.boxes.find(b => b.id === app.dragData.boxId);
        if (!box) return;

        const track = document.querySelector(`.lane-track[data-lane-id="${box.laneId}"]`);
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const newX = e.clientX - rect.left - app.dragData.offsetX;
        const newStart = Math.max(0, pixelsToMs(newX));

        box.startOffset = Math.round(newStart);

        const boxEl = document.querySelector(`.timeline-box[data-box-id="${box.id}"]`);
        if (boxEl) {
            boxEl.style.left = `${msToPixels(box.startOffset)}px`;
        }
        renderTimeMarkers();
        updatePropertiesPanel();
    } else if (app.dragData.type === 'resize') {
        const box = app.diagram.boxes.find(b => b.id === app.dragData.boxId);
        if (!box) return;

        const track = document.querySelector(`.lane-track[data-lane-id="${box.laneId}"]`);
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseMs = pixelsToMs(mouseX);

        if (app.dragData.side === 'right') {
            const newDuration = Math.max(50, mouseMs - box.startOffset);
            box.duration = Math.round(newDuration);
        } else {
            const endOffset = app.dragData.originalStart + app.dragData.originalDuration;
            const newStart = Math.max(0, Math.min(mouseMs, endOffset - 50));
            box.startOffset = Math.round(newStart);
            box.duration = Math.round(endOffset - box.startOffset);
        }

        const boxEl = document.querySelector(`.timeline-box[data-box-id="${box.id}"]`);
        if (boxEl) {
            boxEl.style.left = `${msToPixels(box.startOffset)}px`;
            boxEl.style.width = `${Math.max(msToPixels(box.duration), 20)}px`;

            const labelText = box.label ? `${box.label} (${formatDuration(box.duration)})` : formatDuration(box.duration);
            const labelEl = boxEl.querySelector('.box-label');
            if (labelEl) labelEl.textContent = labelText;
        }
        renderTimeMarkers();

        updatePropertiesPanel();
    }
}

function handleMouseUp(e) {
    if (!app.isDragging || !app.dragData) return;

    if (app.dragData.type === 'create') {
        const rect = app.dragData.track.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const dist = Math.abs(endX - app.dragData.startX);

        // Remove temp box
        app.dragData.tempBox.remove();

        // Create real box only if dragged enough (avoid single click creation)
        if (dist > 5) {
            // Use the leftmost point as start (support right-to-left drag)
            const leftX = Math.min(endX, app.dragData.startX);
            const startOffset = pixelsToMs(Math.max(0, leftX));
            const duration = pixelsToMs(Math.max(dist, 20));

            const box = app.diagram.addBox(
                app.dragData.laneId,
                Math.round(startOffset),
                Math.round(duration),
                '',
                getAutoBoxColor(app.dragData.laneId)
            );

            renderLanesCanvas();
            renderTimeMarkers();
            updateTotalDuration();
            selectBox(box.id);
        }
    } else if (app.dragData.type === 'move' || app.dragData.type === 'resize') {
        renderTimelineRuler();
        renderAlignmentMarkers();
        updateTotalDuration();
        updatePropertiesPanel();
    }

    app.isDragging = false;
    app.dragData = null;
}

// =====================================================
// Measurement Tool
// =====================================================
const SNAP_THRESHOLD = 8; // pixels

function getSnapPoints() {
    // Get lane label width for offset calculation
    const laneLabelWidth = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--lane-label-width').replace('px', ''), 10) || 160;

    // Collect all unique time points from boxes
    const snapPoints = [];
    app.diagram.boxes.forEach(box => {
        const startX = msToPixels(box.startOffset) + laneLabelWidth;
        const endX = msToPixels(box.startOffset + box.duration) + laneLabelWidth;
        snapPoints.push({ x: startX, time: box.startOffset });
        snapPoints.push({ x: endX, time: box.startOffset + box.duration });
    });

    return snapPoints;
}

function snapToAlignmentLine(x) {
    const snapPoints = getSnapPoints();
    let closestPoint = null;
    let closestDist = SNAP_THRESHOLD;

    for (const point of snapPoints) {
        const dist = Math.abs(point.x - x);
        if (dist < closestDist) {
            closestDist = dist;
            closestPoint = point;
        }
    }

    return closestPoint;
}

function startMeasurement(e) {
    const canvas = app.elements.lanesCanvas;
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left + canvas.scrollLeft;
    const y = e.clientY - rect.top + canvas.scrollTop;
    let clientX = e.clientX;

    // Try to snap to alignment line
    const snapPoint = snapToAlignmentLine(x);
    if (snapPoint) {
        x = snapPoint.x;
        clientX = rect.left + snapPoint.x - canvas.scrollLeft;
    }

    app.isMeasuring = true;
    app.measureStart = { x, y, clientX, clientY: e.clientY, snapped: !!snapPoint };
    app.measureEnd = { x, y, clientX, clientY: e.clientY, snapped: !!snapPoint };

    // Show measurement overlay
    const overlay = document.getElementById('measurement-overlay');
    overlay.classList.add('active');

    updateMeasurementDisplay();
    e.preventDefault();
}

function updateMeasurement(e) {
    if (!app.isMeasuring) return;

    const canvas = app.elements.lanesCanvas;
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left + canvas.scrollLeft;
    const y = e.clientY - rect.top + canvas.scrollTop;
    let clientX = e.clientX;

    // Try to snap to alignment line
    const snapPoint = snapToAlignmentLine(x);
    if (snapPoint) {
        x = snapPoint.x;
        clientX = rect.left + snapPoint.x - canvas.scrollLeft;
    }

    app.measureEnd = { x, y, clientX, clientY: e.clientY, snapped: !!snapPoint };
    updateMeasurementDisplay();
}

function endMeasurement() {
    if (!app.isMeasuring) return;

    app.isMeasuring = false;

    // If pinned, keep visible; otherwise fade after delay
    if (!app.measurePinned) {
        setTimeout(() => {
            if (!app.isMeasuring && !app.measurePinned) {
                const overlay = document.getElementById('measurement-overlay');
                overlay.classList.remove('active');
            }
        }, 2000);
    }
}

function toggleMeasurementPin() {
    app.measurePinned = !app.measurePinned;
    const overlay = document.getElementById('measurement-overlay');
    const infoBox = document.getElementById('measurement-info');

    if (app.measurePinned) {
        overlay.classList.add('pinned');
        infoBox.classList.add('pinned');
    } else {
        overlay.classList.remove('pinned');
        infoBox.classList.remove('pinned');
        // Fade out after unpinning
        setTimeout(() => {
            if (!app.isMeasuring && !app.measurePinned) {
                overlay.classList.remove('active');
            }
        }, 2000);
    }

    // Update pin button state
    const pinBtn = infoBox.querySelector('.measure-pin-btn');
    if (pinBtn) {
        pinBtn.classList.toggle('active', app.measurePinned);
        pinBtn.title = app.measurePinned ? 'Unpin measurement' : 'Pin measurement';
    }
}

function closeMeasurement() {
    app.isMeasuring = false;
    app.measurePinned = false;
    app.measureStart = null;
    app.measureEnd = null;
    const overlay = document.getElementById('measurement-overlay');
    const infoBox = document.getElementById('measurement-info');
    overlay.classList.remove('active', 'pinned');
    infoBox.classList.remove('pinned');
}

function restorePinnedMeasurement() {
    // First close any existing measurement
    closeMeasurement();

    // Check if there's measurement data to restore
    if (!app.pinnedMeasurementData) return;

    const canvas = app.elements.lanesCanvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const laneLabelWidth = 160;

    // Restore measurement coordinates
    const startX = app.pinnedMeasurementData.startX;
    const endX = app.pinnedMeasurementData.endX;

    // Calculate Y position (center of lanes area)
    const lanesAreaHeight = app.diagram.lanes.length * 50; // 50px per lane
    const y = lanesAreaHeight / 2;

    // Convert canvas X to client X
    const clientStartX = rect.left + startX - canvas.scrollLeft;
    const clientEndX = rect.left + endX - canvas.scrollLeft;
    const clientY = rect.top + y - canvas.scrollTop;

    app.measureStart = { x: startX, y: y, clientX: clientStartX, clientY: clientY, snapped: false };
    app.measureEnd = { x: endX, y: y, clientX: clientEndX, clientY: clientY, snapped: false };
    app.measurePinned = true;

    // Show measurement overlay
    const overlay = document.getElementById('measurement-overlay');
    overlay.classList.add('active', 'pinned');

    // Update display
    updateMeasurementDisplay();

    // Clear the stored data
    app.pinnedMeasurementData = null;
}

function updateMeasurementDisplay() {
    const overlay = document.getElementById('measurement-overlay');
    const line = document.getElementById('measurement-line');
    const label = document.getElementById('measurement-label');

    if (!app.measureStart || !app.measureEnd) return;

    const startX = app.measureStart.clientX;
    const startY = app.measureStart.clientY;
    const endX = app.measureEnd.clientX;
    const endY = app.measureEnd.clientY;

    // Calculate distance in pixels and time
    const pixelDistX = Math.abs(endX - startX);
    const pixelDistY = Math.abs(endY - startY);
    const timeDistance = pixelsToMs(pixelDistX);

    // Update SVG line
    const svgRect = overlay.getBoundingClientRect();
    const x1 = startX - svgRect.left;
    const y1 = startY - svgRect.top;
    const x2 = endX - svgRect.left;
    const y2 = endY - svgRect.top;

    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);

    // Update label position and content
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    label.setAttribute('x', midX);
    label.setAttribute('y', midY - 10);

    // Format the measurement text
    const timeText = formatDuration(Math.round(timeDistance));
    label.textContent = timeText;

    // Update info box
    const infoBox = document.getElementById('measurement-info');
    const startTimeMs = pixelsToMs(Math.min(app.measureStart.x, app.measureEnd.x) - 160); // Subtract lane label width
    const endTimeMs = startTimeMs + timeDistance;

    const pinBtnClass = app.measurePinned ? 'measure-pin-btn active' : 'measure-pin-btn';
    const pinTitle = app.measurePinned ? 'Unpin measurement' : 'Pin measurement';

    infoBox.innerHTML = `
        <div class="measure-header">
            <button class="${pinBtnClass}" onclick="toggleMeasurementPin()" title="${pinTitle}">📌</button>
            <button class="measure-close-btn" onclick="closeMeasurement()" title="Close measurement">×</button>
        </div>
        <div class="measure-row"><span>Duration:</span><strong>${timeText}</strong></div>
        <div class="measure-row"><span>Start:</span>${formatDuration(Math.max(0, Math.round(startTimeMs)))}</div>
        <div class="measure-row"><span>End:</span>${formatDuration(Math.max(0, Math.round(endTimeMs)))}</div>
    `;

    // Position info box below the measurement line
    infoBox.style.left = `${Math.min(endX, startX) + 20}px`;
    infoBox.style.top = `${Math.max(endY, startY) + 20}px`;
}

function handleZoom(direction) {
    const factor = direction === 'in' ? 1.25 : 0.8;
    app.pixelsPerMs = Math.max(app.minPixelsPerMs,
        Math.min(app.maxPixelsPerMs, app.pixelsPerMs * factor));

    const zoomPercent = Math.round((app.pixelsPerMs / 0.15) * 100);
    app.elements.zoomLevel.textContent = `${zoomPercent}%`;

    renderLanesCanvas();
}

function handleZoomFit() {
    const totalDuration = app.diagram.getTotalDuration();
    if (totalDuration === 0) return;

    const canvasWidth = app.elements.lanesCanvas.clientWidth - 180; // Account for lane label
    app.pixelsPerMs = Math.max(app.minPixelsPerMs,
        Math.min(app.maxPixelsPerMs, canvasWidth / (totalDuration * 1.1)));

    const zoomPercent = Math.round((app.pixelsPerMs / 0.15) * 100);
    app.elements.zoomLevel.textContent = `${zoomPercent}%`;

    renderLanesCanvas();
}

// =====================================================
// Properties Panel Handlers
// =====================================================
function handleBoxPropertyChange() {
    if (!app.selectedBoxId) return;
    if (app.diagram.locked) return; // Silent fail for property changes when locked

    const updates = {
        label: app.elements.boxLabel.value,
        color: app.elements.boxColor.value,
        startOffset: parseInt(app.elements.boxStart.value, 10) || 0,
        duration: Math.max(1, parseInt(app.elements.boxDuration.value, 10) || 100)
    };

    app.diagram.updateBox(app.selectedBoxId, updates);
    renderLanesCanvas();
    updateTotalDuration();
    updatePropertiesPanel();

    // Re-select to keep selection visible
    selectBox(app.selectedBoxId);
}

function handleDeleteBox() {
    if (!app.selectedBoxId) return;
    if (!isEditingAllowed()) return;

    app.diagram.removeBox(app.selectedBoxId);
    deselectBox();
    renderLanesCanvas();
    updateTotalDuration();
}

// =====================================================
// Export/Import Functions
// =====================================================
function saveToJSON() {
    const data = app.diagram.toJSON();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${app.diagram.title.replace(/[^a-z0-9]/gi, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadFromJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // Create a new diagram instead of overwriting current
            currentDiagramId = generateDiagramId();
            app.diagram = new TimelineDiagram();
            app.diagram.fromJSON(data);

            app.elements.diagramTitle.value = app.diagram.title;
            app.elements.startTime.value = app.diagram.startTime;

            deselectBox();
            renderLaneList();
            renderLanesCanvas();
            renderTimelineRuler();
            renderTimeMarkers();
            renderAlignmentMarkers();
            updateTotalDuration();
            saveCurrentDiagram();
            renderDiagramsList();

            // Restore pinned measurement if present
            restorePinnedMeasurement();

            showToast({
                type: 'success',
                title: 'Loaded',
                message: `"${app.diagram.title}" imported as new diagram.`,
                duration: 2500
            });
        } catch (err) {
            showToast({
                type: 'error',
                title: 'Load Failed',
                message: err.message
            });
        }
    };
    reader.readAsText(file);
}

// =====================================================
// URL Sharing Functions
// =====================================================
function encodeToURL() {
    const data = app.diagram.toJSON();
    const json = JSON.stringify(data);
    // Use base64 encoding, then make it URL-safe
    const base64 = btoa(unescape(encodeURIComponent(json)));
    return base64;
}

function decodeFromURL(encoded) {
    try {
        // Decode URL-safe base64
        const json = decodeURIComponent(escape(atob(encoded)));
        return JSON.parse(json);
    } catch (err) {
        console.error('Failed to decode URL data:', err);
        return null;
    }
}

function loadFromURL() {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('d');
    if (encoded) {
        const data = decodeFromURL(encoded);
        if (data) {
            app.diagram.fromJSON(data);
            // Schedule measurement restore after initial render
            setTimeout(() => restorePinnedMeasurement(), 100);
            return true;
        }
    }
    return false;
}

function shareAsURL() {
    const encoded = encodeToURL();
    const url = `${window.location.origin}${window.location.pathname}?d=${encoded}`;

    // Check URL length (browsers have limits, typically ~2000 chars)
    if (url.length > 8000) {
        showToast({
            type: 'warning',
            title: 'Diagram Too Large',
            message: 'Use Save/Load to share large diagrams.'
        });
        return;
    }

    // Copy to clipboard
    navigator.clipboard.writeText(url).then(() => {
        // Show brief success message
        const btn = document.getElementById('share-url');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = 'var(--success)';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 1500);
    }).catch(err => {
        // Fallback: show URL in prompt
        prompt('Copy this URL to share:', url);
    });
}

// Helper function to wrap text in canvas
function wrapText(ctx, text, maxWidth, lineHeight) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (let word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    return lines;
}

function exportToPNG() {
    // Use manual canvas rendering for full control
    const lanes = app.diagram.lanes;
    const boxes = app.diagram.boxes;

    const scale = 2; // High DPI
    const headerHeight = 50;
    const laneHeight = 50;
    const laneLabelWidth = 160;
    const rulerHeight = 40;
    const footerHeight = 40;
    const totalDuration = Math.max(app.diagram.getTotalDuration() * 1.1, 1000);
    const width = laneLabelWidth + msToPixels(totalDuration) + 50;
    const lanesAreaHeight = lanes.length * laneHeight;
    const lanesStartY = headerHeight + rulerHeight;

    // Pre-calculate time markers layout to determine height
    const markers = [];
    boxes.forEach(box => {
        markers.push({
            time: box.startOffset,
            type: 'start',
            color: box.color,
            label: formatDuration(box.startOffset)
        });
        markers.push({
            time: box.startOffset + box.duration,
            type: 'end',
            color: box.color,
            label: formatDuration(box.startOffset + box.duration)
        });
    });
    markers.sort((a, b) => a.time - b.time);

    // Pre-calculate marker levels
    const levels = [];
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = '9px Monaco, monospace';

    markers.forEach(m => {
        const x = laneLabelWidth + msToPixels(m.time);
        const text = `${m.type === 'start' ? 'S' : 'E'}: ${m.label}`;
        const textWidth = tempCtx.measureText(text).width + 10;
        const startX = x - (textWidth / 2);
        const endX = startX + textWidth;

        let level = 0;
        let placed = false;
        while (!placed) {
            if (!levels[level] || levels[level] < startX) {
                levels[level] = endX;
                m.level = level;
                m.text = text;
                m.x = x;
                placed = true;
            } else {
                level++;
            }
            if (level > 10) { m.level = level; m.text = text; m.x = x; placed = true; }
        }
    });

    const maxLevel = markers.length > 0 ? Math.max(...markers.map(m => m.level)) : 0;
    const timeMarkersHeight = Math.max(30, (maxLevel + 1) * 14 + 10);
    const timeMarkersY = lanesStartY + lanesAreaHeight;

    // Now calculate total height
    const height = headerHeight + rulerHeight + lanesAreaHeight + timeMarkersHeight + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = '#0f1419';
    ctx.fillRect(0, 0, width, height);

    // Header background
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, 0, width, headerHeight);

    // Header: Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 16px Inter, sans-serif';
    ctx.fillText(app.diagram.title, 16, 32);

    // Header: Start Time (right aligned)
    ctx.fillStyle = '#a8b2c1';
    ctx.font = '13px Monaco, monospace';
    const startTimeText = `Start: ${app.diagram.startTime}`;
    const startTimeWidth = ctx.measureText(startTimeText).width;
    ctx.fillText(startTimeText, width - startTimeWidth - 16, 32);

    // Header divider
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(width, headerHeight);
    ctx.stroke();

    // Ruler background
    const rulerY = headerHeight;
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, rulerY, width, rulerHeight);

    // Ruler marks
    ctx.font = '11px Monaco, monospace';
    ctx.fillStyle = '#a8b2c1';
    for (let time = 0; time <= totalDuration; time += 500) {
        const x = laneLabelWidth + msToPixels(time);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.moveTo(x, rulerY);
        ctx.lineTo(x, rulerY + rulerHeight);
        ctx.stroke();
        ctx.fillText(formatDuration(time), x + 4, rulerY + rulerHeight - 8);
    }

    // Draw lanes backgrounds first (so alignment lines can be drawn on top)
    lanes.forEach((lane, index) => {
        const y = lanesStartY + (index * laneHeight);
        ctx.fillStyle = index % 2 === 0 ? '#0f1419' : '#101520';
        ctx.fillRect(laneLabelWidth, y, width - laneLabelWidth, laneHeight);
    });

    // Draw alignment lines if enabled
    if (app.settings.showAlignmentLines && boxes.length > 0) {
        const timePoints = new Set();
        boxes.forEach(box => {
            timePoints.add(box.startOffset);
            timePoints.add(box.startOffset + box.duration);
        });

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;

        timePoints.forEach(time => {
            const x = laneLabelWidth + msToPixels(time);
            ctx.beginPath();
            ctx.moveTo(x, lanesStartY);
            ctx.lineTo(x, lanesStartY + lanesAreaHeight);
            ctx.stroke();
        });

        ctx.setLineDash([]);
    }

    // Draw lane labels and boxes
    lanes.forEach((lane, index) => {
        const y = lanesStartY + (index * laneHeight);

        // Lane label background
        ctx.fillStyle = '#1a1f2e';
        ctx.fillRect(0, y, laneLabelWidth, laneHeight);

        // Lane dividers
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(laneLabelWidth, y);
        ctx.lineTo(laneLabelWidth, y + laneHeight);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, y + laneHeight);
        ctx.lineTo(width, y + laneHeight);
        ctx.stroke();

        // Lane label text with word wrap
        ctx.fillStyle = '#ffffff';
        ctx.font = '13px Inter, sans-serif';
        const maxLabelWidth = laneLabelWidth - 24;
        const lines = wrapText(ctx, lane.name, maxLabelWidth, 16);
        const totalTextHeight = lines.length * 16;
        const startTextY = y + (laneHeight - totalTextHeight) / 2 + 12;
        lines.forEach((line, lineIndex) => {
            ctx.fillText(line, 12, startTextY + lineIndex * 16);
        });

        // Boxes for this lane
        const laneBoxes = boxes.filter(b => b.laneId === lane.id);
        laneBoxes.forEach(box => {
            const bx = laneLabelWidth + msToPixels(box.startOffset);
            const by = y + 6;
            const bw = Math.max(msToPixels(box.duration), 20);
            const bh = laneHeight - 12;

            ctx.fillStyle = box.color;
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, bh, 4);
            ctx.fill();

            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            const labelText = box.label ? `${box.label} (${formatDuration(box.duration)})` : formatDuration(box.duration);
            ctx.fillStyle = getContrastColor(box.color);
            ctx.font = '500 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(labelText, bx + bw / 2, by + bh / 2 + 4, bw - 8);
            ctx.textAlign = 'left';

            // Draw floating label if enabled
            if (app.settings.showBoxLabels) {
                const floatingText = box.label ? `${box.label}: ${formatDuration(box.duration)}` : formatDuration(box.duration);
                ctx.font = '500 10px Inter, sans-serif';
                const textWidth = ctx.measureText(floatingText).width;
                const labelPadX = 6;
                const labelPadY = 3;
                const labelW = textWidth + labelPadX * 2;
                const labelH = 14;
                const labelX = bx + bw / 2 - labelW / 2;
                const labelY = by - labelH - 6;

                // Label background
                ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
                ctx.beginPath();
                ctx.roundRect(labelX, labelY, labelW, labelH, 3);
                ctx.fill();

                // Arrow pointing down
                ctx.beginPath();
                ctx.moveTo(bx + bw / 2 - 4, labelY + labelH);
                ctx.lineTo(bx + bw / 2 + 4, labelY + labelH);
                ctx.lineTo(bx + bw / 2, labelY + labelH + 4);
                ctx.closePath();
                ctx.fill();

                // Label text
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(floatingText, bx + bw / 2, labelY + labelH - labelPadY);
                ctx.textAlign = 'left';
            }
        });
    });

    // Time markers area background
    ctx.fillStyle = '#0f1419';
    ctx.fillRect(laneLabelWidth, timeMarkersY, width - laneLabelWidth, timeMarkersHeight);
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, timeMarkersY, laneLabelWidth, timeMarkersHeight);

    // Draw time markers
    ctx.font = '9px Monaco, monospace';
    markers.forEach(m => {
        const yPos = timeMarkersY + timeMarkersHeight - 6 - (m.level * 14);

        // Draw tick line
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(m.x, timeMarkersY + 2);
        ctx.lineTo(m.x, yPos - 6);
        ctx.stroke();

        // Draw label
        ctx.fillStyle = m.color;
        ctx.textAlign = 'center';
        ctx.fillText(m.text, m.x, yPos);
    });
    ctx.textAlign = 'left';

    // Draw pinned measurement if active
    if (app.measurePinned && app.measureStart && app.measureEnd) {
        const measureColor = '#39FF14';
        const canvas_rect = app.elements.lanesCanvas.getBoundingClientRect();

        // Convert client coordinates to export coordinates
        const startXCanvas = app.measureStart.x;
        const endXCanvas = app.measureEnd.x;

        // Map canvas X to export X (accounting for lane label width difference)
        const exportStartX = laneLabelWidth + (startXCanvas - 160); // 160 is the lane label width in app
        const exportEndX = laneLabelWidth + (endXCanvas - 160);

        // Y position - center in lanes area
        const measureY = lanesStartY + lanesAreaHeight / 2;

        // Draw measurement line
        ctx.strokeStyle = measureColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(exportStartX, measureY);
        ctx.lineTo(exportEndX, measureY);
        ctx.stroke();

        // Draw start marker (vertical line)
        ctx.beginPath();
        ctx.moveTo(exportStartX, measureY - 5);
        ctx.lineTo(exportStartX, measureY + 5);
        ctx.stroke();

        // Draw end marker (arrow + vertical line)
        const arrowDir = exportEndX > exportStartX ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(exportEndX + arrowDir * 6, measureY - 3);
        ctx.lineTo(exportEndX, measureY);
        ctx.lineTo(exportEndX + arrowDir * 6, measureY + 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(exportEndX, measureY - 5);
        ctx.lineTo(exportEndX, measureY + 5);
        ctx.stroke();

        // Draw measurement label
        const pixelDistX = Math.abs(exportEndX - exportStartX);
        const timeDistance = pixelsToMs(Math.abs(endXCanvas - startXCanvas));
        const measureText = formatDuration(Math.round(timeDistance));
        const midX = (exportStartX + exportEndX) / 2;

        ctx.fillStyle = measureColor;
        ctx.font = '600 14px Monaco, monospace';
        ctx.textAlign = 'center';

        // Draw text background
        const textWidth = ctx.measureText(measureText).width + 8;
        ctx.fillStyle = '#0f1419';
        ctx.fillRect(midX - textWidth / 2, measureY - 22, textWidth, 16);

        ctx.fillStyle = measureColor;
        ctx.fillText(measureText, midX, measureY - 10);
        ctx.textAlign = 'left';
    }

    // Footer
    const footerY = timeMarkersY + timeMarkersHeight;
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, footerY, laneLabelWidth, footerHeight);
    ctx.fillStyle = '#252b3b';
    ctx.fillRect(laneLabelWidth, footerY, width - laneLabelWidth, footerHeight);

    ctx.fillStyle = '#a8b2c1';
    ctx.font = '600 12px Monaco, monospace';
    ctx.fillText('TOTAL DURATION:', laneLabelWidth + 16, footerY + 26);
    ctx.fillStyle = '#6366f1';
    ctx.fillText(formatDuration(app.diagram.getTotalDuration()), laneLabelWidth + 140, footerY + 26);

    // UCS branding
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Made by UCS with 💙', width - 16, footerY + 26);
    ctx.textAlign = 'left';

    // Download
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${app.diagram.title.replace(/[^a-z0-9]/gi, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Helper function to wrap text for SVG (returns array of lines)
function wrapTextSVG(text, maxWidth, charWidth) {
    const maxChars = Math.floor(maxWidth / charWidth);
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (let word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (testLine.length > maxChars && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    return lines;
}

function exportToSVG() {
    const lanes = app.diagram.lanes;
    const boxes = app.diagram.boxes;

    const headerHeight = 50;
    const laneHeight = 50;
    const laneLabelWidth = 160;
    const rulerHeight = 40;
    const footerHeight = 40;
    const totalDuration = Math.max(app.diagram.getTotalDuration() * 1.1, 1000);
    const width = Math.round(laneLabelWidth + msToPixels(totalDuration) + 50);
    const lanesAreaHeight = lanes.length * laneHeight;
    const lanesStartY = headerHeight + rulerHeight;

    // Pre-calculate time markers layout (same as PNG)
    const markers = [];
    boxes.forEach(box => {
        markers.push({
            time: box.startOffset,
            type: 'start',
            color: box.color,
            label: formatDuration(box.startOffset)
        });
        markers.push({
            time: box.startOffset + box.duration,
            type: 'end',
            color: box.color,
            label: formatDuration(box.startOffset + box.duration)
        });
    });
    markers.sort((a, b) => a.time - b.time);

    // Calculate marker levels
    const levels = [];
    const charWidth = 6;
    markers.forEach(m => {
        const x = laneLabelWidth + msToPixels(m.time);
        const text = `${m.type === 'start' ? 'S' : 'E'}: ${m.label}`;
        const textWidth = text.length * charWidth + 10;
        const startX = x - (textWidth / 2);
        const endX = startX + textWidth;

        let level = 0;
        let placed = false;
        while (!placed) {
            if (!levels[level] || levels[level] < startX) {
                levels[level] = endX;
                m.level = level;
                m.text = text;
                m.x = x;
                placed = true;
            } else {
                level++;
            }
            if (level > 10) { m.level = level; m.text = text; m.x = x; placed = true; }
        }
    });

    const maxLevel = markers.length > 0 ? Math.max(...markers.map(m => m.level)) : 0;
    const timeMarkersHeight = Math.max(30, (maxLevel + 1) * 14 + 10);
    const timeMarkersY = lanesStartY + lanesAreaHeight;
    const height = headerHeight + rulerHeight + lanesAreaHeight + timeMarkersHeight + footerHeight;

    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .title-text { font-family: 'Inter', -apple-system, sans-serif; font-size: 16px; font-weight: 600; fill: #ffffff; }
      .start-time-text { font-family: 'Monaco', 'Menlo', monospace; font-size: 13px; fill: #a8b2c1; }
      .lane-label { font-family: 'Inter', -apple-system, sans-serif; font-size: 13px; fill: #ffffff; }
      .ruler-text { font-family: 'Monaco', 'Menlo', monospace; font-size: 11px; fill: #a8b2c1; }
      .box-text { font-family: 'Inter', -apple-system, sans-serif; font-size: 12px; font-weight: 500; }
      .time-marker { font-family: 'Monaco', 'Menlo', monospace; font-size: 9px; }
      .footer-text { font-family: 'Monaco', 'Menlo', monospace; font-size: 12px; font-weight: 600; fill: #a8b2c1; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="#0f1419"/>

  <!-- Header -->
  <rect x="0" y="0" width="${width}" height="${headerHeight}" fill="#1a1f2e"/>
  <text x="16" y="32" class="title-text">${escapeHtml(app.diagram.title)}</text>
  <text x="${width - 16}" y="32" text-anchor="end" class="start-time-text">Start: ${escapeHtml(app.diagram.startTime)}</text>
  <line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="rgba(255,255,255,0.1)"/>

  <!-- Ruler -->
  <rect x="0" y="${headerHeight}" width="${width}" height="${rulerHeight}" fill="#1a1f2e"/>
`;

    const rulerY = headerHeight;

    // Ruler marks
    for (let time = 0; time <= totalDuration; time += 500) {
        const x = Math.round(laneLabelWidth + msToPixels(time));
        svg += `  <line x1="${x}" y1="${rulerY}" x2="${x}" y2="${rulerY + rulerHeight}" stroke="rgba(255,255,255,0.1)"/>\n`;
        svg += `  <text x="${x + 4}" y="${rulerY + rulerHeight - 8}" class="ruler-text">${formatDuration(time)}</text>\n`;
    }

    // Lane backgrounds first
    lanes.forEach((lane, index) => {
        const y = lanesStartY + (index * laneHeight);
        svg += `  <rect x="${laneLabelWidth}" y="${y}" width="${width - laneLabelWidth}" height="${laneHeight}" fill="${index % 2 === 0 ? '#0f1419' : '#101520'}"/>\n`;
    });

    // Alignment lines if enabled
    if (app.settings.showAlignmentLines && boxes.length > 0) {
        const timePoints = new Set();
        boxes.forEach(box => {
            timePoints.add(box.startOffset);
            timePoints.add(box.startOffset + box.duration);
        });

        svg += `  <!-- Alignment Lines -->\n`;
        timePoints.forEach(time => {
            const x = Math.round(laneLabelWidth + msToPixels(time));
            svg += `  <line x1="${x}" y1="${lanesStartY}" x2="${x}" y2="${lanesStartY + lanesAreaHeight}" stroke="#ffffff" stroke-opacity="0.4" stroke-dasharray="4 4"/>\n`;
        });
    }

    // Lane labels and boxes
    lanes.forEach((lane, index) => {
        const y = lanesStartY + (index * laneHeight);

        svg += `  <!-- Lane: ${escapeHtml(lane.name)} -->\n`;
        svg += `  <rect x="0" y="${y}" width="${laneLabelWidth}" height="${laneHeight}" fill="#1a1f2e"/>\n`;
        svg += `  <line x1="${laneLabelWidth}" y1="${y}" x2="${laneLabelWidth}" y2="${y + laneHeight}" stroke="rgba(255,255,255,0.1)"/>\n`;
        svg += `  <line x1="0" y1="${y + laneHeight}" x2="${width}" y2="${y + laneHeight}" stroke="rgba(255,255,255,0.1)"/>\n`;

        // Lane label with word wrap
        const labelLines = wrapTextSVG(lane.name, laneLabelWidth - 24, 8);
        const lineHeight = 16;
        const totalTextHeight = labelLines.length * lineHeight;
        const startTextY = y + (laneHeight - totalTextHeight) / 2 + 12;
        labelLines.forEach((line, lineIndex) => {
            svg += `  <text x="12" y="${startTextY + lineIndex * lineHeight}" class="lane-label">${escapeHtml(line)}</text>\n`;
        });

        // Boxes for this lane
        const laneBoxes = boxes.filter(b => b.laneId === lane.id);
        laneBoxes.forEach(box => {
            const bx = Math.round(laneLabelWidth + msToPixels(box.startOffset));
            const by = y + 6;
            const bw = Math.max(Math.round(msToPixels(box.duration)), 20);
            const bh = laneHeight - 12;
            const textColor = getContrastColor(box.color);
            const labelText = box.label ? `${box.label} (${formatDuration(box.duration)})` : formatDuration(box.duration);

            svg += `  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${box.color}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>\n`;
            svg += `  <text x="${bx + bw / 2}" y="${by + bh / 2 + 4}" text-anchor="middle" class="box-text" fill="${textColor}">${escapeHtml(labelText)}</text>\n`;

            // Draw floating label if enabled
            if (app.settings.showBoxLabels) {
                const floatingText = box.label ? `${box.label}: ${formatDuration(box.duration)}` : formatDuration(box.duration);
                const labelW = floatingText.length * 6 + 12;
                const labelH = 14;
                const labelX = bx + bw / 2 - labelW / 2;
                const labelY = by - labelH - 6;

                svg += `  <rect x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" rx="3" fill="rgba(0,0,0,0.85)"/>\n`;
                svg += `  <polygon points="${bx + bw / 2 - 4},${labelY + labelH} ${bx + bw / 2 + 4},${labelY + labelH} ${bx + bw / 2},${labelY + labelH + 4}" fill="rgba(0,0,0,0.85)"/>\n`;
                svg += `  <text x="${bx + bw / 2}" y="${labelY + labelH - 3}" text-anchor="middle" style="font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 500; fill: #ffffff;">${escapeHtml(floatingText)}</text>\n`;
            }
        });
    });

    // Time markers area
    svg += `  <!-- Time Markers -->\n`;
    svg += `  <rect x="${laneLabelWidth}" y="${timeMarkersY}" width="${width - laneLabelWidth}" height="${timeMarkersHeight}" fill="#0f1419"/>\n`;
    svg += `  <rect x="0" y="${timeMarkersY}" width="${laneLabelWidth}" height="${timeMarkersHeight}" fill="#1a1f2e"/>\n`;

    // Draw time markers with colored labels (same as PNG)
    markers.forEach(m => {
        const yPos = timeMarkersY + timeMarkersHeight - 6 - (m.level * 14);
        // Tick line
        svg += `  <line x1="${Math.round(m.x)}" y1="${timeMarkersY + 2}" x2="${Math.round(m.x)}" y2="${yPos - 6}" stroke="${m.color}"/>\n`;
        // Label
        svg += `  <text x="${Math.round(m.x)}" y="${yPos}" text-anchor="middle" class="time-marker" fill="${m.color}">${m.text}</text>\n`;
    });

    // Draw pinned measurement if active
    if (app.measurePinned && app.measureStart && app.measureEnd) {
        const measureColor = '#39FF14';

        // Convert canvas coordinates to export coordinates
        const startXCanvas = app.measureStart.x;
        const endXCanvas = app.measureEnd.x;

        // Map canvas X to export X
        const exportStartX = Math.round(laneLabelWidth + (startXCanvas - 160));
        const exportEndX = Math.round(laneLabelWidth + (endXCanvas - 160));

        // Y position - center in lanes area
        const measureY = lanesStartY + lanesAreaHeight / 2;

        svg += `  <!-- Pinned Measurement -->\n`;

        // Measurement line
        svg += `  <line x1="${exportStartX}" y1="${measureY}" x2="${exportEndX}" y2="${measureY}" stroke="${measureColor}" stroke-width="1.5"/>\n`;

        // Start marker (vertical line)
        svg += `  <line x1="${exportStartX}" y1="${measureY - 5}" x2="${exportStartX}" y2="${measureY + 5}" stroke="${measureColor}" stroke-width="1.5"/>\n`;

        // End marker (arrow + vertical line)
        const arrowDir = exportEndX > exportStartX ? -1 : 1;
        svg += `  <path d="M${exportEndX + arrowDir * 6},${measureY - 3} L${exportEndX},${measureY} L${exportEndX + arrowDir * 6},${measureY + 3}" fill="none" stroke="${measureColor}" stroke-width="1.5"/>\n`;
        svg += `  <line x1="${exportEndX}" y1="${measureY - 5}" x2="${exportEndX}" y2="${measureY + 5}" stroke="${measureColor}" stroke-width="1.5"/>\n`;

        // Measurement label
        const timeDistance = pixelsToMs(Math.abs(endXCanvas - startXCanvas));
        const measureText = formatDuration(Math.round(timeDistance));
        const midX = (exportStartX + exportEndX) / 2;
        const textWidth = measureText.length * 8 + 8;

        // Text background
        svg += `  <rect x="${midX - textWidth / 2}" y="${measureY - 22}" width="${textWidth}" height="16" fill="#0f1419"/>\n`;
        // Text
        svg += `  <text x="${midX}" y="${measureY - 10}" text-anchor="middle" style="font-family: 'Monaco', 'Menlo', monospace; font-size: 14px; font-weight: 600; fill: ${measureColor};">${measureText}</text>\n`;
    }

    // Footer
    const footerY = timeMarkersY + timeMarkersHeight;
    svg += `  <!-- Footer -->\n`;
    svg += `  <rect x="0" y="${footerY}" width="${laneLabelWidth}" height="${footerHeight}" fill="#1a1f2e"/>\n`;
    svg += `  <rect x="${laneLabelWidth}" y="${footerY}" width="${width - laneLabelWidth}" height="${footerHeight}" fill="#252b3b"/>\n`;
    svg += `  <text x="${laneLabelWidth + 16}" y="${footerY + 26}" class="footer-text">TOTAL DURATION: <tspan fill="#6366f1">${formatDuration(app.diagram.getTotalDuration())}</tspan></text>\n`;
    svg += `  <text x="${width - 16}" y="${footerY + 26}" text-anchor="end" style="font-family: 'Inter', sans-serif; font-size: 11px; fill: #6b7280;">Made by UCS with 💙</text>\n`;
    svg += `</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${app.diagram.title.replace(/[^a-z0-9]/gi, '_')}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =====================================================
// Lane Properties Panel Functions
// =====================================================
function showLanePropertiesPanel(laneId) {
    const panel = app.elements.propertiesPanel;
    const boxProps = document.getElementById('box-props');
    const laneProps = document.getElementById('lane-props');
    const settingsProps = document.getElementById('settings-props');
    const propsTitle = document.getElementById('props-title');

    const lane = app.diagram.lanes.find(l => l.id === parseInt(laneId));
    if (!lane) return;

    // Hide box and settings properties, show lane properties
    if (boxProps) boxProps.classList.add('hidden');
    if (laneProps) laneProps.classList.remove('hidden');
    if (settingsProps) settingsProps.classList.add('hidden');
    if (propsTitle) propsTitle.textContent = 'Lane Properties';

    // Deselect any box
    app.selectedBoxId = null;
    app.selectedLaneId = laneId;
    document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));

    // Set current lane name
    const laneNameInput = document.getElementById('lane-name');
    if (laneNameInput) {
        laneNameInput.value = lane.name;
    }

    // Generate lane palette swatches
    const lanePalette = document.getElementById('lane-palette');
    if (lanePalette) {
        lanePalette.innerHTML = '';
        PALETTE.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'palette-swatch';
            swatch.style.backgroundColor = color;
            swatch.title = color;
            if (lane.baseColor === color) {
                swatch.classList.add('selected');
            }
            swatch.addEventListener('click', () => {
                setLaneColor(laneId, color);
                // Update selected state
                lanePalette.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
            });
            lanePalette.appendChild(swatch);
        });
    }

    panel.classList.remove('hidden');
}

function handleLaneNameChange() {
    if (!app.selectedLaneId) return;
    const laneNameInput = document.getElementById('lane-name');
    if (laneNameInput) {
        app.diagram.renameLane(app.selectedLaneId, laneNameInput.value);
        renderLaneList();
        renderLanesCanvas();
    }
}

// =====================================================
// Settings Panel Functions
// =====================================================
function showSettingsPanel() {
    const panel = app.elements.propertiesPanel;
    const boxProps = document.getElementById('box-props');
    const laneProps = document.getElementById('lane-props');
    const settingsProps = document.getElementById('settings-props');
    const propsTitle = document.getElementById('props-title');

    // Hide box and lane properties, show settings
    if (boxProps) boxProps.classList.add('hidden');
    if (laneProps) laneProps.classList.add('hidden');
    if (settingsProps) settingsProps.classList.remove('hidden');
    if (propsTitle) propsTitle.textContent = 'Global Settings';

    // Set current values
    const pageTitleInput = document.getElementById('config-page-title');
    if (pageTitleInput) {
        pageTitleInput.value = app.diagram.title;
    }

    const thresholdSelect = document.getElementById('config-time-threshold');
    if (thresholdSelect) {
        thresholdSelect.value = app.settings.timeFormatThreshold.toString();
    }

    const alignmentCheckbox = document.getElementById('config-show-alignment');
    if (alignmentCheckbox) {
        alignmentCheckbox.checked = app.settings.showAlignmentLines;
    }

    const labelsCheckbox = document.getElementById('config-show-labels');
    if (labelsCheckbox) {
        labelsCheckbox.checked = app.settings.showBoxLabels;
    }

    const lockCheckbox = document.getElementById('config-lock-diagram');
    if (lockCheckbox) {
        lockCheckbox.checked = app.diagram.locked;
    }

    // Deselect any box/lane
    app.selectedBoxId = null;
    app.selectedLaneId = null;
    document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));

    panel.classList.remove('hidden');
}

function handleSettingsChange() {
    // Page title
    const pageTitleInput = document.getElementById('config-page-title');
    if (pageTitleInput) {
        app.diagram.title = pageTitleInput.value;
        app.elements.diagramTitle.value = pageTitleInput.value;
    }

    // Time format threshold
    const thresholdSelect = document.getElementById('config-time-threshold');
    if (thresholdSelect) {
        app.settings.timeFormatThreshold = parseInt(thresholdSelect.value, 10);
    }

    // Alignment lines toggle
    const alignmentCheckbox = document.getElementById('config-show-alignment');
    if (alignmentCheckbox) {
        app.settings.showAlignmentLines = alignmentCheckbox.checked;
    }

    // Box labels toggle
    const labelsCheckbox = document.getElementById('config-show-labels');
    if (labelsCheckbox) {
        app.settings.showBoxLabels = labelsCheckbox.checked;
        updateBoxLabelsState();
    }

    // Re-render to apply changes
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentMarkers();
    updateTotalDuration();
}

function updateBoxLabelsState() {
    if (app.settings.showBoxLabels) {
        document.body.classList.add('show-box-labels');
    } else {
        document.body.classList.remove('show-box-labels');
    }
}

function handleLockChange() {
    const lockCheckbox = document.getElementById('config-lock-diagram');
    if (lockCheckbox) {
        app.diagram.locked = lockCheckbox.checked;
        updateLockState();
        autoSave();
    }
}

function isEditingAllowed() {
    if (app.diagram.locked) {
        showToast({
            type: 'warning',
            title: 'Diagram Locked',
            message: 'Unlock in Settings to edit.',
            duration: 2000
        });
        return false;
    }
    return true;
}

function updateLockState() {
    const body = document.body;
    const lockIndicator = document.getElementById('lock-indicator');

    if (app.diagram.locked) {
        body.classList.add('diagram-locked');
        // Update title input to readonly
        app.elements.diagramTitle.readOnly = true;
        app.elements.startTime.readOnly = true;
    } else {
        body.classList.remove('diagram-locked');
        app.elements.diagramTitle.readOnly = false;
        app.elements.startTime.readOnly = false;
    }
}

// =====================================================
// Initialization
// =====================================================
function enterPickMode() {
    if (!app.selectedBoxId) return;
    if (!isEditingAllowed()) return;
    app.isPicking = true;
    document.body.style.cursor = 'crosshair';
    const btn = document.getElementById('pick-start-btn');
    if (btn) btn.classList.add('active');
}

function completePickStart(targetBoxId) {
    if (!app.selectedBoxId) {
        app.isPicking = false;
        document.body.style.cursor = '';
        return;
    }

    // Check if editing is allowed (diagram not locked)
    if (!isEditingAllowed()) {
        app.isPicking = false;
        document.body.style.cursor = '';
        const btn = document.getElementById('pick-start-btn');
        if (btn) btn.classList.remove('active');
        return;
    }

    const targetBox = app.diagram.boxes.find(b => b.id === targetBoxId);
    const myBox = app.diagram.boxes.find(b => b.id === app.selectedBoxId);

    if (targetBox && myBox) {
        myBox.startOffset = targetBox.startOffset + targetBox.duration;

        const boxEl = document.querySelector(`.timeline-box[data-box-id="${myBox.id}"]`);
        if (boxEl) {
            boxEl.style.left = `${msToPixels(myBox.startOffset)}px`;
        }
        updatePropertiesPanel();
        renderTimeMarkers();
        autoSave();
    }

    app.isPicking = false;
    document.body.style.cursor = '';
    const btn = document.getElementById('pick-start-btn');
    if (btn) btn.classList.remove('active');
}

function init() {
    // Create floating tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'box-tooltip';
    tooltip.className = 'box-tooltip';
    document.body.appendChild(tooltip);

    // Cache DOM elements
    app.elements = {
        diagramTitle: document.getElementById('diagram-title'),
        startTime: document.getElementById('start-time'),
        zoomLevel: document.getElementById('zoom-level'),
        laneList: document.getElementById('lane-list'),
        timelineRuler: document.getElementById('timeline-ruler'),
        lanesCanvas: document.getElementById('lanes-canvas'),
        timeMarkers: document.getElementById('time-markers'),
        timeMarkersContainer: document.querySelector('.time-markers-container'),
        totalDuration: document.getElementById('total-duration'),
        propertiesPanel: document.getElementById('properties-panel'),
        boxLabel: document.getElementById('box-label'),
        boxColor: document.getElementById('box-color'),
        boxStart: document.getElementById('box-start'),
        boxDuration: document.getElementById('box-duration'),
        boxEnd: document.getElementById('box-end'),
        boxTimeStart: document.getElementById('box-time-start'),
        boxTimeEnd: document.getElementById('box-time-end'),
        alignmentMarkers: document.getElementById('alignment-markers'),
        fileInput: document.getElementById('file-input'),
        tooltip: tooltip
    };

    // Header event listeners
    app.elements.diagramTitle.addEventListener('change', (e) => {
        app.diagram.title = e.target.value;
        autoSave();
        renderDiagramsList(); // Update title in list
    });

    app.elements.startTime.addEventListener('change', (e) => {
        app.diagram.startTime = e.target.value;
        updatePropertiesPanel();
        renderTimeMarkers(); // Update markers as start time changes
        autoSave();
    });

    // Synchronize scroll between canvas, ruler, and time markers
    app.elements.lanesCanvas.addEventListener('scroll', (e) => {
        app.elements.timelineRuler.scrollLeft = e.target.scrollLeft;
        if (app.elements.timeMarkers) {
            app.elements.timeMarkers.scrollLeft = e.target.scrollLeft;
        }
    });
    // Settings button
    document.getElementById('settings-btn').addEventListener('click', showSettingsPanel);

    // Settings change handlers
    const pageTitleInput = document.getElementById('config-page-title');
    if (pageTitleInput) {
        pageTitleInput.addEventListener('input', handleSettingsChange);
    }

    const thresholdSelect = document.getElementById('config-time-threshold');
    if (thresholdSelect) {
        thresholdSelect.addEventListener('change', handleSettingsChange);
    }

    const alignmentCheckbox = document.getElementById('config-show-alignment');
    if (alignmentCheckbox) {
        alignmentCheckbox.addEventListener('change', handleSettingsChange);
    }

    const labelsCheckbox = document.getElementById('config-show-labels');
    if (labelsCheckbox) {
        labelsCheckbox.addEventListener('change', handleSettingsChange);
    }

    const lockCheckbox = document.getElementById('config-lock-diagram');
    if (lockCheckbox) {
        lockCheckbox.addEventListener('change', handleLockChange);
    }

    // Also sync header title input changes to settings
    app.elements.diagramTitle.addEventListener('input', (e) => {
        app.diagram.title = e.target.value;
    });

    // Lane name change handler in properties panel
    const laneNameInput = document.getElementById('lane-name');
    if (laneNameInput) {
        laneNameInput.addEventListener('change', handleLaneNameChange);
    }

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => handleZoom('in'));
    document.getElementById('zoom-out').addEventListener('click', () => handleZoom('out'));
    document.getElementById('zoom-fit').addEventListener('click', handleZoomFit);

    // Export controls
    document.getElementById('save-json').addEventListener('click', saveToJSON);
    document.getElementById('load-json').addEventListener('click', () => app.elements.fileInput.click());
    app.elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            loadFromJSON(e.target.files[0]);
        }
    });
    document.getElementById('export-png').addEventListener('click', exportToPNG);
    document.getElementById('export-svg').addEventListener('click', exportToSVG);

    // Lane management
    document.getElementById('add-lane').addEventListener('click', () => {
        if (!isEditingAllowed()) return;
        const name = `Lane ${app.diagram.lanes.length + 1}`;
        app.diagram.addLane(name);
        renderLaneList();
        renderLanesCanvas();
    });

    // Properties panel
    app.elements.boxLabel.addEventListener('change', handleBoxPropertyChange);
    app.elements.boxColor.addEventListener('input', handleBoxPropertyChange);
    app.elements.boxStart.addEventListener('change', handleBoxPropertyChange);

    // Pick start button
    const pickBtn = document.getElementById('pick-start-btn');
    if (pickBtn) {
        pickBtn.addEventListener('click', enterPickMode);
    }

    // Generate Palette Swatches
    const paletteContainer = document.getElementById('color-palette');
    if (paletteContainer) {
        PALETTE.forEach(color => {
            const btn = document.createElement('div');
            btn.className = 'palette-swatch';
            btn.style.backgroundColor = color;
            btn.title = color;
            btn.addEventListener('click', () => {
                app.elements.boxColor.value = color;
                // Manually trigger property change
                if (app.selectedBoxId) {
                    // Since handleBoxPropertyChange expects an event with target
                    const mockEvent = { target: { id: 'box-color', value: color } };
                    handleBoxPropertyChange(mockEvent);
                }
            });
            paletteContainer.appendChild(btn);
        });
    }

    app.elements.boxDuration.addEventListener('change', handleBoxPropertyChange);

    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
            app.elements.boxColor.value = e.target.dataset.color;
            handleBoxPropertyChange();
        });
    });

    document.getElementById('close-properties').addEventListener('click', deselectBox);
    document.getElementById('delete-box').addEventListener('click', handleDeleteBox);

    // Global mouse events for dragging
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Measurement tool - Cmd/Ctrl + Left Click
    app.elements.lanesCanvas.addEventListener('mousedown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.button === 0) {
            startMeasurement(e);
            e.preventDefault();
            e.stopPropagation();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (app.isMeasuring) {
            updateMeasurement(e);
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (app.isMeasuring && e.button === 0) {
            endMeasurement();
        }
    });

    // Cancel measurement on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && app.isMeasuring) {
            app.isMeasuring = false;
            const overlay = document.getElementById('measurement-overlay');
            overlay.classList.remove('active');
        }
    });

    // Click outside to deselect
    app.elements.lanesCanvas.addEventListener('click', (e) => {
        if (e.target === app.elements.lanesCanvas || e.target.classList.contains('lane-row')) {
            deselectBox();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (app.selectedBoxId && document.activeElement.tagName !== 'INPUT') {
                handleDeleteBox();
            }
        }
        if (e.key === 'Escape') {
            deselectBox();
        }
    });

    // Window resize
    window.addEventListener('resize', () => {
        renderTimelineRuler();
        renderAlignmentMarkers();
    });

    // Share button
    document.getElementById('share-url').addEventListener('click', shareAsURL);

    // Purge Application button
    document.getElementById('purge-app-btn').addEventListener('click', purgeApplication);

    // Diagrams panel toggle
    document.getElementById('diagrams-toggle').addEventListener('click', toggleDiagramsPanel);

    // New diagram button
    document.getElementById('new-diagram-btn').addEventListener('click', createNewDiagram);

    // Try to load from URL first
    const loadedFromURL = loadFromURL();

    if (loadedFromURL) {
        // URL loaded - create new diagram ID for this shared diagram
        currentDiagramId = generateDiagramId();
        app.elements.diagramTitle.value = app.diagram.title;
        app.elements.startTime.value = app.diagram.startTime;
        saveCurrentDiagram();
    } else if (!loadMostRecentDiagram()) {
        // No saved diagrams - create new one
        currentDiagramId = generateDiagramId();
        app.diagram.addLane('Lane 1');
        saveCurrentDiagram();
    }

    // Initial render
    renderLaneList();
    renderLanesCanvas();
    renderDiagramsList();
    updateTotalDuration();
    updateBoxLabelsState();

    // Open diagrams panel by default if there are saved diagrams
    const diagrams = getAllDiagrams();
    if (diagrams.length > 0) {
        document.getElementById('diagrams-panel').classList.add('open');
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
