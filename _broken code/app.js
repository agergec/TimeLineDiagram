/* =====================================================
   Timeline Diagram Editor - Main Application Logic
   ===================================================== */

// =====================================================
// Data Model
// =====================================================
class Lane {
    constructor(id, name, order, color) {
        this.id = id;
        this.name = name;
        this.order = order;
        this.color = color;
    }
}

class TimelineDiagram {
    constructor() {
        this.title = 'Timeline Diagram';
        this.startTime = '00:00:00 000';
        this.lanes = [];
        this.boxes = [];
        this.nextLaneId = 1;
        this.nextBoxId = 1;
    }

    addLane(name) {
        // Assign color from palette based on order (will be shuffled)
        const color = PALETTE[this.lanes.length % PALETTE.length];
        const lane = new Lane(
            this.nextLaneId++,
            name,
            this.lanes.length,
            color
        );
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
        return {
            title: this.title,
            startTime: this.startTime,
            lanes: this.lanes,
            boxes: this.boxes,
            nextLaneId: this.nextLaneId,
            nextBoxId: this.nextBoxId,
            config: app.config // Persist settings
        };
    }

    fromJSON(data) {
        this.title = data.title || 'Timeline Diagram';
        this.startTime = data.startTime || '00:00:00 000';
        this.lanes = data.lanes || [];
        this.boxes = data.boxes || [];
        this.nextLaneId = data.nextLaneId || 1;
        this.nextBoxId = data.nextBoxId || 1;
        if (data.config) {
            app.config = { ...app.config, ...data.config };
        }
    }
}

// =====================================================
// Application State
// =====================================================
const PALETTE = [
    '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
    '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
    '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800',
    '#ff5722'
];

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
// Shuffle palette on load so colors are distributed differently each session
shuffleArray(PALETTE);

const app = {
    diagram: new TimelineDiagram(),
    elements: {},
    state: {
        zoom: 1,
        scrollLeft: 0,
        selectedBoxId: null,
        selectedLaneId: null,
        mode: null // 'box', 'lane', 'settings'
    },
    config: {
        timeThresholdMs: 1000 // default 1s
    },
    pixelsPerMs: 0.15,
    minPixelsPerMs: 0.01,
    maxPixelsPerMs: 2,
    isDragging: false,
    dragData: null,
    boxGap: 4,
    isPicking: false
};

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
    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

function getAutoBoxColor(laneId) {
    const lane = app.diagram.lanes.find(l => l.id === parseInt(laneId));
    let baseColor = PALETTE[0];
    if (lane && lane.color) {
        baseColor = lane.color;
    } else if (lane) {
        baseColor = PALETTE[lane.order % PALETTE.length];
    }

    // Use the count of boxes to vary color more distinctly (+- 40, 60, 80...)
    const laneBoxes = app.diagram.getBoxesForLane(laneId);
    const boxIndex = laneBoxes.length;
    const shift = (boxIndex % 2 === 0 ? 1 : -1) * (35 + (boxIndex % 3) * 20);
    return adjustColor(baseColor, shift);
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
    if (app.config.timeThresholdMs > 0 && ms > app.config.timeThresholdMs) {
        // Convert to seconds
        const seconds = (ms / 1000).toFixed(1);
        if (seconds > 60) {
            const mins = (seconds / 60).toFixed(1);
            return `${mins}m`;
        }
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

        // Select lane on click (if not control)
        item.addEventListener('mousedown', (e) => {
            if (!e.target.closest('button') && !e.target.closest('input')) {
                selectLane(lane.id);
            }
        });

        if (app.state.selectedLaneId === lane.id) {
            item.classList.add('selected');
            item.style.borderColor = varCSS('--accent-primary');
        } else {
            item.style.borderColor = ''; // reset
        }

        item.draggable = true;

        const isFirst = index === 0;
        const isLast = index === totalLanes - 1;

        item.innerHTML = `
            <span class="lane-drag-handle" title="Drag to reorder">⋮⋮</span>
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
            const laneId = parseInt(e.target.dataset.laneId, 10);
            app.diagram.renameLane(laneId, e.target.value);
            renderLanesCanvas();
        });
    });

    // Add event listeners for delete buttons
    container.querySelectorAll('.lane-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const laneId = parseInt(e.target.dataset.laneId, 10);
            if (confirm('Delete this lane and all its boxes?')) {
                app.diagram.removeLane(laneId);
                renderLaneList();
                renderLanesCanvas();
                updateTotalDuration();
            }
        });
    });

    // Add event listeners for move up buttons
    container.querySelectorAll('.lane-control-btn.move-up').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
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
            const index = parseInt(e.target.dataset.index, 10);
            const name = `Lane ${app.diagram.nextLaneId}`;
            app.diagram.insertLaneAt(index + 1, name);
            renderLaneList();
            renderLanesCanvas();
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

    el.innerHTML = `
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
    const canvasRect = canvas.getBoundingClientRect();

    svg.innerHTML = '';
    svg.style.display = 'none';

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
}

function updatePropertiesPanel() {
    const propsPanel = app.elements.propertiesPanel;
    const title = document.getElementById('props-title');

    // Hide all sections first
    document.querySelectorAll('.props-section').forEach(el => el.classList.add('hidden'));

    if (app.state.mode === 'settings') {
        propsPanel.classList.remove('hidden');
        title.innerText = 'Global Settings';
        document.getElementById('settings-props').classList.remove('hidden');

        // Update values
        const thresh = document.getElementById('config-time-threshold');
        if (thresh) thresh.value = app.config.timeThresholdMs;

        return;
    }

    if (app.state.mode === 'lane' && app.state.selectedLaneId) {
        propsPanel.classList.remove('hidden');
        title.innerText = 'Lane Properties';
        document.getElementById('lane-props').classList.remove('hidden');

        const lane = app.diagram.lanes.find(l => l.id === app.state.selectedLaneId);
        if (lane) {
            document.getElementById('lane-name').value = lane.name;

            // Generate Palette for Lane
            const pal = document.getElementById('lane-palette');
            pal.innerHTML = '';
            PALETTE.forEach(c => {
                const sw = document.createElement('div');
                sw.className = 'palette-swatch';
                sw.style.background = c;
                if (c === lane.color) sw.style.border = '2px solid white';
                sw.onclick = () => {
                    lane.color = c;
                    // Auto-adjust all boxes in this lane based on new lane color
                    app.diagram.getBoxesForLane(lane.id).forEach((box, i) => {
                        const shift = (i % 2 === 0 ? 1 : -1) * (35 + (i % 3) * 20);
                        box.color = adjustColor(lane.color, shift);
                    });
                    renderLanesCanvas(); // Update boxes
                    updatePropertiesPanel(); // Update border
                };
                pal.appendChild(sw);
            });
        }
        return;
    }

    if (app.state.mode === 'box' && app.state.selectedBoxId) {
        propsPanel.classList.remove('hidden');
        title.innerText = 'Box Properties';
        document.getElementById('box-props').classList.remove('hidden');

        const box = app.diagram.boxes.find(b => b.id === app.state.selectedBoxId);
        if (box) {
            app.elements.boxLabel.value = box.label || '';
            app.elements.boxColor.value = box.color || '#4CAF50';
            app.elements.boxStart.value = box.startOffset;
            app.elements.boxDuration.value = box.duration;
            app.elements.boxEnd.value = box.startOffset + box.duration;

            document.getElementById('box-time-start').innerText = formatAbsoluteTime(box.startOffset);
            document.getElementById('box-time-end').innerText = formatAbsoluteTime(box.startOffset + box.duration);

            // Box palette update (border for selected)
            const pal = document.getElementById('box-palette');
            if (pal) {
                // Ensure box palette is populated and shows selection
                if (pal.children.length === 0) renderBoxPalette(pal);
                Array.from(pal.children).forEach(sw => {
                    sw.style.border = sw.title === box.color ? '2px solid white' : '';
                });
            }
        }
        return;
    }

    // Nothing selected
    propsPanel.classList.add('hidden');
}

function selectLane(laneId) {
    app.state.selectedLaneId = laneId;
    app.state.selectedBoxId = null;
    app.state.mode = 'lane';

    // Rerender list to show selection
    renderLaneList();

    // Deselect boxes
    document.querySelectorAll('.timeline-box').forEach(b => b.classList.remove('selected'));

    updatePropertiesPanel();
}

function deselectLane() {
    app.state.selectedLaneId = null;
    if (app.state.mode === 'lane') app.state.mode = null;
    renderLaneList();
    updatePropertiesPanel();
}

function enterSettingsMode() {
    // Deselect others
    deselectBox();
    deselectLane();
    app.state.mode = 'settings';
    updatePropertiesPanel();
}

function deselectBox() {
    if (app.state.selectedBoxId) {
        app.state.selectedBoxId = null;
        if (app.state.mode === 'box') app.state.mode = null;
        document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));
        updatePropertiesPanel();
    }
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

    app.state.selectedBoxId = boxId;
    app.state.selectedLaneId = null;
    app.state.mode = 'box';

    // Select new
    const boxEl = document.querySelector(`.timeline-box[data-box-id="${boxId}"]`);
    if (boxEl) {
        boxEl.classList.add('selected');
    }

    renderLaneList();
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
        const width = Math.max(currentX - app.dragData.startX, 10);
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
            const duration = pixelsToMs(Math.max(dist, 20));

            const box = app.diagram.addBox(
                app.dragData.laneId,
                Math.round(app.dragData.startOffset),
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
            app.diagram.fromJSON(data);

            app.elements.diagramTitle.value = app.diagram.title;
            app.elements.startTime.value = app.diagram.startTime;

            deselectBox();
            renderLaneList();
            renderLanesCanvas();
            updateTotalDuration();
        } catch (err) {
            alert('Error loading file: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function exportToPNG() {
    // Deselect everything
    deselectBox();
    app.state.selectedLaneId = null;
    updatePropertiesPanel();

    const container = app.elements.lanesCanvas.parentElement; // .canvas-container

    // 1. Create a temporary high-res clone container for export
    // We do this to manually enforce the display of alignment lines which might be missed by html2canvas
    const exportContainer = document.createElement('div');
    exportContainer.style.position = 'absolute';
    exportContainer.style.top = '-9999px';
    exportContainer.style.left = '-9999px';
    exportContainer.style.width = container.scrollWidth + 'px';
    exportContainer.style.height = container.scrollHeight + 'px';
    exportContainer.style.background = '#0f1419'; // Match bg

    // Copy content
    exportContainer.innerHTML = container.innerHTML;

    // Remove interactives from clone
    exportContainer.querySelectorAll('.lane-controls, .lane-delete-btn, .lane-drag-handle').forEach(el => el.remove());

    // Manually render alignment markers as DIVs for robust capture
    const markerContainer = document.createElement('div');
    markerContainer.style.position = 'absolute';
    markerContainer.style.top = '0';
    markerContainer.style.left = '0';
    markerContainer.style.width = '100%';
    markerContainer.style.height = '100%';
    markerContainer.style.pointerEvents = 'none';
    markerContainer.style.zIndex = '10';

    const laneLabelWidth = 160;
    const rulerHeight = 40;
    const footerHeight = 40;
    const height = container.scrollHeight;

    const timePoints = new Set();
    app.diagram.boxes.forEach(box => {
        timePoints.add(box.startOffset);
        timePoints.add(box.startOffset + box.duration);
    });

    timePoints.forEach(time => {
        const x = laneLabelWidth + msToPixels(time);
        const line = document.createElement('div');
        line.style.position = 'absolute';
        line.style.left = x + 'px';
        line.style.top = rulerHeight + 'px';
        line.style.height = (height - rulerHeight - footerHeight) + 'px';
        line.style.borderLeft = '1px dashed rgba(255,255,255,0.4)';
        line.style.zIndex = '100';
        markerContainer.appendChild(line);
    });

    exportContainer.appendChild(markerContainer);
    document.body.appendChild(exportContainer);

    html2canvas(exportContainer, {
        backgroundColor: '#0f1419',
        scale: 2,
        useCORS: true
    }).then(canvas => {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${app.diagram.title.replace(/[^a-z0-9]/gi, '_')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        document.body.removeChild(exportContainer); // cleanup
    }).catch(err => {
        console.error(err);
        document.body.removeChild(exportContainer); // cleanup
    });
}

function exportToSVG() {
    const canvas = app.elements.lanesCanvas;
    const lanes = app.diagram.lanes;
    const boxes = app.diagram.boxes;

    const laneHeight = 50;
    const laneLabelWidth = 160;
    const rulerHeight = 40;
    const footerHeight = 40;
    const totalDuration = app.diagram.getTotalDuration() * 1.1;
    const width = laneLabelWidth + msToPixels(totalDuration) + 50;
    const height = rulerHeight + (lanes.length * laneHeight) + footerHeight;

    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .lane-label { font-family: Inter, sans-serif; font-size: 13px; fill: #ffffff; }
    .ruler-text { font-family: Monaco, monospace; font-size: 11px; fill: #a8b2c1; }
    .box-text { font-family: Inter, sans-serif; font-size: 12px; font-weight: 500; }
    .footer-text { font-family: Monaco, monospace; font-size: 13px; font-weight: 600; fill: #a8b2c1; }
  </style>
  
  <!-- Background -->
  <rect width="100%" height="100%" fill="#0f1419"/>
  
  <!-- Ruler -->
  <rect x="0" y="0" width="${width}" height="${rulerHeight}" fill="#1a1f2e"/>
  <rect x="0" y="0" width="${laneLabelWidth}" height="${rulerHeight}" fill="#1a1f2e"/>
`;

    // Ruler marks
    let interval = 500;
    for (let time = 0; time <= totalDuration; time += interval) {
        const x = laneLabelWidth + msToPixels(time);
        svg += `  <line x1="${x}" y1="0" x2="${x}" y2="${rulerHeight}" stroke="rgba(255,255,255,0.1)"/>
  <text x="${x + 4}" y="${rulerHeight - 8}" class="ruler-text">${formatDuration(time)}</text>\n`;
    }

    // Vertical Dashed Lines (Alignment Markers)
    const timePoints = new Set();
    boxes.forEach(box => {
        timePoints.add(box.startOffset);
        timePoints.add(box.startOffset + box.duration);
    });

    timePoints.forEach(time => {
        const x = laneLabelWidth + msToPixels(time);
        svg += `  <line x1="${x}" y1="${rulerHeight}" x2="${x}" y2="${height - footerHeight}" stroke="white" stroke-opacity="0.4" stroke-dasharray="4 2"/>\n`;
    });

    // Lanes
    lanes.forEach((lane, index) => {
        const y = rulerHeight + (index * laneHeight);

        // Lane background
        svg += `  <rect x="0" y="${y}" width="${width}" height="${laneHeight}" fill="${index % 2 === 0 ? '#0f1419' : 'rgba(255,255,255,0.01)'}"/>
  <rect x="0" y="${y}" width="${laneLabelWidth}" height="${laneHeight}" fill="#1a1f2e"/>
  <line x1="${laneLabelWidth}" y1="${y}" x2="${laneLabelWidth}" y2="${y + laneHeight}" stroke="rgba(255,255,255,0.1)"/>
  <line x1="0" y1="${y + laneHeight}" x2="${width}" y2="${y + laneHeight}" stroke="rgba(255,255,255,0.1)"/>
  <text x="16" y="${y + 30}" class="lane-label">${escapeHtml(lane.name)}</text>\n`;

        // Boxes for this lane
        const laneBoxes = boxes.filter(b => b.laneId === lane.id);
        laneBoxes.forEach(box => {
            const bx = laneLabelWidth + msToPixels(box.startOffset);
            const by = y + 6;
            const bw = Math.max(msToPixels(box.duration), 20);
            const bh = laneHeight - 12;
            const textColor = getContrastColor(box.color);
            const labelText = box.label ? `${box.label} (${formatDuration(box.duration)})` : formatDuration(box.duration);

            svg += `  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${box.color}"/>
  <text x="${bx + bw / 2}" y="${by + bh / 2 + 4}" text-anchor="middle" class="box-text" fill="${textColor}">${escapeHtml(labelText)}</text>\n`;
        });
    });

    // Footer
    const footerY = rulerHeight + (lanes.length * laneHeight);
    svg += `  <rect x="0" y="${footerY}" width="${width}" height="${footerHeight}" fill="#1a1f2e"/>
  <rect x="${laneLabelWidth}" y="${footerY}" width="${width - laneLabelWidth}" height="${footerHeight}" fill="#252b3b"/>
  <text x="${width / 2}" y="${footerY + 26}" text-anchor="middle" class="footer-text">TOTAL DURATION: <tspan fill="#6366f1">${formatDuration(app.diagram.getTotalDuration())}</tspan></text>
</svg>`;

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
// Initialization
// =====================================================
function enterPickMode() {
    if (!app.selectedBoxId) return;
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
    });

    app.elements.startTime.addEventListener('change', (e) => {
        app.diagram.startTime = e.target.value;
        updatePropertiesPanel();
        renderTimeMarkers(); // Update markers as start time changes
    });

    // Synchronize scroll between canvas, ruler, and time markers
    app.elements.lanesCanvas.addEventListener('scroll', (e) => {
        app.elements.timelineRuler.scrollLeft = e.target.scrollLeft;
        if (app.elements.timeMarkers) {
            app.elements.timeMarkers.scrollLeft = e.target.scrollLeft;
        }
    });
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

    // Add default lane
    app.diagram.addLane('Lane 1');

    // Setting Button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            enterSettingsMode();
        });
    }

    // Lane name listener in props
    const laneNameInput = document.getElementById('lane-name');
    if (laneNameInput) {
        laneNameInput.addEventListener('input', (e) => {
            if (app.state.mode === 'lane' && app.state.selectedLaneId) {
                app.diagram.renameLane(app.state.selectedLaneId, e.target.value);
                renderLaneList(); // Refresh list names
                renderLanesCanvas(); // Refresh track labels
            }
        });
    }

    // Config Threshold Listener
    const threshInput = document.getElementById('config-time-threshold');
    if (threshInput) {
        threshInput.addEventListener('change', (e) => {
            app.config.timeThresholdMs = parseInt(e.target.value, 10);
            renderTimelineRuler();
            renderLanesCanvas(); // rerender markers/ruler text
        });
    }

    // Global click to deselect
    document.addEventListener('click', (e) => {
        if (e.target.closest('.properties-panel')) return; // Ignore panel clicks
        if (e.target.closest('.lane-item')) return; // Handled by lane click
        if (e.target.closest('.timeline-box')) return; // Handled by box click
        if (e.target.closest('#settings-btn')) return;
        if (e.target.closest('.btn')) return; // Ignore general buttons

        // If clicking canvas background or white space, deselect all
        if (app.state.selectedBoxId || app.state.selectedLaneId || app.state.mode === 'settings') {
            deselectBox();
            deselectLane();
            if (app.state.mode === 'settings') {
                app.state.mode = null;
                updatePropertiesPanel();
            }
        }
    });

    // Initial render
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    updateTotalDuration();
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
