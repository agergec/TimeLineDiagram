/* =====================================================
   Timeline Diagram Editor - Main Application Logic
   ===================================================== */

// Default minimum timeline scale for new diagrams (in milliseconds)
const DEFAULT_MIN_TIMELINE_MS = 10000;

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
        // If no color provided, assign one from PALETTE based on current lane count
        const color = baseColor || PALETTE[this.lanes.length % PALETTE.length];
        const lane = {
            id: this.nextLaneId++,
            name: name,
            order: this.lanes.length,
            baseColor: color
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

    insertLaneAt(position, name, baseColor = null) {
        // If no color provided, assign one from PALETTE based on position
        const color = baseColor || PALETTE[position % PALETTE.length];
        const lane = {
            id: this.nextLaneId++,
            name: name,
            order: position,
            baseColor: color
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
            compressionEnabled: Compression.enabled, // Save compression state per diagram
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

        // Migration: Ensure all lanes have baseColor (for old saved diagrams)
        this.lanes.forEach((lane, index) => {
            if (!lane.baseColor) {
                lane.baseColor = PALETTE[index % PALETTE.length];
            }
        });
        // Restore compression state (default to false for new/old diagrams)
        Compression.setEnabled(data.compressionEnabled || false);
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
    minPixelsPerMs: 0.001, // Allow extreme zoom out (0.67% - see entire timeline)
    maxPixelsPerMs: 1000,  // Allow extreme zoom in (666,666% - sub-microsecond detail)
    isDragging: false,
    dragData: null,
    boxGap: 4, // Gap between boxes in pixels

    // Measurement tool state
    isMeasuring: false,
    measurePinned: false,
    measureToolActive: false, // Toggle measurement mode without holding Ctrl/Cmd
    measureStart: null,
    measureEnd: null,
    pinnedMeasurementData: null, // Stored measurement from loaded diagram

    // Global settings
    settings: {
        timeFormatThreshold: 1000, // Switch from ms to seconds when duration > this value (0 = always ms)
        showAlignmentLines: true,  // Toggle vertical alignment lines
        showBoxLabels: false,      // Toggle persistent floating labels above boxes
        autoOpenBoxProperties: false, // Auto-open box properties panel after creating a new box
        trailingSpace: 1000,       // Extra space after last box in milliseconds
        compressionThreshold: 500  // Gaps larger than this (ms) get compressed
    },

    // Duration scaling settings (for PoC - can be removed if not needed)
    durationScaling: {
        enabled: false,
        mode: 'none', // 'none', 'floor', 'logarithmic', 'compression', 'minWidth'
        // Mode A: Floor - treat all durations as at least this value (ms)
        floorValue: 100,
        // Mode B: Logarithmic - log scale with base factor
        logBase: 10,
        logMinDuration: 10, // Minimum duration for log calculation
        // Mode C: Linear Compression - compress range to [minVisual, maxVisual]
        compressionFactor: 0.5, // 0 = full compression, 1 = linear (no compression)
        // Mode D: Minimum Width - minimum box width in pixels (overrides the default 20px)
        minWidthPx: 20
    },

    // DOM Elements
    elements: {}
};

// =====================================================
// Duration Scaling Module (PoC - Removable)
// =====================================================
// This module provides 4 different scaling algorithms to make small duration
// boxes more visible. Each can be enabled/disabled independently.

const DurationScaling = {
    /**
     * Get the visual duration for a box based on current scaling mode
     * @param {number} actualDuration - The real duration in ms
     * @returns {number} - The visual duration to use for rendering
     */
    getVisualDuration(actualDuration) {
        const config = app.durationScaling;
        if (!config.enabled || config.mode === 'none') {
            return actualDuration;
        }

        switch (config.mode) {
            case 'floor':
                return this.applyFloor(actualDuration);
            case 'logarithmic':
                return this.applyLogarithmic(actualDuration);
            case 'compression':
                return this.applyCompression(actualDuration);
            default:
                return actualDuration;
        }
    },

    /**
     * Mode A: Duration Floor
     * Treats all durations as at least the floor value
     * Simple and predictable - boxes under threshold appear same size
     */
    applyFloor(duration) {
        return Math.max(duration, app.durationScaling.floorValue);
    },

    /**
     * Mode B: Logarithmic Scale
     * Compresses large durations, expands small ones
     * Formula: visualDuration = minDuration * (1 + log(1 + duration/minDuration) * scaleFactor)
     */
    applyLogarithmic(duration) {
        const { logBase, logMinDuration } = app.durationScaling;
        if (duration <= 0) return logMinDuration;

        // Logarithmic scaling: smaller values get proportionally larger boost
        const logValue = Math.log(1 + duration / logMinDuration) / Math.log(logBase);
        return logMinDuration * (1 + logValue * (logBase - 1));
    },

    /**
     * Mode C: Linear Compression
     * Reduces the visual range between small and large durations
     * Formula: visualDuration = minDuration + (duration - minDuration) * compressionFactor
     */
    applyCompression(duration) {
        const { compressionFactor } = app.durationScaling;
        const boxes = app.diagram?.boxes || [];
        if (boxes.length === 0) return duration;

        // Find min/max durations in current diagram
        const durations = boxes.map(b => b.duration).filter(d => d > 0);
        if (durations.length === 0) return duration;

        const minDuration = Math.min(...durations);
        const maxDuration = Math.max(...durations);

        if (maxDuration === minDuration) return duration;

        // Compress the range: small boxes get boosted, large boxes get reduced
        // compressionFactor: 0 = all same size, 1 = linear (no change)
        const normalized = (duration - minDuration) / (maxDuration - minDuration);
        const compressed = Math.pow(normalized, compressionFactor);
        return minDuration + compressed * (maxDuration - minDuration);
    },

    /**
     * Mode D: Minimum Width
     * Simply returns a larger minimum pixel width for boxes
     * This is applied at render time, not to duration
     */
    getMinBoxWidth() {
        const config = app.durationScaling;
        if (config.enabled && config.mode === 'minWidth') {
            return config.minWidthPx;
        }
        return 20; // Default minimum
    },

    /**
     * Get display info for current scaling mode
     */
    getModeInfo() {
        const config = app.durationScaling;
        const modes = {
            'none': { name: 'None', description: 'No scaling applied' },
            'floor': { name: 'Duration Floor', description: `Min visual duration: ${config.floorValue}ms` },
            'logarithmic': { name: 'Logarithmic', description: `Log base ${config.logBase}, min ${config.logMinDuration}ms` },
            'compression': { name: 'Compression', description: `Factor: ${config.compressionFactor}` },
            'minWidth': { name: 'Min Width', description: `Min box width: ${config.minWidthPx}px` }
        };
        return modes[config.mode] || modes['none'];
    }
};

// =====================================================
// Duration Scaling UI Handlers (PoC - Removable)
// =====================================================

function initDurationScalingUI() {
    const enabledCheckbox = document.getElementById('config-scaling-enabled');
    const modeSelect = document.getElementById('config-scaling-mode');
    const scalingOptions = document.getElementById('scaling-options');

    if (!enabledCheckbox || !modeSelect) return;

    // Enable/Disable toggle
    enabledCheckbox.addEventListener('change', () => {
        app.durationScaling.enabled = enabledCheckbox.checked;
        if (scalingOptions) {
            scalingOptions.classList.toggle('hidden', !enabledCheckbox.checked);
        }
        if (enabledCheckbox.checked) {
            app.durationScaling.mode = modeSelect.value;
        }
        updateScalingModeInfo();
        renderLanesCanvas();
    });

    // Mode selection
    modeSelect.addEventListener('change', () => {
        app.durationScaling.mode = modeSelect.value;
        updateScalingModeOptions();
        updateScalingModeInfo();
        renderLanesCanvas();
    });

    // Mode A: Floor controls
    const floorSlider = document.getElementById('config-floor-slider');
    const floorValue = document.getElementById('config-floor-value');
    if (floorSlider && floorValue) {
        const syncFloor = (value) => {
            app.durationScaling.floorValue = parseInt(value, 10);
            floorSlider.value = value;
            floorValue.value = value;
            updateScalingModeInfo();
            renderLanesCanvas();
        };
        floorSlider.addEventListener('input', () => syncFloor(floorSlider.value));
        floorValue.addEventListener('change', () => syncFloor(floorValue.value));
    }

    // Mode B: Logarithmic controls
    const logBaseSlider = document.getElementById('config-log-base-slider');
    const logBase = document.getElementById('config-log-base');
    const logMin = document.getElementById('config-log-min');
    if (logBaseSlider && logBase) {
        const syncLogBase = (value) => {
            app.durationScaling.logBase = parseInt(value, 10);
            logBaseSlider.value = value;
            logBase.value = value;
            updateScalingModeInfo();
            renderLanesCanvas();
        };
        logBaseSlider.addEventListener('input', () => syncLogBase(logBaseSlider.value));
        logBase.addEventListener('change', () => syncLogBase(logBase.value));
    }
    if (logMin) {
        logMin.addEventListener('change', () => {
            app.durationScaling.logMinDuration = parseInt(logMin.value, 10);
            updateScalingModeInfo();
            renderLanesCanvas();
        });
    }

    // Mode C: Compression controls
    const compressionSlider = document.getElementById('config-compression-slider');
    const compressionFactor = document.getElementById('config-compression-factor');
    if (compressionSlider && compressionFactor) {
        const syncCompression = (value) => {
            app.durationScaling.compressionFactor = parseFloat(value);
            compressionSlider.value = value;
            compressionFactor.value = value;
            updateScalingModeInfo();
            renderLanesCanvas();
        };
        compressionSlider.addEventListener('input', () => syncCompression(compressionSlider.value));
        compressionFactor.addEventListener('change', () => syncCompression(compressionFactor.value));
    }

    // Mode D: Min Width controls
    const minWidthSlider = document.getElementById('config-minwidth-slider');
    const minWidth = document.getElementById('config-min-width');
    if (minWidthSlider && minWidth) {
        const syncMinWidth = (value) => {
            app.durationScaling.minWidthPx = parseInt(value, 10);
            minWidthSlider.value = value;
            minWidth.value = value;
            updateScalingModeInfo();
            renderLanesCanvas();
        };
        minWidthSlider.addEventListener('input', () => syncMinWidth(minWidthSlider.value));
        minWidth.addEventListener('change', () => syncMinWidth(minWidth.value));
    }

    // Initialize UI state
    updateScalingModeOptions();
    updateScalingModeInfo();
}

function updateScalingModeOptions() {
    const mode = app.durationScaling.mode;
    const allOpts = document.querySelectorAll('.scaling-mode-opts');
    allOpts.forEach(el => el.classList.add('hidden'));

    const optMap = {
        'floor': 'scaling-floor-opts',
        'logarithmic': 'scaling-log-opts',
        'compression': 'scaling-compression-opts',
        'minWidth': 'scaling-minwidth-opts'
    };

    const activeOpt = document.getElementById(optMap[mode]);
    if (activeOpt) {
        activeOpt.classList.remove('hidden');
    }
}

function updateScalingModeInfo() {
    const infoEl = document.getElementById('scaling-mode-info');
    if (infoEl) {
        const info = DurationScaling.getModeInfo();
        infoEl.textContent = app.durationScaling.enabled
            ? `${info.name} - ${info.description}`
            : 'Disabled';
    }
}

// =====================================================
// Minimap Module
// =====================================================

const Minimap = {
    canvas: null,
    ctx: null,
    viewport: null,
    container: null,
    isDragging: false,
    dragStartX: 0,
    dragStartScroll: 0,

    init() {
        this.canvas = document.getElementById('minimap-canvas');
        this.viewport = document.getElementById('minimap-viewport');
        this.container = document.querySelector('.minimap-container');

        if (!this.canvas || !this.viewport || !this.container) return;

        this.ctx = this.canvas.getContext('2d');

        // Handle click to navigate
        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', () => this.handleMouseUp());

        // Handle resize
        window.addEventListener('resize', () => this.render());
    },

    handleMouseDown(e) {
        const rect = this.container.getBoundingClientRect();
        const clickX = e.clientX - rect.left;

        // Check if clicking on viewport indicator for dragging
        const viewportRect = this.viewport.getBoundingClientRect();
        const viewportLeft = viewportRect.left - rect.left;
        const viewportRight = viewportLeft + viewportRect.width;

        if (clickX >= viewportLeft && clickX <= viewportRight) {
            // Start dragging
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartScroll = app.elements.lanesCanvas.scrollLeft;
            this.container.style.cursor = 'grabbing';
            e.preventDefault();
        } else {
            // Click to navigate
            this.handleClick(e);
        }
    },

    handleMouseMove(e) {
        if (!this.isDragging) return;

        const lanesCanvas = app.elements.lanesCanvas;
        if (!lanesCanvas) return;

        const rect = this.container.getBoundingClientRect();
        const deltaX = e.clientX - this.dragStartX;

        // Convert minimap pixels to timeline pixels
        const totalDuration = Compression.enabled
            ? Compression.getCompressedDuration()
            : (app.diagram?.getTotalDuration() || 1);
        const timelineWidth = totalDuration + app.settings.trailingSpace;
        const padding = 4;
        const availableWidth = rect.width - padding * 2;
        const minimapToTimelineRatio = msToPixels(timelineWidth) / availableWidth;

        // Calculate max scroll (total scrollable width minus visible width)
        const totalScrollWidth = msToPixels(timelineWidth);
        const visibleWidth = lanesCanvas.clientWidth - 160; // Subtract lane label width
        const maxScroll = Math.max(0, totalScrollWidth - visibleWidth);

        const newScrollLeft = this.dragStartScroll + (deltaX * minimapToTimelineRatio);
        lanesCanvas.scrollLeft = Math.max(0, Math.min(newScrollLeft, maxScroll));
    },

    handleMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            this.container.style.cursor = 'pointer';
        }
    },

    render() {
        if (!this.canvas || !this.ctx) return;

        const container = this.container;
        const rect = container.getBoundingClientRect();

        // Set canvas size to match container
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        const ctx = this.ctx;
        const lanes = app.diagram?.lanes || [];
        const boxes = app.diagram?.boxes || [];

        // Use compressed duration if compression is enabled
        const totalDuration = Compression.enabled
            ? Compression.getCompressedDuration()
            : (app.diagram?.getTotalDuration() || 1);

        // Clear canvas
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (lanes.length === 0 || boxes.length === 0) return;

        // Calculate scale
        const padding = 4;
        const availableWidth = this.canvas.width - padding * 2;
        const availableHeight = this.canvas.height - padding * 2;
        const laneHeight = Math.max(2, Math.floor(availableHeight / lanes.length));
        const timelineWidth = totalDuration + app.settings.trailingSpace;
        const timeScale = availableWidth / timelineWidth;

        // Draw compression indicators in minimap
        if (Compression.enabled) {
            const gaps = Compression.getCompressedGaps();
            ctx.fillStyle = 'rgba(251, 146, 60, 0.3)';
            gaps.forEach(gap => {
                const x = padding + gap.compressedStart * timeScale;
                const width = gap.compressedSize * timeScale;
                ctx.fillRect(x, 0, width, this.canvas.height);
            });
        }

        // Draw boxes as small rectangles/dots
        lanes.forEach((lane, laneIndex) => {
            const laneBoxes = boxes.filter(b => b.laneId === lane.id);
            const y = padding + laneIndex * laneHeight;

            laneBoxes.forEach(box => {
                // Use compressed offset if enabled
                const visualOffset = Compression.getVisualOffset(box);
                const x = padding + visualOffset * timeScale;
                const width = Math.max(2, box.duration * timeScale);
                const height = Math.max(2, laneHeight - 1);

                ctx.fillStyle = box.color;
                ctx.fillRect(x, y, width, height);
            });
        });

        // Update viewport indicator
        this.updateViewport();
    },

    updateViewport() {
        if (!this.viewport || !this.container) return;

        const lanesCanvas = app.elements?.lanesCanvas;
        if (!lanesCanvas) return;

        // Use compressed duration if compression is enabled
        const totalDuration = Compression.enabled
            ? Compression.getCompressedDuration()
            : (app.diagram?.getTotalDuration() || 1);

        const containerWidth = this.container.getBoundingClientRect().width;
        const padding = 4;
        const availableWidth = containerWidth - padding * 2;
        const timelineWidth = totalDuration + app.settings.trailingSpace;
        const timeScale = availableWidth / timelineWidth;

        // Get visible viewport in time
        const scrollLeft = lanesCanvas.scrollLeft;
        const visibleWidth = lanesCanvas.clientWidth - 160; // Subtract lane label width
        const visibleStartMs = pixelsToMs(scrollLeft);
        const visibleEndMs = pixelsToMs(scrollLeft + visibleWidth);

        // Convert to minimap coordinates
        const viewportLeft = padding + visibleStartMs * timeScale;
        const viewportWidth = (visibleEndMs - visibleStartMs) * timeScale;

        this.viewport.style.left = `${Math.max(0, viewportLeft)}px`;
        this.viewport.style.width = `${Math.min(viewportWidth, availableWidth)}px`;
    },

    handleClick(e) {
        const lanesCanvas = app.elements?.lanesCanvas;
        if (!lanesCanvas) return;

        const rect = this.container.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const padding = 4;
        const availableWidth = rect.width - padding * 2;

        // Use compressed duration if compression is enabled
        const totalDuration = Compression.enabled
            ? Compression.getCompressedDuration()
            : (app.diagram?.getTotalDuration() || 1);

        const timelineWidth = totalDuration + app.settings.trailingSpace;
        const timeScale = availableWidth / timelineWidth;

        // Calculate target time from click position
        const targetTimeMs = (clickX - padding) / timeScale;

        // Calculate scroll position to center this time
        const visibleWidth = lanesCanvas.clientWidth - 160;
        const targetScrollLeft = msToPixels(targetTimeMs) - visibleWidth / 2;

        // Calculate max scroll (total scrollable width minus visible width)
        const totalScrollWidth = msToPixels(timelineWidth);
        const maxScroll = Math.max(0, totalScrollWidth - visibleWidth);

        lanesCanvas.scrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScroll));
    }
};

// =====================================================
// Compression Module (Visual Gap Compression)
// =====================================================
// Compresses large empty gaps ACROSS ALL LANES to show boxes closer together.
// A visual indicator shows where compression occurred.

const Compression = {
    enabled: false,
    compressionMap: null, // Cached compression calculations

    /**
     * Set compression enabled state (used when loading diagrams)
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.compressionMap = null; // Clear cache
        const btn = document.getElementById('compress-toggle');
        if (btn) {
            btn.classList.toggle('active', this.enabled);
            btn.title = this.enabled ? 'Disable Compression' : 'Compress Empty Spaces';
        }
    },

    toggle() {
        this.setEnabled(!this.enabled);
        renderTimelineRuler();
        renderLanesCanvas();
        renderTimeMarkers();
        Minimap.render();

        // Sync scroll positions after re-render
        const scrollLeft = app.elements.lanesCanvas.scrollLeft;
        app.elements.timelineRuler.scrollLeft = scrollLeft;
        app.elements.timeMarkers.scrollLeft = scrollLeft;
    },

    /**
     * Calculate compression map for all boxes across all lanes
     * Returns: { compressedOffsets: Map<boxId, offset>, gaps: [{start, end, compressedTo}], totalCompressed: ms }
     */
    // Compressed gaps have zero visual size - boxes snap directly to the gap indicator line
    COMPRESSED_GAP_MS: 0,

    calculateCompressionMap() {
        if (!this.enabled) return null;
        if (this.compressionMap) return this.compressionMap;

        const boxes = app.diagram?.boxes || [];
        if (boxes.length === 0) return null;

        // Threshold only determines which gaps get compressed (gaps > threshold)
        const threshold = app.settings.compressionThreshold || 500;
        // Compressed gaps have zero visual size - boxes snap directly to gap line
        const compressedVisualSize = this.COMPRESSED_GAP_MS;

        // Get all time events (start and end of each box) across ALL lanes
        // Process 'end' events before 'start' events at the same time to avoid false gaps
        const events = [];
        boxes.forEach(box => {
            events.push({ time: box.startOffset, type: 'start', boxId: box.id });
            events.push({ time: box.startOffset + box.duration, type: 'end', boxId: box.id });
        });
        // Sort by time, and within same time: process 'start' before 'end'
        // This ensures overlapping/adjacent boxes don't create false gaps
        events.sort((a, b) => {
            if (a.time !== b.time) return a.time - b.time;
            // At same time: 'start' comes before 'end' (start=0, end=1)
            return a.type === 'start' ? -1 : 1;
        });

        // Find gaps where no box is active across all lanes
        const gaps = [];
        let activeBoxes = 0;
        let gapStart = 0;

        events.forEach(event => {
            if (event.type === 'start') {
                if (activeBoxes === 0 && event.time > gapStart) {
                    // This is a gap - no boxes were active between gapStart and now
                    const gapSize = event.time - gapStart;
                    if (gapSize > threshold) {
                        gaps.push({
                            start: gapStart,
                            end: event.time,
                            size: gapSize,
                            compressedSize: compressedVisualSize
                        });
                    }
                }
                activeBoxes++;
            } else {
                activeBoxes--;
                if (activeBoxes === 0) {
                    gapStart = event.time;
                }
            }
        });

        // Calculate compressed offsets for each box
        const compressedOffsets = new Map();
        let totalCompression = 0;

        boxes.forEach(box => {
            let compression = 0;
            gaps.forEach(gap => {
                if (box.startOffset > gap.start) {
                    // This box starts after this gap
                    const gapCompression = gap.size - gap.compressedSize;
                    if (box.startOffset >= gap.end) {
                        // Box is fully after the gap
                        compression += gapCompression;
                    }
                }
            });
            compressedOffsets.set(box.id, box.startOffset - compression);
        });

        // Calculate total compression
        totalCompression = gaps.reduce((sum, gap) => sum + (gap.size - gap.compressedSize), 0);

        this.compressionMap = {
            compressedOffsets,
            gaps,
            totalCompression
        };

        return this.compressionMap;
    },

    /**
     * Get the visual (compressed) offset for a box
     */
    getVisualOffset(box) {
        if (!this.enabled) return box.startOffset;

        const map = this.calculateCompressionMap();
        if (!map) return box.startOffset;

        return map.compressedOffsets.get(box.id) ?? box.startOffset;
    },

    /**
     * Get compressed gaps for rendering visual indicators
     */
    getCompressedGaps() {
        if (!this.enabled) return [];

        const map = this.calculateCompressionMap();
        if (!map) return [];

        // Convert gaps to compressed coordinates for display
        let compressionBefore = 0;
        return map.gaps.map(gap => {
            const compressedStart = gap.start - compressionBefore;
            const result = {
                originalStart: gap.start,
                originalEnd: gap.end,
                compressedStart: compressedStart,
                compressedEnd: compressedStart + gap.compressedSize,
                originalSize: gap.size,
                compressedSize: gap.compressedSize
            };
            compressionBefore += gap.size - gap.compressedSize;
            return result;
        });
    },

    /**
     * Get total compressed duration
     */
    getCompressedDuration() {
        if (!this.enabled) return app.diagram?.getTotalDuration() || 0;

        const map = this.calculateCompressionMap();
        if (!map) return app.diagram?.getTotalDuration() || 0;

        return (app.diagram?.getTotalDuration() || 0) - map.totalCompression;
    },

    /**
     * Invalidate cache (call when boxes change)
     */
    invalidate() {
        this.compressionMap = null;
    },

    /**
     * Convert a compressed (visual) time position to actual (original) time
     * Used for ruler labels and measurement tool
     */
    compressedToActual(compressedTime) {
        if (!this.enabled) return compressedTime;

        const map = this.calculateCompressionMap();
        if (!map || map.gaps.length === 0) return compressedTime;

        // Walk through gaps to figure out how much compression happens before this point
        let compressionBefore = 0;
        for (const gap of map.gaps) {
            const compressedGapStart = gap.start - compressionBefore;
            const compressedGapEnd = compressedGapStart + gap.compressedSize;
            const gapCompression = gap.size - gap.compressedSize;

            if (compressedTime <= compressedGapStart) {
                // Before this gap
                break;
            } else if (compressedTime <= compressedGapEnd) {
                // Inside the compressed gap region - interpolate
                const progress = (compressedTime - compressedGapStart) / gap.compressedSize;
                return gap.start + progress * gap.size;
            } else {
                // After this gap
                compressionBefore += gapCompression;
            }
        }

        return compressedTime + compressionBefore;
    },

    /**
     * Get break marker positions (compressed) for the ruler
     * Returns array of { compressedPos, actualStart, actualEnd, compression }
     */
    getBreakMarkers() {
        if (!this.enabled) return [];

        const gaps = this.getCompressedGaps();
        return gaps.map(gap => ({
            compressedStart: gap.compressedStart,
            compressedEnd: gap.compressedEnd,
            actualStart: gap.originalStart,
            actualEnd: gap.originalEnd,
            compression: gap.originalSize - gap.compressedSize
        }));
    }
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
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    let p = 2 * l - q;
    r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    g = Math.round(hue2rgb(p, q, h) * 255);
    b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

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
    // Use V2 badge update
    if (typeof updateDiagramsBadge === 'function') {
        updateDiagramsBadge();
    }
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

function toggleDiagramLock(diagramId) {
    const diagrams = getAllDiagrams();
    const diagram = diagrams.find(d => d.id === diagramId);
    if (!diagram) return;

    // Toggle lock state
    if (!diagram.data) diagram.data = {};
    diagram.data.locked = !diagram.data.locked;

    // Save updated diagrams list
    saveDiagramsList(diagrams);

    // If this is the current diagram, update the UI
    if (diagramId === currentDiagramId) {
        app.diagram.locked = diagram.data.locked;
        updateLockState();
    }

    // Re-render the list to show updated lock icon
    renderDiagramsList();

    showToast({
        type: 'success',
        title: diagram.data.locked ? 'Diagram Locked' : 'Diagram Unlocked',
        message: diagram.data.locked ? 'Diagram is now protected from edits.' : 'Diagram can now be edited.',
        duration: 2000
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

                if (app.elements.propertiesPanel) {
                    app.elements.propertiesPanel.classList.add('hidden');
                }

                // Render diagrams list immediately and after delay to ensure update
                renderDiagramsList();
                setTimeout(() => {
                    renderDiagramsList();
                }, 150);

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
                    showBoxLabels: false,
                    autoOpenBoxProperties: false
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
                if (app.elements.propertiesPanel) {
                    app.elements.propertiesPanel.classList.add('hidden');
                }

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
    // Check if we've reached the maximum number of diagrams
    const diagrams = getAllDiagrams();
    if (diagrams.length >= MAX_DIAGRAMS) {
        showToast({
            type: 'warning',
            title: 'Maximum Diagrams Reached',
            message: `You can only have ${MAX_DIAGRAMS} diagrams. Delete one to create a new diagram.`,
            duration: 4000
        });
        return;
    }

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

    showToast({
        type: 'success',
        title: 'Diagram Created',
        message: `"${app.diagram.title}" is ready to use.`,
        duration: 2000
    });
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

    container.innerHTML = '';
    const diagrams = getAllDiagrams();

    if (diagrams.length === 0) {
        container.innerHTML = '<div class="empty-state">No saved diagrams found.</div>';
        return;
    }

    // Sort by updated at desc
    diagrams.sort((a, b) => b.updatedAt - a.updatedAt);

    diagrams.forEach(d => {
        const item = document.createElement('div');
        item.className = 'diagram-item';
        if (d.id === currentDiagramId) {
            item.classList.add('active');
        }

        const date = new Date(d.updatedAt).toLocaleString();
        
        // Lock icon
        const isLocked = d.data && d.data.locked;
        const lockIcon = isLocked ? '<span class="lock-icon" title="Locked">🔒</span>' : '';

        item.innerHTML = `
            <div class="diagram-info">
                <div class="diagram-title">${escapeHtml(d.title || 'Untitled')} ${lockIcon}</div>
                <div class="diagram-date">${date}</div>
            </div>
            <div class="diagram-actions">
                <button class="icon-btn load-btn" title="Load" data-id="${d.id}">📂</button>
                <button class="icon-btn lock-btn" title="${isLocked ? 'Unlock' : 'Lock'}" data-id="${d.id}">${isLocked ? '🔓' : '🔒'}</button>
                <button class="icon-btn delete-btn" title="Delete" data-id="${d.id}">🗑️</button>
                <button class="icon-btn reset-btn" title="Reset (Clear Content)" data-id="${d.id}">🔄</button>
            </div>
        `;

        item.querySelector('.load-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (loadDiagram(d.id)) {
                // Close modal on load
                document.getElementById('diagrams-modal').classList.add('hidden');
            }
        });

        item.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteDiagram(d.id);
        });

        item.querySelector('.lock-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDiagramLock(d.id);
        });
        
        item.querySelector('.reset-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            resetDiagram(d.id);
        });

        container.appendChild(item);
    });

    // Update new diagram button state
    updateNewDiagramButton();
    updateLoadButton();

    // Update badge
    updateDiagramsBadge();
}

function updateNewDiagramButton() {
    const btn = document.getElementById('new-diagram-btn');
    const btnText = document.getElementById('new-diagram-btn-text');
    if (!btn || !btnText) return;

    const diagrams = getAllDiagrams();
    const isAtMax = diagrams.length >= MAX_DIAGRAMS;

    if (isAtMax) {
        btn.disabled = true;
        btnText.textContent = `Max ${MAX_DIAGRAMS} Diagrams`;
        btn.title = `You've reached the maximum of ${MAX_DIAGRAMS} diagrams. Delete a diagram to create a new one.`;
    } else {
        btn.disabled = false;
        btnText.textContent = '+ New Diagram';
        btn.title = 'Create a new timeline diagram';
    }
}

function updateLoadButton() {
    const btn = document.getElementById('load-json');
    if (!btn) return;

    const diagrams = getAllDiagrams();
    const isAtMax = diagrams.length >= MAX_DIAGRAMS;

    if (isAtMax) {
        btn.disabled = true;
        btn.classList.add('btn-disabled-warn');
        btn.title = `You've reached the maximum of ${MAX_DIAGRAMS} diagrams. Delete a diagram to load a new one.`;
    } else {
        btn.disabled = false;
        btn.classList.remove('btn-disabled-warn');
        btn.title = 'Load diagram from JSON file';
    }
}

function toggleDiagramsPanel() {
    const modal = document.getElementById('diagrams-modal');
    if (modal) {
        modal.classList.remove('hidden');
        renderDiagramsList();
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

    // Handle sub-millisecond values (for extreme zoom)
    if (ms < 1 && ms > 0) {
        const us = ms * 1000; // Convert to microseconds
        if (us < 1) {
            const ns = us * 1000; // Convert to nanoseconds
            return `${ns.toFixed(ns < 10 ? 1 : 0)}ns`;
        }
        return `${us.toFixed(us < 10 ? 1 : 0)}μs`;
    }

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

/**
 * Format zoom level as a readable percentage string
 * Handles very large/small zoom levels gracefully
 */
function formatZoomLevel(pixelsPerMs) {
    const percent = (pixelsPerMs / 0.15) * 100;
    if (percent >= 10000) {
        return `${(percent / 1000).toFixed(0)}k%`;
    }
    if (percent < 1) {
        return `${percent.toFixed(1)}%`;
    }
    return `${Math.round(percent)}%`;
}

function msToPixels(ms) {
    return ms * app.pixelsPerMs;
}

function pixelsToMs(px) {
    return px / app.pixelsPerMs;
}

/**
 * Calculate the visual width of a box, applying duration scaling if enabled
 * @param {number} duration - The actual duration in ms
 * @returns {number} - The width in pixels
 */
function getBoxVisualWidth(duration) {
    const visualDuration = DurationScaling.getVisualDuration(duration);
    const minWidth = DurationScaling.getMinBoxWidth();
    return Math.max(msToPixels(visualDuration), minWidth);
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

        // V2: Use div.lane-name-div instead of input
        item.innerHTML = `
            <span class="lane-drag-handle" title="Drag to reorder">⋮⋮</span>
            <button class="lane-color-btn" data-lane-id="${lane.id}" title="Change lane color" style="${laneColorStyle}"></button>
            <div class="lane-name-div" data-lane-id="${lane.id}">${escapeHtml(lane.name).replace(/\n/g, '<br>')}</div>
            <div class="lane-controls">
                <button class="lane-control-btn move-up" data-lane-id="${lane.id}" title="Move up" ${isFirst ? 'disabled' : ''}>↑</button>
                <button class="lane-control-btn move-down" data-lane-id="${lane.id}" title="Move down" ${isLast ? 'disabled' : ''}>↓</button>
                <button class="lane-control-btn insert-before" data-lane-id="${lane.id}" data-index="${index}" title="Insert lane before">+↑</button>
                <button class="lane-control-btn insert-after" data-lane-id="${lane.id}" data-index="${index}" title="Insert lane after">+↓</button>
                <button class="lane-delete-btn" data-lane-id="${lane.id}" title="Delete lane">×</button>
            </div>
        `;

        // Add click listener to open properties on the item (excluding controls)
        item.addEventListener('click', (e) => {
            if (e.target.closest('.lane-control-btn') || e.target.closest('.lane-delete-btn') || e.target.closest('.lane-color-btn')) return;
            showLanePropertiesPanel(lane.id);
        });

        // Add double-click inline editing for lane name
        const laneNameDiv = item.querySelector('.lane-name-div');
        laneNameDiv.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;

            // Create textarea for editing
            const textarea = document.createElement('textarea');
            textarea.className = 'lane-name-edit-textarea';
            textarea.value = lane.name;
            textarea.rows = 3;

            // Replace div with textarea
            laneNameDiv.replaceWith(textarea);
            textarea.focus();
            textarea.select();

            const saveEdit = () => {
                const newName = textarea.value.trim() || 'Unnamed Lane';
                app.diagram.renameLane(lane.id, newName);
                renderLaneList();
                renderLanesCanvas();
                autoSave();
            };

            textarea.addEventListener('blur', saveEdit);
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    renderLaneList(); // Cancel edit
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                }
            });
        });

        container.appendChild(item);
    });

    // Re-attach Delete buttons
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

    // Move-up buttons
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

    // Move-down buttons
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

    // Insert-before buttons
    container.querySelectorAll('.lane-control-btn.insert-before').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const index = parseInt(e.target.dataset.index, 10);
            app.diagram.insertLaneAt(index);
            renderLaneList();
            renderLanesCanvas();
        });
    });

    // Insert-after buttons
    container.querySelectorAll('.lane-control-btn.insert-after').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isEditingAllowed()) return;
            const index = parseInt(e.target.dataset.index, 10);
            app.diagram.insertLaneAt(index + 1);
            renderLaneList();
            renderLanesCanvas();
        });
    });

    // Invoke global drag init if available (it attaches to container #lane-list)
    if (typeof initDragAndDrop === 'function') initDragAndDrop();
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

    ruler.innerHTML = '';

    // Use compressed or actual duration based on compression mode
    // Must match the calculation in renderLanesCanvas for scroll sync
    const displayDuration = Math.max(
        Compression.enabled ? Compression.getCompressedDuration() : app.diagram.getTotalDuration(),
        DEFAULT_MIN_TIMELINE_MS
    );

    // Calculate appropriate interval - extended for extreme zoom levels
    // Includes sub-millisecond intervals for high zoom
    let interval = 100; // Start with 100ms
    const intervals = [
        0.001, 0.002, 0.005,     // Microseconds (0.001ms = 1μs)
        0.01, 0.02, 0.05,        // Tens of microseconds
        0.1, 0.2, 0.5,           // Sub-millisecond
        1, 2, 5,                 // Milliseconds
        10, 20, 50,              // Tens of ms
        100, 200, 500,           // Hundreds of ms
        1000, 2000, 5000,        // Seconds
        10000, 30000, 60000,     // Tens of seconds / minute
        120000, 300000, 600000   // Minutes
    ];

    for (const int of intervals) {
        const pixelsPerInterval = msToPixels(int);
        if (pixelsPerInterval >= 60) {
            interval = int;
            break;
        }
    }
    // Fallback for extreme zoom out
    if (interval === 100 && msToPixels(600000) < 60) {
        interval = 600000; // 10 minutes
    }

    // Match the lane-track extension using trailing space setting
    const endTime = displayDuration + app.settings.trailingSpace;

    // Create an inner wrapper div to define scrollable width
    // (absolutely positioned children don't contribute to scroll width)
    const rulerWidth = msToPixels(endTime);
    const innerWrapper = document.createElement('div');
    innerWrapper.className = 'timeline-ruler-inner';
    innerWrapper.style.position = 'relative';
    innerWrapper.style.width = `${rulerWidth}px`;
    innerWrapper.style.height = '100%';
    ruler.appendChild(innerWrapper);

    if (Compression.enabled) {
        // HYBRID APPROACH: Show actual times at compressed positions with break markers
        const breakMarkers = Compression.getBreakMarkers();

        // Generate ruler marks at compressed positions but show actual times
        for (let compressedTime = 0; compressedTime <= endTime; compressedTime += interval) {
            // Convert compressed position to actual time for the label
            const actualTime = Compression.compressedToActual(compressedTime);

            const mark = document.createElement('div');
            mark.className = 'ruler-mark' + (compressedTime % (interval * 5) === 0 ? ' major' : '');
            mark.style.left = `${msToPixels(compressedTime)}px`;
            mark.innerHTML = `<span>${formatDuration(actualTime)}</span>`;
            innerWrapper.appendChild(mark);
        }

        // Add break markers at gap boundaries - single line with gap size label
        breakMarkers.forEach(marker => {
            const breakMark = document.createElement('div');
            breakMark.className = 'ruler-break-marker';
            breakMark.style.left = `${msToPixels(marker.compressedStart)}px`;
            const actualGapSize = marker.actualEnd - marker.actualStart;
            breakMark.title = `Gap: ${formatDuration(actualGapSize)} (${formatDuration(marker.actualStart)} → ${formatDuration(marker.actualEnd)})`;
            breakMark.innerHTML = `<span class="break-label">${formatDuration(actualGapSize)}</span>`;
            innerWrapper.appendChild(breakMark);
        });
    } else {
        // Normal mode: show time at corresponding position
        for (let time = 0; time <= endTime; time += interval) {
            const mark = document.createElement('div');
            mark.className = 'ruler-mark' + (time % (interval * 5) === 0 ? ' major' : '');
            mark.style.left = `${msToPixels(time)}px`;
            mark.innerHTML = `<span>${formatDuration(time)}</span>`;
            innerWrapper.appendChild(mark);
        }
    }
}

function renderLanesCanvas() {
    const canvas = app.elements.lanesCanvas;
    canvas.innerHTML = '';

    // STRICT DURATION LOGIC
    // User wants: Duration value MUST affect design area first.
    // But also "Prevent design area from being decreased below end-time of last box"

    const totalDuration = app.diagram.getTotalDuration();
    const settingsDuration = app.settings.timelineDuration || 8000;

    // Ensure strictly >= totalDuration
    const finalDuration = Math.max(totalDuration, settingsDuration);

    // Use exact pixels unless compressed
    const minTrackWidth = msToPixels(finalDuration + (app.settings.trailingSpace || 0));

    app.diagram.lanes.forEach(lane => {
        const row = document.createElement('div');
        row.className = 'lane-row';
        row.dataset.laneId = lane.id;
        // Min-width for scrolling - considering sticky label
        // Note: If labels are hidden, --lane-label-width is 0px
        row.style.minWidth = `calc(var(--lane-label-width) + ${minTrackWidth}px)`;

        const label = document.createElement('div');
        label.className = 'lane-label';
        label.innerHTML = escapeHtml(lane.name).replace(/\n/g, '<br>');
        label.title = lane.name;

        const track = document.createElement('div');
        track.className = 'lane-track';
        track.dataset.laneId = lane.id;

        // Force explicit width to enable scrolling
        track.style.minWidth = `${minTrackWidth}px`;
        track.style.width = `${minTrackWidth}px`;

        // Compression indicators
        if (Compression.enabled) {
            const gaps = Compression.getCompressedGaps();
            gaps.forEach(gap => {
                const indicator = document.createElement('div');
                indicator.className = 'compression-indicator';
                indicator.style.left = `${msToPixels(gap.compressedStart)}px`;
                indicator.title = `Gap: ${formatDuration(gap.originalSize)}`;
                track.appendChild(indicator);
            });
        }

        // Render boxes
        const boxes = app.diagram.getBoxesForLane(lane.id);
        boxes.forEach(box => {
            const boxEl = createBoxElement(box);
            track.appendChild(boxEl);
        });

        row.appendChild(label);
        row.appendChild(track);
        canvas.appendChild(row);
    });

    // Event listeners handling
    canvas.querySelectorAll('.lane-track').forEach(track => {
        track.addEventListener('mousedown', handleTrackMouseDown);
    });

    renderTimelineRuler();
    renderAlignmentMarkers();
    renderTimeMarkers();
    Minimap.render();
}

function createBoxElement(box) {
    const el = document.createElement('div');
    el.className = 'timeline-box' + (box.id === app.selectedBoxId ? ' selected' : '');
    el.dataset.boxId = box.id;

    // Use compressed offset if compression is enabled
    const visualOffset = Compression.getVisualOffset(box);
    const left = msToPixels(visualOffset);
    const width = getBoxVisualWidth(box.duration); // Apply duration scaling

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
        // Only select on true clicks, not after drag/resize
        // Check if last drag involved actual movement
        if (!app.lastDragDidMove) {
            selectBox(box.id);
        }
        // Reset flag
        app.lastDragDidMove = false;
    });

    // Box dragging (move)
    el.addEventListener('mousedown', (e) => {
        if (app.isPicking) {
            e.stopPropagation();
            e.preventDefault();
            completePickStart(box.id);
            return;
        }

        // Allow measurement to start from box - don't intercept if Cmd/Ctrl held or measure mode active
        if (e.ctrlKey || e.metaKey || app.measureToolActive) {
            // Don't stop propagation - let canvas handler start measurement
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
            <span class="label">Duration:</span>
            <span class="value">${formatDuration(box.duration)}</span>
        </div>
        <div class="tooltip-row">
            <span class="label">Start:</span>
            <span class="value">+${formatDuration(box.startOffset)} (${formatTime(baseTime + box.startOffset)})</span>
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

    // Collect all visual time points with their box colors
    // In compression mode, use compressed visual positions
    const timePointsMap = new Map(); // visualTime -> color (first box's color at that time)
    app.diagram.boxes.forEach(box => {
        // Get visual positions (compressed if compression enabled)
        const visualStart = Compression.enabled ? Compression.getVisualOffset(box) : box.startOffset;
        const visualEnd = visualStart + box.duration; // Duration stays the same visually

        if (!timePointsMap.has(visualStart)) {
            timePointsMap.set(visualStart, box.color);
        }
        if (!timePointsMap.has(visualEnd)) {
            timePointsMap.set(visualEnd, box.color);
        }
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

    // In v2, positioning and visibility checks need different offsets
    const isV2 = document.getElementById('right-sidebar') !== null;

    // Positioning: where to draw the line in viewport coordinates
    const positionOffsetX = isV2 ? sidebarWidth : (sidebarWidth + laneLabelWidth);

    // Visibility threshold: skip lines that would be covered by sticky lane-labels
    const visibilityThresholdX = sidebarWidth + laneLabelWidth;

    const offsetY = headerHeight + rulerHeight;
    const canvasHeight = canvas.scrollHeight;
    const scrollLeft = canvas.scrollLeft; // Account for horizontal scroll

    timePointsMap.forEach((color, visualTime) => {
        const x = positionOffsetX + msToPixels(visualTime) - scrollLeft;

        // Only draw lines that are visible in the track area (not covered by lane-labels or sidebar)
        if (x < visibilityThresholdX) {
            return; // Line would be covered by lane-labels or sidebar, skip it
        }

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'alignment-line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', offsetY);
        line.setAttribute('x2', x);
        // End at the bottom of the lanes canvas (scrollbar area)
        line.setAttribute('y2', offsetY + canvasHeight);
        // Apply box color to the dashed line
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-opacity', '0.5');

        svg.appendChild(line);
    });
}

function updateTotalDuration() {
    const duration = app.diagram.getTotalDuration();
    app.elements.totalDuration.textContent = formatDuration(duration);
    // Auto-save on any change that updates duration
    autoSave();
}

function updatePropertiesPanel(isNewBox = false) {
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

    // Determine if panel should be visible:
    // - If this is a NEW box: only open if autoOpenBoxProperties is enabled
    // - If clicking existing box: always open
    // - If updating (drag/resize): keep current visibility
    const panelWasVisible = !panel.classList.contains('hidden');
    if (isNewBox) {
        // New box created - respect setting
        if (app.settings.autoOpenBoxProperties) {
            panel.classList.remove('hidden');
        }
    } else if (!panelWasVisible) {
        // Not a new box and panel was closed - this is a click on existing box, open it
        panel.classList.remove('hidden');
    }
    // If panel was already visible, keep it visible (already the case)

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

    // Match the ruler and lane-track width using trailing space setting
    // Use compressed duration if compression is enabled
    const actualTotalDuration = Math.max(app.diagram.getTotalDuration(), DEFAULT_MIN_TIMELINE_MS);
    const displayDuration = Compression.enabled
        ? Compression.getCompressedDuration()
        : actualTotalDuration;
    const endTime = displayDuration + app.settings.trailingSpace;
    const markerWidth = msToPixels(endTime);

    // Create an inner wrapper div to define scrollable width
    // (absolutely positioned children don't contribute to scroll width)
    const innerWrapper = document.createElement('div');
    innerWrapper.className = 'time-markers-inner';
    innerWrapper.style.position = 'relative';
    innerWrapper.style.width = `${markerWidth}px`;
    innerWrapper.style.height = '100%';
    container.appendChild(innerWrapper);

    if (app.diagram.boxes.length === 0) return;

    // Collect all time points
    const markers = [];

    app.diagram.boxes.forEach(box => {
        // Get visual (compressed) offset for positioning
        const visualOffset = Compression.getVisualOffset(box);
        const visualEnd = visualOffset + box.duration;
        // Actual times for labels
        const actualStart = box.startOffset;
        const actualEnd = box.startOffset + box.duration;

        markers.push({
            visualTime: visualOffset,      // For positioning
            actualTime: actualStart,       // For label
            type: 'start',
            boxId: box.id,
            color: box.color,
            label: formatDuration(actualStart)
        });
        markers.push({
            visualTime: visualEnd,         // For positioning
            actualTime: actualEnd,         // For label
            type: 'end',
            boxId: box.id,
            color: box.color,
            label: formatDuration(actualEnd)
        });
    });

    // Sort by visual time for proper layout
    markers.sort((a, b) => a.visualTime - b.visualTime);

    // Layout Logic: Horizontal text with vertical stacking for collisions
    const levels = [];
    const charWidth = 7;
    const padding = 10;

    markers.forEach(m => {
        const x = msToPixels(m.visualTime);
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

    // Get the height of the lanes canvas to calculate line height
    const lanesCanvas = app.elements.lanesCanvas;
    const lanesCanvasHeight = lanesCanvas ? lanesCanvas.offsetHeight : 200;

    markers.forEach(m => {
        const x = msToPixels(m.visualTime);

        const el = document.createElement('div');
        el.className = 'time-marker-h';
        el.style.left = `${x}px`;
        el.style.bottom = `${4 + (m.level * 16)}px`;
        el.style.color = m.color;

        // Vertical colored line extending upward to the lanes canvas
        const line = document.createElement('div');
        line.className = 'time-marker-line';
        line.style.backgroundColor = m.color;
        // Height extends from current position up through lanes canvas
        line.style.height = `${lanesCanvasHeight + 80}px`;

        const tick = document.createElement('div');
        tick.className = 'time-marker-tick';
        tick.style.backgroundColor = m.color;

        const label = document.createElement('span');
        label.className = 'time-marker-text';
        label.textContent = m.text;

        el.appendChild(line);
        el.appendChild(tick);
        el.appendChild(label);
        innerWrapper.appendChild(el);
    });
}

// =====================================================
// Interaction Handlers
// =====================================================
function selectBox(boxId, isNewBox = false) {
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

    updatePropertiesPanel(isNewBox);

    // Glimpse the pick-start button to draw attention
    setTimeout(() => {
        glimpsePickStartButton();
    }, 100);
}

function deselectBox() {
    app.selectedBoxId = null;
    document.querySelectorAll('.timeline-box.selected').forEach(el => {
        el.classList.remove('selected');
    });
    if (app.elements.propertiesPanel) {
        app.elements.propertiesPanel.classList.add('hidden');
    }

    // Remove active state from settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) settingsBtn.classList.remove('active');

    // Remove glimpsed state from pick-start button
    const pickBtn = document.getElementById('pick-start-btn');
    if (pickBtn) pickBtn.classList.remove('glimpsed');
}

function handleTrackMouseDown(e) {
    // Only handle left-click (button 0), allow right-click for context menu
    if (e.button !== 0) {
        return;
    }

    // Don't create boxes while measuring or in measurement mode
    if (app.isMeasuring || app.measureToolActive || e.ctrlKey || e.metaKey) {
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
        document.body.classList.remove('picking-mode');
        const btn = document.getElementById('pick-start-btn');
        if (btn) btn.classList.remove('active');

        // Remove toast and visual feedback
        hidePickModeToast();
        clearPickableColors();
        document.querySelectorAll('.timeline-box').forEach(box => {
            box.classList.remove('pickable');
        });

        showToast({
            type: 'info',
            title: 'Pick Mode Cancelled',
            duration: 2000
        });
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

    // Track that actual movement occurred during drag
    if (!app.dragData.didMove) {
        app.dragData.didMove = true;
    }

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
        let newStart = Math.max(0, pixelsToMs(newX));

        // In compression mode, convert visual position to actual time
        if (Compression.enabled) {
            newStart = Compression.compressedToActual(newStart);
        }

        box.startOffset = Math.round(newStart);

        // Invalidate compression cache after changing position, then get visual offset
        if (Compression.enabled) {
            Compression.invalidate();
        }

        // In compression mode, use visual offset for display; otherwise use actual
        const boxEl = document.querySelector(`.timeline-box[data-box-id="${box.id}"]`);
        if (boxEl) {
            const visualOffset = Compression.enabled ? Compression.getVisualOffset(box) : box.startOffset;
            boxEl.style.left = `${msToPixels(visualOffset)}px`;
        }
        renderTimeMarkers();
        renderAlignmentMarkers();
        updatePropertiesPanel();
    } else if (app.dragData.type === 'resize') {
        const box = app.diagram.boxes.find(b => b.id === app.dragData.boxId);
        if (!box) return;

        const track = document.querySelector(`.lane-track[data-lane-id="${box.laneId}"]`);
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        let mouseMs = pixelsToMs(mouseX);

        // In compression mode, convert visual position to actual time
        if (Compression.enabled) {
            mouseMs = Compression.compressedToActual(mouseMs);
        }

        if (app.dragData.side === 'right') {
            const newDuration = Math.max(50, mouseMs - box.startOffset);
            box.duration = Math.round(newDuration);
        } else {
            const endOffset = app.dragData.originalStart + app.dragData.originalDuration;
            const newStart = Math.max(0, Math.min(mouseMs, endOffset - 50));
            box.startOffset = Math.round(newStart);
            box.duration = Math.round(endOffset - box.startOffset);
        }

        // Invalidate compression cache after changing size/position, then get visual offset
        if (Compression.enabled) {
            Compression.invalidate();
        }

        const boxEl = document.querySelector(`.timeline-box[data-box-id="${box.id}"]`);
        if (boxEl) {
            // In compression mode, use visual offset for display; otherwise use actual
            const visualOffset = Compression.enabled ? Compression.getVisualOffset(box) : box.startOffset;
            boxEl.style.left = `${msToPixels(visualOffset)}px`;
            boxEl.style.width = `${getBoxVisualWidth(box.duration)}px`;

            const labelText = box.label ? `${box.label} (${formatDuration(box.duration)})` : formatDuration(box.duration);
            const labelEl = boxEl.querySelector('.box-label');
            if (labelEl) labelEl.textContent = labelText;
        }
        renderTimeMarkers();
        renderAlignmentMarkers();

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
            const rightX = Math.max(endX, app.dragData.startX);

            // Convert visual positions to actual times (handles compression mode)
            let actualStartMs = pixelsToMs(Math.max(0, leftX));
            let actualEndMs = pixelsToMs(Math.max(0, rightX));

            // In compression mode, convert visual positions to actual times
            if (Compression.enabled) {
                actualStartMs = Compression.compressedToActual(actualStartMs);
                actualEndMs = Compression.compressedToActual(actualEndMs);
            }

            const startOffset = actualStartMs;
            const duration = Math.max(actualEndMs - actualStartMs, 20);

            const box = app.diagram.addBox(
                app.dragData.laneId,
                Math.round(startOffset),
                Math.round(duration),
                '',
                getAutoBoxColor(app.dragData.laneId)
            );

            // Invalidate compression cache since gaps may have changed
            if (Compression.enabled) {
                Compression.invalidate();
            }

            renderTimelineRuler();
            renderLanesCanvas();
            renderTimeMarkers();
            updateTotalDuration();
            Minimap.render();

            // Select the box (and open properties if auto-open is enabled)
            selectBox(box.id, true);
        }
    } else if (app.dragData.type === 'move' || app.dragData.type === 'resize') {
        // Recalculate compression gaps after moving/resizing
        if (Compression.enabled) {
            Compression.invalidate();
            renderTimelineRuler();
            renderLanesCanvas();
            renderTimeMarkers();
            Minimap.render();
        } else {
            renderTimelineRuler();
        }
        renderAlignmentMarkers();
        updateTotalDuration();
        updatePropertiesPanel();
    }

    // Track if movement occurred during drag (for click suppression)
    app.lastDragDidMove = app.dragData && app.dragData.didMove;

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

function toggleMeasurementTool() {
    app.measureToolActive = !app.measureToolActive;
    const btn = document.getElementById('measure-tool-btn');

    if (app.measureToolActive) {
        btn.classList.add('active');
        document.body.style.cursor = 'crosshair';
        showToast({
            type: 'info',
            title: 'Measurement Mode Active',
            message: 'Click and drag on the timeline to measure durations',
            duration: 2500
        });
    } else {
        btn.classList.remove('active');
        document.body.style.cursor = '';
        closeMeasurement();
    }
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

    // Calculate visual positions in timeline coordinates (subtract lane label width)
    const visualStartMs = pixelsToMs(Math.min(app.measureStart.x, app.measureEnd.x) - 160);
    const visualEndMs = pixelsToMs(Math.max(app.measureStart.x, app.measureEnd.x) - 160);

    // In compression mode, convert visual positions to actual times
    let actualStartMs, actualEndMs, actualDuration;
    if (Compression.enabled) {
        actualStartMs = Compression.compressedToActual(Math.max(0, visualStartMs));
        actualEndMs = Compression.compressedToActual(Math.max(0, visualEndMs));
        actualDuration = actualEndMs - actualStartMs;
    } else {
        actualStartMs = Math.max(0, visualStartMs);
        actualEndMs = Math.max(0, visualEndMs);
        actualDuration = actualEndMs - actualStartMs;
    }

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

    // Format the measurement text (always show actual duration)
    const timeText = formatDuration(Math.round(actualDuration));
    label.textContent = timeText;

    // Update info box
    const infoBox = document.getElementById('measurement-info');

    const pinBtnClass = app.measurePinned ? 'measure-pin-btn active' : 'measure-pin-btn';
    const pinTitle = app.measurePinned ? 'Unpin measurement' : 'Pin measurement';

    // Show actual times in the info box
    infoBox.innerHTML = `
        <div class="measure-header">
            <button class="${pinBtnClass}" onclick="toggleMeasurementPin()" title="${pinTitle}">📌</button>
            <button class="measure-close-btn" onclick="closeMeasurement()" title="Close measurement">×</button>
        </div>
        <div class="measure-row"><span>Duration:</span><strong>${timeText}</strong></div>
        <div class="measure-row"><span>Start:</span>${formatDuration(Math.round(actualStartMs))}</div>
        <div class="measure-row"><span>End:</span>${formatDuration(Math.round(actualEndMs))}</div>
    `;

    // Position info box with accurate distance calculation for rectangular box
    const boxWidth = 200;
    const boxHeight = 150;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate arrow angle in radians
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const arrowAngle = Math.atan2(deltaY, deltaX);

    // Calculate opposite angle (arrow direction + 180 degrees)
    const oppositeAngle = arrowAngle + Math.PI;

    // Calculate distance from box center to edge in the opposite direction
    // oppositeAngle already points opposite to arrow (arrow + 180°)
    const dx = Math.cos(oppositeAngle);
    const dy = Math.sin(oppositeAngle);

    // Calculate intersection with box rectangle from center
    const halfWidth = boxWidth / 2;
    const halfHeight = boxHeight / 2;

    // Distance to edge: min of distance to vertical and horizontal edges
    const tX = dx !== 0 ? Math.abs(halfWidth / dx) : Infinity;
    const tY = dy !== 0 ? Math.abs(halfHeight / dy) : Infinity;
    const t = Math.min(tX, tY);

    const distanceToEdge = t;

    // Add clearance to ensure no overlap
    const clearance = 25;
    const totalDistance = distanceToEdge + clearance;

    // Position box CENTER at this distance in opposite direction from arrow
    const boxCenterX = startX + Math.cos(oppositeAngle) * totalDistance;
    const boxCenterY = startY + Math.sin(oppositeAngle) * totalDistance;

    // Convert center position to top-left corner for CSS positioning
    const boxLeft = boxCenterX - halfWidth;
    const boxTop = boxCenterY - halfHeight;

    // Clamp to viewport boundaries
    const padding = 20;
    const clampedX = Math.max(padding, Math.min(boxLeft, viewportWidth - boxWidth - padding));
    const clampedY = Math.max(padding, Math.min(boxTop, viewportHeight - boxHeight - padding));

    infoBox.style.left = `${clampedX}px`;
    infoBox.style.top = `${clampedY}px`;
}

function handleZoom(direction) {
    const canvas = app.elements.lanesCanvas;
    const laneLabelWidth = 160; // var(--lane-label-width)

    // Get current viewport center in time (ms)
    const viewportWidth = canvas.clientWidth - laneLabelWidth;
    const scrollLeft = canvas.scrollLeft;
    const centerX = scrollLeft + viewportWidth / 2;
    const centerTimeMs = centerX / app.pixelsPerMs;

    // Apply zoom
    const factor = direction === 'in' ? 1.25 : 0.8;
    const oldScale = app.pixelsPerMs;
    app.pixelsPerMs = Math.max(app.minPixelsPerMs,
        Math.min(app.maxPixelsPerMs, app.pixelsPerMs * factor));

    app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);

    renderLanesCanvas();

    // Restore scroll position to keep the same time at center
    const newCenterX = centerTimeMs * app.pixelsPerMs;
    const newScrollLeft = newCenterX - viewportWidth / 2;
    canvas.scrollLeft = Math.max(0, newScrollLeft);

    // Sync ruler and markers
    app.elements.timelineRuler.scrollLeft = canvas.scrollLeft;
    app.elements.timeMarkers.scrollLeft = canvas.scrollLeft;
}

function handleZoomFit() {
    const totalDuration = app.diagram.getTotalDuration();
    if (totalDuration === 0) return;

    const canvasWidth = app.elements.lanesCanvas.clientWidth - 180; // Account for lane label
    app.pixelsPerMs = Math.max(app.minPixelsPerMs,
        Math.min(app.maxPixelsPerMs, canvasWidth / (totalDuration * 1.1)));

    app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);

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
    // Check if we've reached the maximum number of diagrams
    const diagrams = getAllDiagrams();
    if (diagrams.length >= MAX_DIAGRAMS) {
        showToast({
            type: 'warning',
            title: 'Maximum Diagrams Reached',
            message: `You can only have ${MAX_DIAGRAMS} diagrams. Delete one to load a new diagram.`,
            duration: 4000
        });
        // Reset file input so the same file can be selected again
        app.elements.fileInput.value = '';
        return;
    }

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
        // Reset file input
        app.elements.fileInput.value = '';
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
        // Show enhanced success message
        const btn = document.getElementById('share-url');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.background = 'var(--success)';

        // Show instructive toast
        showToast({
            type: 'success',
            title: 'Link Copied!',
            message: 'Share this URL with collaborators to view your timeline diagram.',
            duration: 3500
        });

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2500);
    }).catch(err => {
        // Fallback: show URL in prompt
        showToast({
            type: 'warning',
            title: 'Copy Failed',
            message: 'Please copy the URL manually.',
            duration: 3000
        });
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

    // Draw alignment lines if enabled (with box colors)
    if (app.settings.showAlignmentLines && boxes.length > 0) {
        // Collect time points with their colors
        const timePointsMap = new Map();
        boxes.forEach(box => {
            if (!timePointsMap.has(box.startOffset)) {
                timePointsMap.set(box.startOffset, box.color);
            }
            const endTime = box.startOffset + box.duration;
            if (!timePointsMap.has(endTime)) {
                timePointsMap.set(endTime, box.color);
            }
        });

        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;

        timePointsMap.forEach((color, time) => {
            const x = laneLabelWidth + msToPixels(time);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.moveTo(x, lanesStartY);
            ctx.lineTo(x, lanesStartY + lanesAreaHeight);
            ctx.stroke();
        });

        ctx.globalAlpha = 1;
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
            const bw = getBoxVisualWidth(box.duration);
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

    // Draw time markers with vertical lines extending up through lanes
    ctx.font = '9px Monaco, monospace';
    markers.forEach(m => {
        const yPos = timeMarkersY + timeMarkersHeight - 6 - (m.level * 14);

        // Draw vertical line extending up through lanes area (solid, colored)
        ctx.strokeStyle = m.color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(m.x, lanesStartY);
        ctx.lineTo(m.x, timeMarkersY);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Draw tick line in time markers area
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1;
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

    // Alignment lines if enabled (with box colors)
    if (app.settings.showAlignmentLines && boxes.length > 0) {
        // Collect time points with their colors
        const timePointsMap = new Map();
        boxes.forEach(box => {
            if (!timePointsMap.has(box.startOffset)) {
                timePointsMap.set(box.startOffset, box.color);
            }
            const endTime = box.startOffset + box.duration;
            if (!timePointsMap.has(endTime)) {
                timePointsMap.set(endTime, box.color);
            }
        });

        svg += `  <!-- Alignment Lines -->\n`;
        timePointsMap.forEach((color, time) => {
            const x = Math.round(laneLabelWidth + msToPixels(time));
            svg += `  <line x1="${x}" y1="${lanesStartY}" x2="${x}" y2="${lanesStartY + lanesAreaHeight}" stroke="${color}" stroke-opacity="0.5" stroke-dasharray="4 4"/>\n`;
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
            const bw = Math.round(getBoxVisualWidth(box.duration));
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

    // Draw time markers with colored labels and vertical lines extending up
    markers.forEach(m => {
        const yPos = timeMarkersY + timeMarkersHeight - 6 - (m.level * 14);
        // Vertical line extending up through lanes area (solid, colored)
        svg += `  <line x1="${Math.round(m.x)}" y1="${lanesStartY}" x2="${Math.round(m.x)}" y2="${timeMarkersY}" stroke="${m.color}" stroke-opacity="0.4"/>\n`;
        // Tick line in time markers area
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
    const settingsProps = document.getElementById('settings-props');
    const settingsBtn = document.getElementById('settings-btn');

    // Toggle behavior: if settings panel is open, close it
    if (panel.classList.contains('hidden') === false &&
        settingsProps.classList.contains('hidden') === false) {
        panel.classList.add('hidden');
        if (settingsBtn) settingsBtn.classList.remove('active');
        return;
    }

    const boxProps = document.getElementById('box-props');
    const laneProps = document.getElementById('lane-props');
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

    const autoOpenCheckbox = document.getElementById('config-auto-open-properties');
    if (autoOpenCheckbox) {
        autoOpenCheckbox.checked = app.settings.autoOpenBoxProperties;
    }

    // Deselect any box/lane
    app.selectedBoxId = null;
    app.selectedLaneId = null;
    document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));

    panel.classList.remove('hidden');
    if (settingsBtn) settingsBtn.classList.add('active');
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

    // Auto-open box properties toggle
    const autoOpenCheckbox = document.getElementById('config-auto-open-properties');
    if (autoOpenCheckbox) {
        app.settings.autoOpenBoxProperties = autoOpenCheckbox.checked;
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
// Pick Mode Helper Functions
// =====================================================
function showPickModeToast() {
    // Hide any existing pick mode toast first
    hidePickModeToast();

    // Show toast for 10 seconds
    app.pickModeToast = showToast({
        type: 'info',
        title: 'Pick Mode Active',
        message: 'Click any box to set start time to its end time',
        duration: 10000
    });
}

function hidePickModeToast() {
    if (app.pickModeToast) {
        hideToast(app.pickModeToast);
        app.pickModeToast = null;
    }
}

// Helper function to get contrast color for a given color
function getContrastGlowColor(colorStr) {
    let r, g, b;

    // Handle rgb() or rgba() format
    const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1], 10);
        g = parseInt(rgbMatch[2], 10);
        b = parseInt(rgbMatch[3], 10);
    } else {
        // Handle hex format
        let hex = colorStr.replace('#', '');
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    }

    // Convert RGB to HSL
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break;
            case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break;
            case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break;
        }
    }

    // Get complementary hue (opposite on color wheel)
    let newH = (h + 0.5) % 1;
    // Use high saturation and appropriate lightness for visibility
    let newS = Math.max(s, 0.8); // Ensure saturation is high
    let newL = l > 0.5 ? 0.4 : 0.7; // Dark glow for light boxes, light glow for dark boxes

    // Convert HSL back to RGB
    function hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    return hslToRgb(newH, newS, newL);
}

// Apply contrast color to pickable boxes via CSS variable
function applyPickableColors() {
    document.querySelectorAll('.timeline-box.pickable').forEach(boxEl => {
        // Get color directly from the element's background
        const bgColor = boxEl.style.backgroundColor;
        if (bgColor) {
            const c = getContrastGlowColor(bgColor);
            const color = `rgb(${c.r}, ${c.g}, ${c.b})`;
            boxEl.style.setProperty('--pickable-color', color);
        }
    });
}

function clearPickableColors() {
    document.querySelectorAll('.timeline-box').forEach(boxEl => {
        boxEl.style.removeProperty('--pickable-color');
    });
}

function glimpsePickStartButton() {
    const btn = document.getElementById('pick-start-btn');
    if (!btn) return;

    // Add glimpse class for animation
    btn.classList.add('glimpse');

    // After animation completes, keep the green border
    setTimeout(() => {
        btn.classList.remove('glimpse');
        btn.classList.add('glimpsed');
    }, 750);
}

// =====================================================
// Initialization
// =====================================================
function enterPickMode() {
    if (!app.selectedBoxId) return;
    if (!isEditingAllowed()) return;

    // Toggle behavior: if already picking, cancel
    if (app.isPicking) {
        cancelPickMode();
        return;
    }

    app.isPicking = true;
    document.body.style.cursor = 'crosshair';
    document.body.classList.add('picking-mode');
    const btn = document.getElementById('pick-start-btn');
    if (btn) btn.classList.add('active');

    // Show toast message
    showPickModeToast();

    // Add visual feedback - highlight all boxes with contrast glow colors
    document.querySelectorAll('.timeline-box').forEach(boxEl => {
        boxEl.classList.add('pickable');
    });

    // Apply contrast colors to each box
    applyPickableColors();
}

function cancelPickMode() {
    if (!app.isPicking) return;

    app.isPicking = false;
    document.body.style.cursor = '';
    document.body.classList.remove('picking-mode');
    const btn = document.getElementById('pick-start-btn');
    if (btn) btn.classList.remove('active');

    // Remove toast and visual feedback
    hidePickModeToast();
    clearPickableColors();
    document.querySelectorAll('.timeline-box').forEach(box => {
        box.classList.remove('pickable');
    });
}

function completePickStart(targetBoxId) {
    if (!app.selectedBoxId) {
        app.isPicking = false;
        document.body.style.cursor = '';
        document.body.classList.remove('picking-mode');
        return;
    }

    // Check if editing is allowed (diagram not locked)
    if (!isEditingAllowed()) {
        app.isPicking = false;
        document.body.style.cursor = '';
        document.body.classList.remove('picking-mode');
        const btn = document.getElementById('pick-start-btn');
        if (btn) btn.classList.remove('active');

        // Remove toast and visual feedback
        hidePickModeToast();
        clearPickableColors();
        document.querySelectorAll('.timeline-box').forEach(box => {
            box.classList.remove('pickable');
        });
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
    document.body.classList.remove('picking-mode');
    const btn = document.getElementById('pick-start-btn');
    if (btn) btn.classList.remove('active');

    // Remove toast and visual feedback
    hidePickModeToast();
    clearPickableColors();
    document.querySelectorAll('.timeline-box').forEach(box => {
        box.classList.remove('pickable');
    });
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

    // Synchronize scroll between canvas, ruler, time markers, and alignment lines
    app.elements.lanesCanvas.addEventListener('scroll', (e) => {
        const scrollLeft = e.target.scrollLeft;

        // Synchronize horizontal scroll position
        app.elements.timelineRuler.scrollLeft = scrollLeft;
        app.elements.timeMarkers.scrollLeft = scrollLeft;

        // Update alignment markers to account for scroll position
        renderAlignmentMarkers();

        // Update minimap viewport indicator
        Minimap.updateViewport();
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

    const autoOpenCheckbox = document.getElementById('config-auto-open-properties');
    if (autoOpenCheckbox) {
        autoOpenCheckbox.addEventListener('change', handleSettingsChange);
    }

    // Duration Scaling controls (PoC - Removable)
    initDurationScalingUI();

    // Initialize Minimap
    Minimap.init();

    // Compress toggle button
    const compressToggle = document.getElementById('compress-toggle');
    if (compressToggle) {
        compressToggle.addEventListener('click', () => Compression.toggle());
    }

    // Trailing space controls
    const trailingSlider = document.getElementById('config-trailing-slider');
    const trailingInput = document.getElementById('config-trailing-space');
    if (trailingSlider && trailingInput) {
        // Initialize with current value
        trailingSlider.value = app.settings.trailingSpace;
        trailingInput.value = app.settings.trailingSpace;

        const syncTrailing = (value) => {
            app.settings.trailingSpace = parseInt(value, 10);
            trailingSlider.value = value;
            trailingInput.value = value;
            renderLanesCanvas();
            Minimap.render();
        };
        trailingSlider.addEventListener('input', () => syncTrailing(trailingSlider.value));
        trailingInput.addEventListener('change', () => syncTrailing(trailingInput.value));
    }

    // Compression threshold controls
    const compressionSlider = document.getElementById('config-compression-slider');
    const compressionInput = document.getElementById('config-compression-threshold');
    if (compressionSlider && compressionInput) {
        const syncCompression = (value) => {
            app.settings.compressionThreshold = parseInt(value, 10);
            compressionSlider.value = value;
            compressionInput.value = value;
            if (Compression.enabled) {
                Compression.invalidate(); // Clear cache before re-render
                renderTimelineRuler();
                renderLanesCanvas();
                renderTimeMarkers();
                Minimap.render();
            }
        };
        compressionSlider.addEventListener('input', () => syncCompression(compressionSlider.value));
        compressionInput.addEventListener('change', () => syncCompression(compressionInput.value));
    }

    // Also sync header title input changes to settings
    app.elements.diagramTitle.addEventListener('input', (e) => {
        app.diagram.title = e.target.value;
    });

    // Lane name change handler in properties panel
    const laneNameInput = document.getElementById('lane-name');
    if (laneNameInput) {
        laneNameInput.addEventListener('change', handleLaneNameChange);
        // Enter key applies and unfocuses
        laneNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLaneNameChange();
                laneNameInput.blur();
            }
        });
    }

    // Diagram title Enter key handler
    app.elements.diagramTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            app.diagram.title = e.target.value;
            autoSave();
            renderDiagramsList();
            e.target.blur();
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

    // V1 only - close-properties button (V2 uses close-right-sidebar handled by V2 module)
    const closePropsBtn = document.getElementById('close-properties');
    if (closePropsBtn) {
        closePropsBtn.addEventListener('click', deselectBox);
    }

    document.getElementById('delete-box').addEventListener('click', handleDeleteBox);

    // Global mouse events for dragging
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Measurement tool - Cmd/Ctrl + Left Click or measurement tool button active
    app.elements.lanesCanvas.addEventListener('mousedown', (e) => {
        if ((e.ctrlKey || e.metaKey || app.measureToolActive) && e.button === 0) {
            // Check if click is on scrollbar (not on content area)
            const canvas = app.elements.lanesCanvas;
            const rect = canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            // If clicking in scrollbar area (beyond client area), don't start measurement
            if (clickX >= canvas.clientWidth || clickY >= canvas.clientHeight) {
                return; // Click is on scrollbar, ignore
            }

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
            // Cancel pick mode first if active
            if (app.isPicking) {
                cancelPickMode();
                return;
            }
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

    // Measurement tool button
    document.getElementById('measure-tool-btn').addEventListener('click', toggleMeasurementTool);

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

    // Open diagrams panel by default if there are saved diagrams (V1 only)
    const diagrams = getAllDiagrams();
    const diagramsPanel = document.getElementById('diagrams-panel');
    if (diagrams.length > 0 && diagramsPanel) {
        diagramsPanel.classList.add('open');
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);


// =====================================================
// V2 UI COMPATIBILITY LAYER
// Detects index-v2.html and patches app behavior:
// - Right sidebar replaces floating properties panel
// - Modal for diagram management
// - Theme toggle (dark/light)
// - Click-to-activate lane controls
// - Timeline Duration setting
// - Lane color sync fix
// =====================================================

const V2 = {
    isV2: false,
    rightSidebar: null,
    rightSidebarTitle: null,
    currentMode: null, // 'settings', 'box', 'lane'

    /**
     * Detect v2 and initialize
     */
    init() {
        this.rightSidebar = document.getElementById('right-sidebar');
        if (!this.rightSidebar) return; // Not v2 — do nothing

        this.isV2 = true;
        this.rightSidebarTitle = document.getElementById('right-sidebar-title');

        // Patch app.elements.propertiesPanel to point to right sidebar
        // (This allows existing app logic to interact with the sidebar container)
        app.elements.propertiesPanel = this.rightSidebar;

        // 1. Patch global functions FIRST so other listeners resolve to new logic
        this.patchFunctions();

        // 2. Initialize V2 UI components
        this.initRightSidebar();
        this.initDiagramsModal();
        this.initThemeToggle();
        this.initLaneControlsClick();
        this.initTimelineDuration();
        this.initLockToggle();

        // 3. Update UI state
        this.updateDiagramsBadge();
    },

    /**
     * Right sidebar toggle
     */
    initRightSidebar() {
        const closeBtn = document.getElementById('close-right-sidebar');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideRightSidebar());
        }

        // Clone Settings button to remove init() listener (which pointed to old showSettingsPanel)
        // and attach V2 listener
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            const newBtn = settingsBtn.cloneNode(true);
            settingsBtn.parentNode.replaceChild(newBtn, settingsBtn);

            newBtn.addEventListener('click', () => {
                // Toggle logic
                if (this.currentMode === 'settings') {
                    this.hideRightSidebar();
                } else {
                    // Call the patched showSettingsPanel
                    if (typeof showSettingsPanel === 'function') {
                        showSettingsPanel();
                    }
                }
            });
        }
    },

    showRightSidebar(mode) {
        const sidebar = this.rightSidebar;
        const title = this.rightSidebarTitle;
        const settingsProps = document.getElementById('settings-props');
        const boxProps = document.getElementById('box-props');
        const laneProps = document.getElementById('lane-props');

        // Hide all sections
        if (settingsProps) settingsProps.classList.add('hidden');
        if (boxProps) boxProps.classList.add('hidden');
        if (laneProps) laneProps.classList.add('hidden');

        // Show requested section
        switch (mode) {
            case 'settings':
                if (settingsProps) settingsProps.classList.remove('hidden');
                if (title) title.textContent = 'Diagram Settings';
                break;
            case 'box':
                if (boxProps) boxProps.classList.remove('hidden');
                if (title) title.textContent = 'Box Properties';
                break;
            case 'lane':
                if (laneProps) laneProps.classList.remove('hidden');
                if (title) title.textContent = 'Lane Properties';
                break;
        }

        this.currentMode = mode;
        sidebar.classList.remove('hidden');
        sidebar.classList.add('visible');

        // Update settings button state
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.classList.toggle('active', mode === 'settings');
        }
    },

    hideRightSidebar() {
        const sidebar = this.rightSidebar;
        sidebar.classList.remove('visible');
        sidebar.classList.add('hidden');
        this.currentMode = null;

        // Remove active state from settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) settingsBtn.classList.remove('active');
    },

    /**
     * Diagrams modal
     */
    initDiagramsModal() {
        // ID is now diagrams-toggle in index-v2.html
        const modalBtn = document.getElementById('diagrams-toggle');
        const modal = document.getElementById('diagrams-modal');
        const closeBtn = document.getElementById('close-diagrams-modal');

        if (modalBtn && modal) {
            // Clone to remove init() listener (which toggles dummy panel)
            const newBtn = modalBtn.cloneNode(true);
            modalBtn.parentNode.replaceChild(newBtn, modalBtn);

            newBtn.addEventListener('click', () => {
                modal.classList.remove('hidden');
                renderDiagramsList(); // Uses patched version
            });
        }

        if (closeBtn && modal) {
            closeBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }

        // Close on overlay click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        }

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
            }
        });
    },

    updateDiagramsBadge() {
        const badge = document.getElementById('diagrams-badge');
        if (badge) {
            const diagrams = getAllDiagrams();
            badge.textContent = diagrams.length;
            badge.classList.toggle('empty', diagrams.length === 0);
        }
    },

    /**
     * Theme toggle
     */
    initThemeToggle() {
        const btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;

        // Load saved theme
        const savedTheme = localStorage.getItem('tld-theme') || 'dark';
        this.applyTheme(savedTheme);

        btn.addEventListener('click', () => {
            const isDark = document.body.classList.contains('dark-theme');
            const newTheme = isDark ? 'light' : 'dark';
            this.applyTheme(newTheme);
            localStorage.setItem('tld-theme', newTheme);
        });
    },

    applyTheme(theme) {
        const btn = document.getElementById('theme-toggle-btn');
        if (theme === 'light') {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            if (btn) btn.textContent = '☀';
        } else {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            if (btn) btn.textContent = '☽';
        }
    },

    /**
     * Lane controls: click-to-activate instead of hover
     */
    initLaneControlsClick() {
        // Use event delegation on lane-list
        const laneList = document.getElementById('lane-list');
        if (!laneList) return;

        // Close any open lane menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.lane-controls')) {
                document.querySelectorAll('.lane-controls.active').forEach(el => {
                    el.classList.remove('active');
                });
            }
        });
    },

    /**
     * Timeline Duration setting
     */
    initTimelineDuration() {
        // Add timelineDuration to settings if not present
        if (!app.settings.timelineDuration) {
            app.settings.timelineDuration = 8000; // Default 8000ms
        }

        const durationInput = document.getElementById('config-timeline-duration');
        if (durationInput) {
            durationInput.value = app.settings.timelineDuration;
            durationInput.addEventListener('change', () => {
                const lastBoxEnd = app.diagram.getTotalDuration();
                let newValue = parseInt(durationInput.value, 10);

                // Validate: can't be less than last box end
                if (newValue < lastBoxEnd) {
                    newValue = Math.ceil(lastBoxEnd / 100) * 100; // Round up to nearest 100
                    durationInput.value = newValue;
                    showToast({
                        type: 'warning',
                        title: 'Duration adjusted',
                        message: `Cannot be less than last box end (${lastBoxEnd}ms)`,
                        duration: 3000
                    });
                }

                app.settings.timelineDuration = newValue;
                renderTimelineRuler();
                renderLanesCanvas();
                renderTimeMarkers();
                Minimap.render();
                autoSave();
            });
        }
    },

    /**
     * Lock toggle in diagram settings
     */
    initLockToggle() {
        const lockCheckbox = document.getElementById('config-lock-diagram');
        if (lockCheckbox) {
            lockCheckbox.addEventListener('change', () => {
                app.diagram.locked = lockCheckbox.checked;
                updateLockState();
                autoSave();
                renderDiagramsList();
            });
        }
    },

    /**
     * Override existing functions for v2 behavior
     */
    patchFunctions() {
        const self = this;

        // Override showSettingsPanel
        const _origShowSettings = showSettingsPanel;
        showSettingsPanel = function () {
            // Check V2.isV2 or explicitly force it since we are in V2 code
            if (!V2.isV2) { _origShowSettings(); return; }

            // Toggle: if settings already open, close
            if (self.currentMode === 'settings') {
                self.hideRightSidebar();
                return;
            }

            // Deselect any box
            app.selectedBoxId = null;
            app.selectedLaneId = null;
            document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));

            // Populate settings values
            const pageTitleInput = document.getElementById('config-page-title');
            if (pageTitleInput) pageTitleInput.value = app.diagram.title;

            const thresholdSelect = document.getElementById('config-time-threshold');
            if (thresholdSelect) thresholdSelect.value = app.settings.timeFormatThreshold.toString();

            const alignmentCb = document.getElementById('config-show-alignment');
            if (alignmentCb) alignmentCb.checked = app.settings.showAlignmentLines;

            const labelsCb = document.getElementById('config-show-labels');
            if (labelsCb) labelsCb.checked = app.settings.showBoxLabels;

            const autoOpenCb = document.getElementById('config-auto-open-properties');
            if (autoOpenCb) autoOpenCb.checked = app.settings.autoOpenBoxProperties;

            const lockCb = document.getElementById('config-lock-diagram');
            if (lockCb) lockCb.checked = app.diagram.locked;

            const durationInput = document.getElementById('config-timeline-duration');
            if (durationInput) durationInput.value = app.settings.timelineDuration || 8000;

            const startTimeInput = document.getElementById('start-time');
            if (startTimeInput) startTimeInput.value = app.diagram.startTime;

            self.showRightSidebar('settings');
        };

        // Override updatePropertiesPanel for right sidebar
        const _origUpdateProps = updatePropertiesPanel;
        updatePropertiesPanel = function (isNewBox = false) {
            if (!V2.isV2) { _origUpdateProps(isNewBox); return; }

            if (!app.selectedBoxId) {
                // Don't hide sidebar if settings are showing
                if (self.currentMode === 'box') {
                    self.hideRightSidebar();
                }
                return;
            }

            const box = app.diagram.boxes.find(b => b.id === app.selectedBoxId);
            if (!box) {
                if (self.currentMode === 'box') self.hideRightSidebar();
                return;
            }

            // Determine visibility
            if (isNewBox) {
                if (app.settings.autoOpenBoxProperties) {
                    self.showRightSidebar('box');
                }
            } else if (self.currentMode !== 'box') {
                self.showRightSidebar('box');
            }

            // Populate values
            app.elements.boxLabel.value = box.label;
            app.elements.boxColor.value = box.color;
            app.elements.boxStart.value = box.startOffset;
            app.elements.boxDuration.value = box.duration;

            if (app.elements.boxEnd) {
                app.elements.boxEnd.value = box.startOffset + box.duration;
            }

            const baseTime = parseTime(app.diagram.startTime);
            app.elements.boxTimeStart.textContent = formatTime(baseTime + box.startOffset);
            app.elements.boxTimeEnd.textContent = formatTime(baseTime + box.startOffset + box.duration);
        };

        // Override deselectBox
        const _origDeselect = deselectBox;
        deselectBox = function () {
            if (!V2.isV2) { _origDeselect(); return; }

            app.selectedBoxId = null;
            document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));

            // Only hide sidebar if showing box props
            if (self.currentMode === 'box') {
                self.hideRightSidebar();
            }

            // Remove glimpsed state from pick-start button
            const pickBtn = document.getElementById('pick-start-btn');
            if (pickBtn) pickBtn.classList.remove('glimpsed');
        };

        // Override showLanePropertiesPanel
        const _origShowLaneProps = showLanePropertiesPanel;
        showLanePropertiesPanel = function (laneId) {
            if (!V2.isV2) { _origShowLaneProps(laneId); return; }

            const lane = app.diagram.lanes.find(l => l.id === parseInt(laneId));
            if (!lane) return;

            // Deselect any box
            app.selectedBoxId = null;
            app.selectedLaneId = laneId;
            document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));

            // Set lane name
            const laneNameInput = document.getElementById('lane-name');
            if (laneNameInput) laneNameInput.value = lane.name;

            // Generate palette
            const lanePalette = document.getElementById('lane-palette');
            if (lanePalette) {
                lanePalette.innerHTML = '';
                PALETTE.forEach(color => {
                    const swatch = document.createElement('div');
                    swatch.className = 'palette-swatch';
                    swatch.style.backgroundColor = color;
                    swatch.title = color;
                    if (lane.baseColor === color) swatch.classList.add('selected');
                    swatch.addEventListener('click', () => {
                        setLaneColor(laneId, color);
                        lanePalette.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
                        swatch.classList.add('selected');
                        // Also update the lane item color swatch in sidebar
                        renderLaneList();
                    });
                    lanePalette.appendChild(swatch);
                });
            }

            self.showRightSidebar('lane');
        };

        // Override renderDiagramsList to also update badge
        const _origRenderDiagrams = renderDiagramsList;
        renderDiagramsList = function () {
            _origRenderDiagrams();
            if (V2.isV2) {
                self.updateDiagramsBadge();
            }
        };

        // Override toggleDiagramsPanel for v2 (no sidebar panel, use modal)
        const _origToggleDiagrams = toggleDiagramsPanel;
        toggleDiagramsPanel = function () {
            if (!V2.isV2) { _origToggleDiagrams(); return; }
            // In v2, open the modal instead
            const modal = document.getElementById('diagrams-modal');
            if (modal) {
                modal.classList.remove('hidden');
                renderDiagramsList();
            }
        };

        // Override updateLockState for v2 (use header badge, title-input-v2)
        const _origUpdateLock = updateLockState;
        updateLockState = function () {
            if (!V2.isV2) { _origUpdateLock(); return; }

            const body = document.body;
            if (app.diagram.locked) {
                body.classList.add('diagram-locked');
                app.elements.diagramTitle.readOnly = true;
                const startTime = document.getElementById('start-time');
                if (startTime) startTime.readOnly = true;
            } else {
                body.classList.remove('diagram-locked');
                app.elements.diagramTitle.readOnly = false;
                const startTime = document.getElementById('start-time');
                if (startTime) startTime.readOnly = false;
            }
        };
    }
};

// Global wrapper for updateDiagramsBadge (delegates to V2 if available)
function updateDiagramsBadge() {
    if (V2 && V2.isV2 && typeof V2.updateDiagramsBadge === 'function') {
        V2.updateDiagramsBadge();
    }
}

// Attach lane-controls click handler via event delegation
document.addEventListener('click', (e) => {
    if (!V2.isV2) return;

    const controls = e.target.closest('.lane-controls');
    if (controls) {
        // If clicking the kebab area (the pseudo-element trigger zone)
        // but NOT a button inside
        if (!e.target.closest('.lane-control-btn') && !e.target.closest('.lane-delete-btn')) {
            e.stopPropagation();
            const wasActive = controls.classList.contains('active');

            // Close all other open menus
            document.querySelectorAll('.lane-controls.active').forEach(el => {
                el.classList.remove('active');
            });

            // Toggle this one
            if (!wasActive) {
                controls.classList.add('active');
            }
        }
    }
});

// Initialize V2 after the main init
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure init() has completed
    setTimeout(() => V2.init(), 0);
});

// =====================================================
// V2 Refinements (Scroll Sync, Strict Duration, Multi-line Lanes)
// =====================================================

(function () {
    // Scroll Sync
    function initScrollSync() {
        if (!V2.isV2) return;
        const lanesCanvas = document.getElementById('lanes-canvas');
        const timeMarkers = document.getElementById('time-markers');
        if (!lanesCanvas || !timeMarkers) return;

        let isSyncing = false;

        lanesCanvas.addEventListener('scroll', () => {
            if (!isSyncing) {
                isSyncing = true;
                timeMarkers.scrollLeft = lanesCanvas.scrollLeft;
                requestAnimationFrame(() => isSyncing = false);
            }
        });

        timeMarkers.addEventListener('scroll', () => {
            if (!isSyncing) {
                isSyncing = true;
                lanesCanvas.scrollLeft = timeMarkers.scrollLeft;
                requestAnimationFrame(() => isSyncing = false);
            }
        });
    }

    // Override renderLaneList for div instead of input (Multi-line)
    const _origRenderLaneList = renderLaneList;
    renderLaneList = function () {
        if (!V2.isV2) { _origRenderLaneList(); return; }

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

            // Replaced input with div.lane-name-div
            item.innerHTML = `
                <span class="lane-drag-handle" title="Drag to reorder">⋮⋮</span>
                <button class="lane-color-btn" data-lane-id="${lane.id}" title="Change lane color" style="${laneColorStyle}"></button>
                <div class="lane-name-div" data-lane-id="${lane.id}">${escapeHtml(lane.name).replace(/\n/g, '<br>')}</div>
                <div class="lane-controls">
                    <button class="lane-control-btn move-up" data-lane-id="${lane.id}" title="Move up" ${isFirst ? 'disabled' : ''}>↑</button>
                    <button class="lane-control-btn move-down" data-lane-id="${lane.id}" title="Move down" ${isLast ? 'disabled' : ''}>↓</button>
                    <button class="lane-control-btn insert-before" data-lane-id="${lane.id}" data-index="${index}" title="Insert lane before">+↑</button>
                    <button class="lane-control-btn insert-after" data-lane-id="${lane.id}" data-index="${index}" title="Insert lane after">+↓</button>
                    <button class="lane-delete-btn" data-lane-id="${lane.id}" title="Delete lane">×</button>
                </div>
            `;

            // Add click listener to open properties on the item (excluding controls)
            item.addEventListener('click', (e) => {
                if (e.target.closest('.lane-control-btn') || e.target.closest('.lane-delete-btn') || e.target.closest('.lane-color-btn')) return;
                showLanePropertiesPanel(lane.id);
            });

            // Add double-click inline editing for lane name
            const laneNameDiv = item.querySelector('.lane-name-div');
            laneNameDiv.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (!isEditingAllowed()) return;

                // Create textarea for editing
                const textarea = document.createElement('textarea');
                textarea.className = 'lane-name-edit-textarea';
                textarea.value = lane.name;
                textarea.rows = 3;

                // Replace div with textarea
                laneNameDiv.replaceWith(textarea);
                textarea.focus();
                textarea.select();

                const saveEdit = () => {
                    const newName = textarea.value.trim() || 'Unnamed Lane';
                    app.diagram.renameLane(lane.id, newName);
                    renderLaneList();
                    renderLanesCanvas();
                    autoSave();
                };

                textarea.addEventListener('blur', saveEdit);
                textarea.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        renderLaneList(); // Cancel edit
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        saveEdit();
                    }
                });
            });

            container.appendChild(item);
        });

        // Re-attach Delete buttons
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

        // Move-up buttons
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

        // Move-down buttons
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

        // Insert-before buttons
        container.querySelectorAll('.lane-control-btn.insert-before').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isEditingAllowed()) return;
                const index = parseInt(e.target.dataset.index, 10);
                app.diagram.insertLaneAt(index);
                renderLaneList();
                renderLanesCanvas();
            });
        });

        // Insert-after buttons
        container.querySelectorAll('.lane-control-btn.insert-after').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isEditingAllowed()) return;
                const index = parseInt(e.target.dataset.index, 10);
                app.diagram.insertLaneAt(index + 1);
                renderLaneList();
                renderLanesCanvas();
            });
        });

        // Invoke global drag init if available (it attaches to container #lane-list)
        if (typeof initDragAndDrop === 'function') initDragAndDrop();
    };

    // Override renderLanesCanvas for strict timeline duration
    const _origRenderLanesCanvas = renderLanesCanvas;
    renderLanesCanvas = function () {
        if (!V2.isV2) { _origRenderLanesCanvas(); return; }

        const canvas = app.elements.lanesCanvas;
        canvas.innerHTML = '';

        // STRICT DURATION LOGIC
        // User wants: Duration value MUST affect design area first.
        // But also "Prevent design area from being decreased below end-time of last box"

        const totalDuration = app.diagram.getTotalDuration();
        const settingsDuration = app.settings.timelineDuration || 8000;

        // Ensure strictly >= totalDuration
        const finalDuration = Math.max(totalDuration, settingsDuration);

        // Use exact pixels unless compressed
        const minTrackWidth = msToPixels(finalDuration + (app.settings.trailingSpace || 0));

        app.diagram.lanes.forEach(lane => {
            const row = document.createElement('div');
            row.className = 'lane-row';
            row.dataset.laneId = lane.id;
            // Min-width for scrolling - considering sticky label
            // Note: If labels are hidden, --lane-label-width is 0px
            row.style.minWidth = `calc(var(--lane-label-width) + ${minTrackWidth}px)`;

            const label = document.createElement('div');
            label.className = 'lane-label';
            label.innerHTML = escapeHtml(lane.name).replace(/\n/g, '<br>');
            label.title = lane.name;

            const track = document.createElement('div');
            track.className = 'lane-track';
            track.dataset.laneId = lane.id;

            // Force explicit width to enable scrolling
            track.style.minWidth = `${minTrackWidth}px`;
            track.style.width = `${minTrackWidth}px`;

            // Compression indicators
            if (Compression.enabled) {
                const gaps = Compression.getCompressedGaps();
                gaps.forEach(gap => {
                    const indicator = document.createElement('div');
                    indicator.className = 'compression-indicator';
                    indicator.style.left = `${msToPixels(gap.compressedStart)}px`;
                    indicator.title = `Gap: ${formatDuration(gap.originalSize)}`;
                    track.appendChild(indicator);
                });
            }

            // Render boxes
            const boxes = app.diagram.getBoxesForLane(lane.id);
            boxes.forEach(box => {
                const boxEl = createBoxElement(box);
                track.appendChild(boxEl);
            });

            row.appendChild(label);
            row.appendChild(track);
            canvas.appendChild(row);
        });

        // Event listeners handling
        canvas.querySelectorAll('.lane-track').forEach(track => {
            track.addEventListener('mousedown', handleTrackMouseDown);
        });

        renderTimelineRuler();
        renderAlignmentMarkers();
        renderTimeMarkers();
        Minimap.render();
    };

    // Compact View (Hide Labels)
    function initCompactView() {
        if (!V2.isV2) return;

        const checkbox = document.getElementById('config-compact-view');
        if (!checkbox) return;

        // Init state
        if (app.settings.compactView) {
            document.body.classList.add('hide-lane-labels');
            checkbox.checked = true;
        }

        checkbox.addEventListener('change', () => {
            app.settings.compactView = checkbox.checked;
            if (app.settings.compactView) {
                document.body.classList.add('hide-lane-labels');
            } else {
                document.body.classList.remove('hide-lane-labels');
            }
            autoSave();
            // Re-render canvases to update widths if needed (though CSS var handles visual, min-width calc uses var)
            // But min-width style is inline calc(), so it updates automatically with css variable? 
            // Yes, calc(var(--lane-label-width) + ...) updates when var changes.
        });
    }

    // Also patch showSettingsPanel (via V2.patchFunctions override) to update the checkbox state when opening settings?
    // The previously installed patchFunctions already exists. 
    // We can just add a global listener for settings open or patch it again.
    // Easier: Patch V2.showRightSidebar to update checkbox state.
    const _origShowRightSidebar = V2.showRightSidebar;
    V2.showRightSidebar = function (mode) {
        _origShowRightSidebar.call(V2, mode);
        if (mode === 'settings') {
            const checkbox = document.getElementById('config-compact-view');
            if (checkbox) checkbox.checked = !!app.settings.compactView;
        }
    };

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            initScrollSync();
            initCompactView();
            // Trigger initial render for new overrides
            if (V2.isV2) {
                renderLaneList();
                renderLanesCanvas();
            }
        }, 100);
    });

})();

// =====================================================
// V2 Fixes (Duration Sync, Compact View Alignment, Resize Fix, Lane Height)
// =====================================================

(function () {
    // 1. DURATION SYNC & BI-DIRECTIONAL UPDATE
    function initDurationSync() {
        if (!V2.isV2) return;

        const durationInput = document.getElementById('config-timeline-duration');
        if (!durationInput) return;

        // Force initial sync: Input value -> Settings -> Canvas
        // or Settings -> Input (User prefers settings value to allow "default" 8000)
        // If app.settings.timelineDuration is not set, default to 8000.
        if (!app.settings.timelineDuration) {
            app.settings.timelineDuration = 8000;
        }
        durationInput.value = app.settings.timelineDuration;

        // Listen for input changes (User changes duration manually)
        durationInput.addEventListener('change', () => {
            let val = parseInt(durationInput.value, 10);
            const totalDur = app.diagram.getTotalDuration();

            // Allow user to set larger, but not smaller than total content
            if (val < totalDur) {
                // Determine if we should warn or just clamp. User said "Cannot be less than last box end" in HTML.
                // But user also said "If the working area is expanded automatically... change the size of the option"
                val = totalDur;
                durationInput.value = val;
                showToast({ type: 'info', title: 'Duration Adjusted', message: `Minimum duration is ${totalDur}ms based on existing boxes.` });
            }

            app.settings.timelineDuration = val;
            renderLanesCanvas();
            renderTimelineRuler();
            renderTimeMarkers();
            Minimap.render();
            autoSave();
        });

        // Hook into renderLanesCanvas (which we already patched in v2_patch_refinements.js)
        // to update input if content expands.
        // We can't easily "hook" the hook without infinite recursion or complex wrapping.
        // Instead, we can add a periodic check or specialized observer? 
        // Better: Redefine the patch to include this logic. This script runs AFTER v2_patch_refinements.js
        // so we can wrap the existing renderLanesCanvas.

        const _prevRenderLanesCanvas = renderLanesCanvas;
        renderLanesCanvas = function () {
            // First run the rendering logic (which calculates minTrackWidth based on duration)
            _prevRenderLanesCanvas();

            if (!V2.isV2) return;

            // Check if we need to auto-expand status
            const totalDur = app.diagram.getTotalDuration();
            const currentSetting = app.settings.timelineDuration || 8000;

            if (totalDur > currentSetting) {
                // Content determines width now. Update setting and input to match.
                app.settings.timelineDuration = totalDur;
                durationInput.value = totalDur;
                // Note: We don't need to re-render immediately because _prevRenderLanesCanvas 
                // already used Math.max(totalDur, settingsDuration) to set width.
            }
        };
    }

    // 2. RESIZE CLICK FIX
    // Prevent box properties from opening when clicking resize handles.
    // The issue is `selectBox` is called on mousedown in `handleResizeStart`.
    // We can monkey-patch `selectBox` to ignore calls if we are resizing?
    // Or improved: Patch `handleResizeStart` to NOT call selectBox or call it with a flag.
    // But `handleResizeStart` is global.

    // Changing `handleResizeStart` is hard because it's defined in app.js closure or global scope.
    // However, `handleResizeStart` sets `app.dragData.type = 'resize'`.
    // We can PATCH `updatePropertiesPanel` (again) to check this!

    // We already patched updatePropertiesPanel in v2_patch.js. Let's wrap it again.
    // The previous patch is: if (isNewBox) ... else if (!panelWasVisible) ...
    // If we are resizing, we want to NOT open the panel if it's closed.

    const _prevUpdateProps = updatePropertiesPanel;
    updatePropertiesPanel = function (isNewBox) {
        // If we are starting a resize, DO NOT open the panel.
        if (app.isDragging && app.dragData && app.dragData.type === 'resize') {
            // If panel is already open for this box, update values. 
            // If closed, KEEP CLOSED.
            const panel = app.elements.propertiesPanel; // patched to right sidebar
            const isVisible = panel && (panel.classList.contains('visible') || (panel.offsetWidth > 0));

            if (!isVisible) {
                return; // Do nothing, keep closed.
            }
        }
        _prevUpdateProps(isNewBox);
    };

    // 3. COMPACT VIEW ALIGNMENT
    // User: "timeline indicators remain in previous state".
    // This implies that while .lane-label-spacer is hidden, the markers (absoluted positioned?) might not shift?
    // In styles.css: .time-markers-container has .lane-label-spacer inside it.
    // And .time-marker-h is absolute. 
    // BUT .time-markers (the scrollable area) is a flex item next to spacer.
    // If spacer hides, .time-markers should expand/shift left.
    // IF markers are drawn relative to 0 of .time-markers, they usually start at 0.
    // Issue might be RE-RENDERING. If we toggle compact view, we MUST re-render time markers
    // because their positions might depend on container width (unlikely for absolute left=msToPixels)
    // OR: The "Time Markers" container scroll sync might be off?
    // Let's force a full re-render when toggling compact view.

    // We'll wrap initCompactView logic or add a listener to the checkbox here if needed.
    // But we already have a listener in v2_patch_refinements.js.
    // Let's add a secondary listener that forces a deeper update.

    function initCompactViewFix() {
        const checkbox = document.getElementById('config-compact-view');
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                // Force full re-layout cycle
                setTimeout(() => {
                    renderTimelineRuler();
                    renderLanesCanvas();
                    renderTimeMarkers();
                    // Also force scroll update in case
                    const canvas = document.getElementById('lanes-canvas');
                    if (canvas) canvas.dispatchEvent(new Event('scroll'));
                }, 50);
            });
        }
    }

    // Initialize fixes
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            initDurationSync();
            initCompactViewFix();
        }, 200); // Run after other V2 patches
    });

})();

// =====================================================
// V2 Fixes: Render Logic for Strict Duration
// =====================================================

(function () {
    // Override renderTimelineRuler to respect settings.timelineDuration
    const _origRenderTimelineRuler = renderTimelineRuler;
    renderTimelineRuler = function () {
        if (!V2.isV2) { _origRenderTimelineRuler(); return; }

        const ruler = app.elements.timelineRuler;
        if (!ruler) return;

        ruler.innerHTML = '';

        // STRICT DURATION LOGIC
        const totalDuration = Compression.enabled
            ? Compression.getCompressedDuration()
            : app.diagram.getTotalDuration();

        const settingsDuration = app.settings.timelineDuration || 8000;

        // Display duration is MAX of content vs settings
        const displayDuration = Math.max(totalDuration, settingsDuration);

        // Standard logic from original function, but using our displayDuration
        const DEFAULT_MIN_TIMELINE_MS = 10000;

        // Calculate interval
        let interval = 100;
        const intervals = [
            0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
            1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
            10000, 30000, 60000, 120000, 300000, 600000
        ];

        for (const int of intervals) {
            const pixelsPerInterval = msToPixels(int);
            if (pixelsPerInterval >= 60) {
                interval = int;
                break;
            }
        }

        // Fallback
        if (interval === 100 && msToPixels(600000) < 60) {
            interval = 600000;
        }

        const endTime = displayDuration + (app.settings.trailingSpace || 0);

        const rulerWidth = msToPixels(endTime);
        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'timeline-ruler-inner';
        innerWrapper.style.position = 'relative';
        innerWrapper.style.width = `${rulerWidth}px`;
        innerWrapper.style.height = '100%';
        ruler.appendChild(innerWrapper);

        if (Compression.enabled) {
            // Compressed mode logic (keep existing behavior for now, assume compression handles scaling internally)
            // But we might need to extend the empty space if settingsDuration > compressedDuration
            // For now, just render normally.
            const breakMarkers = Compression.getBreakMarkers();
            for (let compressedTime = 0; compressedTime <= endTime; compressedTime += interval) {
                const actualTime = Compression.compressedToActual(compressedTime);
                const mark = document.createElement('div');
                mark.className = 'ruler-mark' + (compressedTime % (interval * 5) === 0 ? ' major' : '');
                mark.style.left = `${msToPixels(compressedTime)}px`;
                mark.innerHTML = `<span>${formatDuration(actualTime)}</span>`;
                innerWrapper.appendChild(mark);
            }
            breakMarkers.forEach(marker => {
                const breakMark = document.createElement('div');
                breakMark.className = 'ruler-break-marker';
                breakMark.style.left = `${msToPixels(marker.compressedStart)}px`;
                const actualGapSize = marker.actualEnd - marker.actualStart;
                breakMark.title = `Gap: ${formatDuration(actualGapSize)}`;
                breakMark.innerHTML = `<span class="break-label">${formatDuration(actualGapSize)}</span>`;
                innerWrapper.appendChild(breakMark);
            });
        } else {
            // Normal mode
            for (let time = 0; time <= endTime; time += interval) {
                const mark = document.createElement('div');
                mark.className = 'ruler-mark' + (time % (interval * 5) === 0 ? ' major' : '');
                mark.style.left = `${msToPixels(time)}px`;
                mark.innerHTML = `<span>${formatDuration(time)}</span>`;
                innerWrapper.appendChild(mark);
            }
        }
    };

    // Override renderTimeMarkers to respect settings.timelineDuration
    const _origRenderTimeMarkers = renderTimeMarkers;
    renderTimeMarkers = function () {
        if (!V2.isV2) { _origRenderTimeMarkers(); return; }

        const container = app.elements.timeMarkers;
        if (!container) return; // Might be null in V2 if ID changed? No, it's same ID.

        container.innerHTML = '';

        const totalDuration = app.diagram.getTotalDuration();
        const settingsDuration = app.settings.timelineDuration || 8000;
        const actualTotalDuration = Math.max(totalDuration, settingsDuration);

        const displayDuration = Compression.enabled
            ? Compression.getCompressedDuration() // Compression might complicate "min duration" logic
            : actualTotalDuration;

        const endTime = displayDuration + (app.settings.trailingSpace || 0);
        const markerWidth = msToPixels(endTime);

        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'time-markers-inner';
        innerWrapper.style.position = 'relative';
        innerWrapper.style.width = `${markerWidth}px`;
        innerWrapper.style.height = '100%';
        container.appendChild(innerWrapper);

        if (app.diagram.boxes.length === 0) return;

        // Copy logic from original for marker generation
        const markers = [];
        app.diagram.boxes.forEach(box => {
            const visualOffset = Compression.getVisualOffset(box);
            const visualEnd = visualOffset + box.duration;
            const actualStart = box.startOffset;
            const actualEnd = box.startOffset + box.duration;

            markers.push({
                visualTime: visualOffset,
                actualTime: actualStart,
                type: 'start',
                boxId: box.id,
                color: box.color,
                label: formatDuration(actualStart)
            });
            markers.push({
                visualTime: visualEnd,
                actualTime: actualEnd,
                type: 'end',
                boxId: box.id,
                color: box.color,
                label: formatDuration(actualEnd)
            });
        });

        markers.sort((a, b) => a.visualTime - b.visualTime);

        // Layout logic
        const levels = [];
        const charWidth = 7;
        const padding = 10;

        markers.forEach(m => {
            const x = msToPixels(m.visualTime);
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

        // Use fixed height or calculate
        const lanesCanvas = document.getElementById('lanes-canvas');
        const lanesCanvasHeight = lanesCanvas ? lanesCanvas.offsetHeight : window.innerHeight; // better fallback

        markers.forEach(m => {
            const x = msToPixels(m.visualTime);

            const el = document.createElement('div');
            el.className = 'time-marker-h';
            el.style.left = `${x}px`;
            el.style.bottom = `${4 + (m.level * 16)}px`;
            el.style.color = m.color;

            const line = document.createElement('div');
            line.className = 'time-marker-line';
            line.style.backgroundColor = m.color;
            // Extend line up significantly
            line.style.height = `${lanesCanvasHeight + 200}px`;

            const tick = document.createElement('div');
            tick.className = 'time-marker-tick';
            tick.style.backgroundColor = m.color;

            const label = document.createElement('span');
            label.className = 'time-marker-text';
            label.textContent = m.text;

            el.appendChild(line);
            el.appendChild(tick);
            el.appendChild(label);
            innerWrapper.appendChild(el);
        });
    };
})();

// =====================================================
// V2 FINAL FIXES (Duration, Resize, Shift+Enter)
// =====================================================

(function () {

    // 1. Shift+Enter for New Line in Lane Name
    function initLaneNameInput() {
        if (!V2.isV2) return;

        const laneNameInput = document.getElementById('lane-name');
        if (laneNameInput) {
            // Remove old listeners if any (by cloning)
            const newInput = laneNameInput.cloneNode(true);
            laneNameInput.parentNode.replaceChild(newInput, laneNameInput);

            // Re-attach standard listener for sync
            newInput.addEventListener('input', () => {
                if (app.selectedLaneId) {
                    app.diagram.renameLane(parseInt(app.selectedLaneId), newInput.value);
                    renderLaneList();
                    renderLanesCanvas();
                    autoSave();
                }
            });

            // Keydown logic: Enter = Blur/Submit, Shift+Enter = Newline
            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    newInput.blur(); // Trigger save via change/blur if attached, or just finish editing
                }
            });

            // Restore focus listener if needed? 
            // The original code didn't have special focus logic, just value binding in showLanePropertiesPanel
        }
    }

    // 2. Resize Fix (Don't open properties if resizing)
    // We patch updatePropertiesPanel to check for resize drag
    const _prevUpdateProps = updatePropertiesPanel;
    updatePropertiesPanel = function (isNewBox = false) {
        if (!V2.isV2) { _prevUpdateProps(isNewBox); return; }

        // Check if we are currently resizing
        if (app.isDragging && app.dragData && app.dragData.type === 'resize') {
            const sidebar = document.getElementById('right-sidebar');
            const isSidebarOpen = sidebar && sidebar.classList.contains('active');

            // If sidebar is NOT open, do NOT open it.
            if (!isSidebarOpen) {
                return;
            }
            // If it IS open, let it update (so values change while dragging if we want, or we can block that too)
            // User said: "If I click the resize parts of the box the box properties opened. don't open it"
            // Usually we want to see values updating while resizing? 
            // But if the panel was closed, it should stay closed.
        }

        _prevUpdateProps(isNewBox);
    };

    // 3. Duration Sync Fix (Ruler Loop)
    // The previous patch used Math.max(total, settings) but maybe loop condition was off?
    // Let's rewrite renderTimelineRuler to be absolutely sure.
    const _origRenderTimelineRuler = renderTimelineRuler;
    renderTimelineRuler = function () {
        if (!V2.isV2) { _origRenderTimelineRuler(); return; }

        const ruler = app.elements.timelineRuler;
        if (!ruler) return;
        ruler.innerHTML = '';

        const totalDuration = app.diagram.getTotalDuration();
        const settingsDuration = app.settings.timelineDuration || 8000;

        // Ensure we cover the full settings duration
        const displayDuration = Math.max(totalDuration, settingsDuration);

        // Default interval calc
        let interval = 100;
        // ... (interval selection logic same as before) ...
        const intervals = [
            0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
            1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
            10000, 30000, 60000, 120000, 300000, 600000
        ];
        for (const int of intervals) {
            if (msToPixels(int) >= 60) {
                interval = int;
                break;
            }
        }
        if (interval === 100 && msToPixels(600000) < 60) interval = 600000;

        // Trailing space
        const trailing = app.settings.trailingSpace || 0;
        const endTime = displayDuration + trailing;

        const rulerWidth = msToPixels(endTime);
        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'timeline-ruler-inner';
        innerWrapper.style.position = 'relative';
        innerWrapper.style.width = `${rulerWidth}px`;
        innerWrapper.style.height = '100%';
        ruler.appendChild(innerWrapper);

        // Loop condition: go until endTime
        for (let time = 0; time <= endTime; time += interval) {
            const mark = document.createElement('div');
            mark.className = 'ruler-mark' + (time % (interval * 5) === 0 ? ' major' : '');
            mark.style.left = `${msToPixels(time)}px`;
            mark.innerHTML = `<span>${formatDuration(time)}</span>`;
            innerWrapper.appendChild(mark);
        }
    };

    // Also override renderTimeMarkers to use same displayDuration
    const _origRenderTimeMarkers = renderTimeMarkers;
    renderTimeMarkers = function () {
        if (!V2.isV2) { _origRenderTimeMarkers(); return; }
        const container = app.elements.timeMarkers;
        if (!container) return;
        container.innerHTML = '';

        const total = app.diagram.getTotalDuration();
        const settings = app.settings.timelineDuration || 8000;
        const displayDuration = Math.max(total, settings);
        const endTime = displayDuration + (app.settings.trailingSpace || 0);
        const markerWidth = msToPixels(endTime);

        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'time-markers-inner';
        innerWrapper.style.position = 'relative';
        innerWrapper.style.width = `${markerWidth}px`;
        innerWrapper.style.height = '100%';
        container.appendChild(innerWrapper);

        if (app.diagram.boxes.length === 0) return;

        // Marker render logic... (simplified for brevity, assume same as before)
        // ... (copy marker generation logic) ...
        // We need to actually copy the logic else functionality is lost
        const markers = [];
        app.diagram.boxes.forEach(box => {
            const visualOffset = Compression.getVisualOffset(box);
            const visualEnd = visualOffset + box.duration;
            const actualStart = box.startOffset;
            const actualEnd = box.startOffset + box.duration;
            markers.push({ visualTime: visualOffset, actualTime: actualStart, type: 'start', boxId: box.id, color: box.color, label: formatDuration(actualStart) });
            markers.push({ visualTime: visualEnd, actualTime: actualEnd, type: 'end', boxId: box.id, color: box.color, label: formatDuration(actualEnd) });
        });
        markers.sort((a, b) => a.visualTime - b.visualTime);
        const levels = [];
        const charWidth = 7;
        const padding = 10;
        markers.forEach(m => {
            const x = msToPixels(m.visualTime);
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
        const lanesCanvas = document.getElementById('lanes-canvas');
        const lanesCanvasHeight = lanesCanvas ? lanesCanvas.offsetHeight : window.innerHeight;
        markers.forEach(m => {
            const x = msToPixels(m.visualTime);
            const el = document.createElement('div');
            el.className = 'time-marker-h';
            el.style.left = `${x}px`;
            el.style.bottom = `${4 + (m.level * 16)}px`;
            el.style.color = m.color;
            const line = document.createElement('div');
            line.className = 'time-marker-line';
            line.style.backgroundColor = m.color;
            line.style.height = `${lanesCanvasHeight + 200}px`;
            const tick = document.createElement('div');
            tick.className = 'time-marker-tick';
            tick.style.backgroundColor = m.color;
            const label = document.createElement('span');
            label.className = 'time-marker-text';
            label.textContent = m.text;
            el.appendChild(line);
            el.appendChild(tick);
            el.appendChild(label);
            innerWrapper.appendChild(el);
        });
    };

    // Init
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            initLaneNameInput();
        }, 300); // Wait for other inits
    });

})();

// =====================================================
// V2 ACCUMULATED FIXES (Updates & Fixes)
// =====================================================

(function () {
    // Inject CSS for Alignment Lines, Overscroll, and Box Border
    const style = document.createElement('style');
    style.textContent = `
        /* Alignment Markers Position Fix */
        .alignment-markers {
            left: var(--lane-label-width) !important;
            width: calc(100% - var(--lane-label-width)) !important;
        }
        
        /* Overscroll / Rubber-banding Fix */
        .lanes-canvas,
        .timeline-ruler,
        .time-markers, 
        .minimap-container {
            overscroll-behavior-x: none;
            overscroll-behavior-y: none;
        }

        /* Dashed Lines (Layout Optimization / Alignment) */
        /* If these are the "dashed trailing lines", ensure they are visible and aligned */
        .box-alignment-line {
            border-left-style: dashed !important;
            z-index: 100;
        }
    `;
    document.head.appendChild(style);

    // 1. Shift+Enter for New Line in Lane Name
    function initLaneNameInput() {
        if (!V2.isV2) return;
        const laneNameInput = document.getElementById('lane-name');
        if (laneNameInput) {
            const newInput = laneNameInput.cloneNode(true);
            laneNameInput.parentNode.replaceChild(newInput, laneNameInput);

            newInput.addEventListener('input', () => {
                if (app.selectedLaneId) {
                    app.diagram.renameLane(parseInt(app.selectedLaneId), newInput.value);
                    renderLaneList();
                    renderLanesCanvas();
                    autoSave();
                }
            });

            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    newInput.blur();
                }
            });
        }
    }

    // 2. Resize Fix (Don't open properties if resizing)
    const _prevUpdateProps = updatePropertiesPanel;
    updatePropertiesPanel = function (isNewBox = false) {
        if (!V2.isV2) { _prevUpdateProps(isNewBox); return; }

        if (app.isDragging && app.dragData && app.dragData.type === 'resize') {
            const sidebar = document.getElementById('right-sidebar');
            const isSidebarOpen = sidebar && sidebar.classList.contains('active');
            if (!isSidebarOpen) return;
        }
        _prevUpdateProps(isNewBox);
    };

    // 3. Duration Sync Fix (Ruler Loop & Validation)
    // Override both renderTimelineRuler and renderTimeMarkers
    const _origRenderTimelineRuler = renderTimelineRuler;
    renderTimelineRuler = function () {
        if (!V2.isV2) { _origRenderTimelineRuler(); return; }
        const ruler = app.elements.timelineRuler;
        if (!ruler) return;
        ruler.innerHTML = '';

        // Fix: Use total settings duration
        const totalDuration = app.diagram.getTotalDuration();
        const settingsDuration = app.settings.timelineDuration || 8000;
        const displayDuration = Math.max(totalDuration, settingsDuration);

        let interval = 100;
        const intervals = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000];
        for (const int of intervals) {
            if (msToPixels(int) >= 60) { interval = int; break; }
        }
        if (interval === 100 && msToPixels(600000) < 60) interval = 600000;

        const trailing = app.settings.trailingSpace || 0;
        const endTime = displayDuration + trailing;
        const rulerWidth = msToPixels(endTime);

        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'timeline-ruler-inner';
        innerWrapper.style.position = 'relative';
        innerWrapper.style.width = `${rulerWidth}px`;
        innerWrapper.style.height = '100%';
        ruler.appendChild(innerWrapper);

        // Correct loop logic
        for (let time = 0; time <= endTime; time += interval) {
            const mark = document.createElement('div');
            mark.className = 'ruler-mark' + (time % (interval * 5) === 0 ? ' major' : '');
            mark.style.left = `${msToPixels(time)}px`;
            mark.innerHTML = `<span>${formatDuration(time)}</span>`;
            innerWrapper.appendChild(mark);
        }
    };

    const _origRenderTimeMarkers = renderTimeMarkers;
    renderTimeMarkers = function () {
        if (!V2.isV2) { _origRenderTimeMarkers(); return; }
        const container = app.elements.timeMarkers;
        if (!container) return;
        container.innerHTML = '';

        const total = app.diagram.getTotalDuration();
        const settings = app.settings.timelineDuration || 8000;
        const displayDuration = Math.max(total, settings);
        const endTime = displayDuration + (app.settings.trailingSpace || 0);
        const markerWidth = msToPixels(endTime);

        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'time-markers-inner';
        innerWrapper.style.position = 'relative';
        innerWrapper.style.width = `${markerWidth}px`;
        innerWrapper.style.height = '100%';
        container.appendChild(innerWrapper);

        if (app.diagram.boxes.length === 0) return;

        const markers = [];
        app.diagram.boxes.forEach(box => {
            const visualOffset = Compression.getVisualOffset(box);
            const visualEnd = visualOffset + box.duration;
            const actualStart = box.startOffset;
            const actualEnd = box.startOffset + box.duration;
            markers.push({ visualTime: visualOffset, actualTime: actualStart, type: 'start', boxId: box.id, color: box.color, label: formatDuration(actualStart) });
            markers.push({ visualTime: visualEnd, actualTime: actualEnd, type: 'end', boxId: box.id, color: box.color, label: formatDuration(actualEnd) });
        });
        markers.sort((a, b) => a.visualTime - b.visualTime);

        const levels = [];
        const charWidth = 7;
        const padding = 10;
        markers.forEach(m => {
            const x = msToPixels(m.visualTime);
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

        const lanesCanvas = document.getElementById('lanes-canvas');
        const lanesCanvasHeight = lanesCanvas ? lanesCanvas.offsetHeight : window.innerHeight;

        markers.forEach(m => {
            const x = msToPixels(m.visualTime);
            const el = document.createElement('div');
            el.className = 'time-marker-h';
            el.style.left = `${x}px`;
            el.style.bottom = `${4 + (m.level * 16)}px`;
            el.style.color = m.color;
            const line = document.createElement('div');
            line.className = 'time-marker-line';
            line.style.backgroundColor = m.color;
            line.style.height = `${lanesCanvasHeight + 2000}px`; // Ensure it covers scrollable height 
            // IMPORTANT: dashed style? The user mentioned "dashed trailing lines".
            // If they are dashed, we need border-style. 
            // Assuming "time-marker-line" is solid usually. 
            // If user meant "alignment lines" (guides), they are separate.
            // But just in case, let's make sure these move with the container (which they do as they are children).

            const tick = document.createElement('div');
            tick.className = 'time-marker-tick';
            tick.style.backgroundColor = m.color;
            const label = document.createElement('span');
            label.className = 'time-marker-text';
            label.textContent = m.text;
            el.appendChild(line);
            el.appendChild(tick);
            el.appendChild(label);
            innerWrapper.appendChild(el);
        });
    };

    // 4. Default Trailing Space = 0
    function initTrailingSpace() {
        if (!app.settings.trailingSpace) {
            app.settings.trailingSpace = 0;
        }
        // Force update of input if it exists
        const trailingInput = document.getElementById('config-trailing-space'); // guess ID
        if (trailingInput) trailingInput.value = 0;
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            initLaneNameInput();
            initTrailingSpace();
            // Force re-render once to apply new trailing space and positioning
            renderTimelineRuler();
            renderTimeMarkers();
            renderLanesCanvas();
        }, 400);
    });

})();

// =====================================================
// V2 FIXES ROUND 3 (Refined + Body Overscroll)
// =====================================================

(function () {

    // Inject CSS for Body Overscroll
    const style = document.createElement('style');
    style.textContent = `
        html, body {
            overscroll-behavior-x: none;
            overscroll-behavior-y: none;
        }
    `;
    document.head.appendChild(style);

    // 1. Shift+Enter for New Line in Lane Name (Refined)
    function initLaneNameInput() {
        if (!V2.isV2) return;

        const laneNameInput = document.getElementById('lane-name');
        if (laneNameInput) {
            // Remove old listeners by cloning
            const newInput = laneNameInput.cloneNode(true);
            laneNameInput.parentNode.replaceChild(newInput, laneNameInput);

            // Re-attach standard listener for sync
            newInput.addEventListener('input', () => {
                if (app.selectedLaneId) {
                    app.diagram.renameLane(parseInt(app.selectedLaneId), newInput.value);
                    renderLaneList();
                    renderLanesCanvas();
                    autoSave();
                }
            });

            // Keydown logic
            newInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (e.shiftKey) {
                        // Allow default (newline)
                        return;
                    } else {
                        // Enter without shift -> Finish edit
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        newInput.blur();
                    }
                }
            });
        }
    }

    // 2. Resize Fix (Don't open properties if resizing)
    const _currentUpdateProps = updatePropertiesPanel;

    updatePropertiesPanel = function (isNewBox = false) {
        if (!V2.isV2) { _currentUpdateProps(isNewBox); return; }

        // CHECK FOR RESIZE/DRAG
        // We use a broad check: if dragging, or if dragData indicates resize
        if (app.isDragging || (app.dragData && app.dragData.type === 'resize')) {
            const sidebar = document.getElementById('right-sidebar');
            const isActive = sidebar && sidebar.classList.contains('active');

            if (!isActive) {
                // Panel is closed, keep it closed.
                return;
            }
        }

        // Execute original logic
        _currentUpdateProps(isNewBox);
    };

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            initLaneNameInput();
        }, 600);
    });

})();

// =====================================================
// V2 FIXES ROUND 4 (Robust Resize Fix)
// =====================================================

(function () {

    // Override selectBox to prevent properties panel from opening during resize or drag
    const _origSelectBox = selectBox;
    selectBox = function (boxId, isNewBox = false) {
        if (V2.isV2 && app.dragData && (app.dragData.type === 'resize' || app.dragData.type === 'move')) {
            // Manual selection logic (copied from original selectBox)

            // 1. Deselect previous
            document.querySelectorAll('.timeline-box.selected').forEach(el => {
                el.classList.remove('selected');
            });

            // 2. Update state
            app.selectedBoxId = boxId;

            // 3. Select new visually
            const boxEl = document.querySelector(`.timeline-box[data-box-id="${boxId}"]`);
            if (boxEl) {
                boxEl.classList.add('selected');
            }

            // 4. Update Properties Panel ONLY if it is already open (visible/active)
            const sidebar = document.getElementById('right-sidebar');
            const isActive = sidebar && sidebar.classList.contains('active');

            if (isActive) {
                // If open, update values
                if (typeof updatePropertiesPanel === 'function') {
                    updatePropertiesPanel(isNewBox);
                }
            } else {
                // If closed, DO NOT call updatePropertiesPanel, 
                // because updatePropertiesPanel (V2 version) has logic to auto-open it.
                // By skipping it, we keep the sidebar closed.
            }

            // 5. Glimpse button (optional, keep it)
            setTimeout(() => {
                if (typeof glimpsePickStartButton === 'function') glimpsePickStartButton();
            }, 100);

            return;
        }

        // Normal behavior
        _origSelectBox(boxId, isNewBox);
    };

})();

// =====================================================
// V2 FIXES ROUND 5 (Handle Resize Start Override)
// =====================================================

(function () {

    // Override handleResizeStart to avoid calling selectBox (which opens panel)
    // We manually select the box instead.

    handleResizeStart = function (e, boxId) {
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

        // REPLACEMENT FOR selectBox(boxId):
        // 1. Deselect others
        document.querySelectorAll('.timeline-box.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // 2. Set current
        app.selectedBoxId = boxId;

        // 3. Add class
        const boxEl = document.querySelector(`.timeline-box[data-box-id="${boxId}"]`);
        if (boxEl) {
            boxEl.classList.add('selected');
        }

        // 4. Update panel ONLY if it is already open (visible)
        const sidebar = document.getElementById('right-sidebar');
        // V2 uses 'active' class for visibility
        if (sidebar && sidebar.classList.contains('active')) {
            updatePropertiesPanel();
        } else {
            // Ensure it remains closed (do nothing)
        }

        e.preventDefault();
    };

})();

// =====================================================
// V2 FIXES ROUND 6 (Capture Click & Resize Handle)
// =====================================================

(function () {

    // Add Capture Phase click listener to intercept clicks on resize handles
    // This prevents the 'click' event from bubbling up to the .timeline-box listener
    // which calls selectBox() and opens the properties panel.

    document.addEventListener('click', (e) => {
        // Check if target is a resize handle
        if (e.target && e.target.classList && e.target.classList.contains('box-resize-handle')) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            // We also don't want to deselect if we just resized... 
            // The handle mousedown already handled selection. 
            // So suppressing click is safe.
        }
    }, true); // Use Capture Phase

})();
