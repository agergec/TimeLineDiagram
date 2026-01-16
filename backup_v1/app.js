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
    }

    addLane(name) {
        const lane = {
            id: this.nextLaneId++,
            name: name,
            order: this.lanes.length
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
            nextBoxId: this.nextBoxId
        };
    }

    fromJSON(data) {
        this.title = data.title || 'Timeline Diagram';
        this.startTime = data.startTime || '00:00:00 000';
        this.lanes = data.lanes || [];
        this.boxes = data.boxes || [];
        this.nextLaneId = data.nextLaneId || 1;
        this.nextBoxId = data.nextBoxId || 1;
    }
}

// =====================================================
// Application State
// =====================================================
const app = {
    diagram: new TimelineDiagram(),
    selectedBoxId: null,
    pixelsPerMs: 0.15, // Default scale: 0.15px per ms
    minPixelsPerMs: 0.01,
    maxPixelsPerMs: 2,
    isDragging: false,
    dragData: null,
    boxGap: 4, // Gap between boxes in pixels
    
    // DOM Elements
    elements: {}
};

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
    if (ms >= 1000) {
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
    
    app.diagram.lanes.forEach((lane, index) => {
        const item = document.createElement('div');
        item.className = 'lane-item';
        item.dataset.laneId = lane.id;
        item.draggable = true;
        
        item.innerHTML = `
            <span class="lane-drag-handle">⋮⋮</span>
            <input type="text" class="lane-name-input" value="${escapeHtml(lane.name)}" data-lane-id="${lane.id}">
            <button class="lane-delete-btn" data-lane-id="${lane.id}" title="Delete lane">×</button>
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
            const laneId = parseInt(e.target.dataset.laneId, 10);
            if (confirm('Delete this lane and all its boxes?')) {
                app.diagram.removeLane(laneId);
                renderLaneList();
                renderLanesCanvas();
                updateTotalDuration();
            }
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
    
    el.title = `${box.label || 'Box'}\nStart: +${formatDuration(box.startOffset)}\nDuration: ${formatDuration(box.duration)}\nEnd: +${formatDuration(box.startOffset + box.duration)}`;
    
    // Box click/selection
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectBox(box.id);
    });
    
    // Box dragging (move)
    el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('box-resize-handle')) {
            handleResizeStart(e, box.id);
        } else {
            handleBoxDragStart(e, box.id);
        }
    });
    
    return el;
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
    
    // Only show alignment markers if there are boxes in multiple lanes
    const lanesWithBoxes = new Set(app.diagram.boxes.map(b => b.laneId));
    if (lanesWithBoxes.size < 2) return;
    
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
    const panel = app.elements.propertiesPanel;
    
    if (!app.selectedBoxId) {
        panel.classList.add('hidden');
        return;
    }
    
    const box = app.diagram.boxes.find(b => b.id === app.selectedBoxId);
    if (!box) {
        panel.classList.add('hidden');
        return;
    }
    
    panel.classList.remove('hidden');
    
    app.elements.boxLabel.value = box.label;
    app.elements.boxColor.value = box.color;
    app.elements.boxStart.value = box.startOffset;
    app.elements.boxDuration.value = box.duration;
    
    // Calculate absolute times
    const baseTime = parseTime(app.diagram.startTime);
    app.elements.boxTimeStart.textContent = formatTime(baseTime + box.startOffset);
    app.elements.boxTimeEnd.textContent = formatTime(baseTime + box.startOffset + box.duration);
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
    if (e.target.classList.contains('timeline-box') || 
        e.target.closest('.timeline-box')) {
        return; // Let box handle its own events
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
        
        updatePropertiesPanel();
    }
}

function handleMouseUp(e) {
    if (!app.isDragging || !app.dragData) return;
    
    if (app.dragData.type === 'create') {
        const rect = app.dragData.track.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const duration = pixelsToMs(Math.max(endX - app.dragData.startX, 20));
        
        // Remove temp box
        app.dragData.tempBox.remove();
        
        // Create real box if duration is significant
        if (duration >= 50) {
            const box = app.diagram.addBox(
                app.dragData.laneId,
                Math.round(app.dragData.startOffset),
                Math.round(duration),
                '',
                '#4CAF50'
            );
            
            renderLanesCanvas();
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
    const container = app.elements.lanesCanvas.parentElement;
    
    // Hide properties panel temporarily
    const propsPanel = app.elements.propertiesPanel;
    const wasHidden = propsPanel.classList.contains('hidden');
    propsPanel.classList.add('hidden');
    
    html2canvas(container, {
        backgroundColor: '#0f1419',
        scale: 2
    }).then(canvas => {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${app.diagram.title.replace(/[^a-z0-9]/gi, '_')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        if (!wasHidden) {
            propsPanel.classList.remove('hidden');
        }
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
  <text x="${bx + bw/2}" y="${by + bh/2 + 4}" text-anchor="middle" class="box-text" fill="${textColor}">${escapeHtml(labelText)}</text>\n`;
        });
    });
    
    // Footer
    const footerY = rulerHeight + (lanes.length * laneHeight);
    svg += `  <rect x="0" y="${footerY}" width="${width}" height="${footerHeight}" fill="#1a1f2e"/>
  <rect x="${laneLabelWidth}" y="${footerY}" width="${width - laneLabelWidth}" height="${footerHeight}" fill="#252b3b"/>
  <text x="${width/2}" y="${footerY + 26}" text-anchor="middle" class="footer-text">TOTAL DURATION: <tspan fill="#6366f1">${formatDuration(app.diagram.getTotalDuration())}</tspan></text>
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
function init() {
    // Cache DOM elements
    app.elements = {
        diagramTitle: document.getElementById('diagram-title'),
        startTime: document.getElementById('start-time'),
        zoomLevel: document.getElementById('zoom-level'),
        laneList: document.getElementById('lane-list'),
        timelineRuler: document.getElementById('timeline-ruler'),
        lanesCanvas: document.getElementById('lanes-canvas'),
        totalDuration: document.getElementById('total-duration'),
        propertiesPanel: document.getElementById('properties-panel'),
        boxLabel: document.getElementById('box-label'),
        boxColor: document.getElementById('box-color'),
        boxStart: document.getElementById('box-start'),
        boxDuration: document.getElementById('box-duration'),
        boxTimeStart: document.getElementById('box-time-start'),
        boxTimeEnd: document.getElementById('box-time-end'),
        alignmentMarkers: document.getElementById('alignment-markers'),
        fileInput: document.getElementById('file-input')
    };
    
    // Header event listeners
    app.elements.diagramTitle.addEventListener('change', (e) => {
        app.diagram.title = e.target.value;
    });
    
    app.elements.startTime.addEventListener('change', (e) => {
        app.diagram.startTime = e.target.value;
        updatePropertiesPanel();
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
    
    // Add some default lanes for demo
    app.diagram.addLane('Answering machine detection (AMD)');
    app.diagram.addLane('IVR');
    app.diagram.addLane('Routing');
    app.diagram.addLane('Parloa yanıt');
    app.diagram.addLane('Sinyalleşmenin tamamlanması');
    
    // Initial render
    renderLaneList();
    renderLanesCanvas();
    updateTotalDuration();
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
