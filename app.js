/* =====================================================
   Timeline Diagram Editor - Main Application Logic
   ===================================================== */

const APP_VERSION = '2.1.1';
const DESIGNER_HINT_TOAST_KEY = 'designer-hint-mode-help';
const REGULAR_TOOLTIP_DELAY_MS = 550;
// Default minimum timeline scale for new diagrams (in milliseconds)
const DEFAULT_MIN_TIMELINE_MS = 10000;
const DEFAULT_LANE_HEIGHT = 46;
const DEFAULT_PIXELS_PER_MS = 0.15;
const MIN_BOX_DURATION_MS = 1;
const TIME_UNIT_FACTORS_MS = Object.freeze({
    ms: 1,
    s: 1000,
    min: 60000,
    h: 3600000,
    d: 86400000,
    w: 604800000,
    mo: 2592000000,   // 30 days
    y: 31536000000    // 365 days
});
const TIME_UNIT_LABELS = Object.freeze({
    ms: 'ms',
    s: 's',
    min: 'min',
    h: 'h',
    d: 'd',
    w: 'w',
    mo: 'mo',
    y: 'y'
});
const TIME_UNIT_ALIASES = Object.freeze({
    sec: 's',
    second: 's',
    seconds: 's',
    secs: 's',
    m: 'min',
    minute: 'min',
    minutes: 'min',
    mins: 'min',
    hr: 'h',
    hour: 'h',
    hours: 'h',
    day: 'd',
    days: 'd',
    week: 'w',
    weeks: 'w',
    wk: 'w',
    wks: 'w',
    month: 'mo',
    months: 'mo',
    mon: 'mo',
    mons: 'mo',
    year: 'y',
    years: 'y',
    yr: 'y',
    yrs: 'y'
});
const BASE_UNIT_SUBUNITS = Object.freeze({
    ms: null,
    s: 'ms',
    min: 's',
    h: 'min',
    d: 'h',
    w: 'd',
    mo: 'd',
    y: 'mo'
});
const THRESHOLD_BASE_UNIT_ORDER = Object.freeze(['ms', 's', 'min', 'h', 'd', 'w', 'mo', 'y']);
const DEFAULT_TIMELINE_SETTINGS = {
    timeFormatThreshold: 1000,
    showAlignmentLines: true,
    showBoxLabels: false,
    autoOpenBoxProperties: false,
    trailingSpace: 0,
    compressionThreshold: 500,
    compactView: true,
    timelineDuration: 8000,
    baseTimeUnit: 'ms'
};

function getDefaultTimelineSettings() {
    return { ...DEFAULT_TIMELINE_SETTINGS };
}

function normalizeTimelineSettings(settings = {}) {
    const merged = { ...getDefaultTimelineSettings(), ...(settings || {}) };
    const baseTimeUnit = normalizeBaseTimeUnit(merged.baseTimeUnit);
    const parsedThreshold = parseInt(merged.timeFormatThreshold, 10);
    const defaultThreshold = getDefaultTimeThreshold(baseTimeUnit);
    return {
        timeFormatThreshold: Number.isFinite(parsedThreshold)
            ? Math.max(0, parsedThreshold)
            : defaultThreshold,
        showAlignmentLines: !!merged.showAlignmentLines,
        showBoxLabels: !!merged.showBoxLabels,
        autoOpenBoxProperties: !!merged.autoOpenBoxProperties,
        trailingSpace: Math.max(0, parseInt(merged.trailingSpace, 10) || 0),
        compressionThreshold: Math.max(10, parseInt(merged.compressionThreshold, 10) || 500),
        compactView: !!merged.compactView,
        timelineDuration: Math.max(1000, parseInt(merged.timelineDuration, 10) || 8000),
        baseTimeUnit
    };
}

function normalizeBaseTimeUnit(unit) {
    const raw = String(unit || '').trim().toLowerCase();
    if (TIME_UNIT_FACTORS_MS[raw]) return raw;
    if (TIME_UNIT_ALIASES[raw]) return TIME_UNIT_ALIASES[raw];
    return 'ms';
}

function getBaseTimeUnit() {
    const configured = (typeof app !== 'undefined' && app?.settings?.baseTimeUnit)
        ? app.settings.baseTimeUnit
        : DEFAULT_TIMELINE_SETTINGS.baseTimeUnit;
    return normalizeBaseTimeUnit(configured);
}

function getUnitFactorMs(unit = getBaseTimeUnit()) {
    return TIME_UNIT_FACTORS_MS[normalizeBaseTimeUnit(unit)] || 1;
}

function getBaseUnitLabel(unit = getBaseTimeUnit()) {
    return TIME_UNIT_LABELS[normalizeBaseTimeUnit(unit)] || 'ms';
}

function getBaseUnitSubunit(unit = getBaseTimeUnit()) {
    return BASE_UNIT_SUBUNITS[normalizeBaseTimeUnit(unit)] || null;
}

function getThresholdDisplaySubUnit(unit = getBaseTimeUnit()) {
    const normalized = normalizeBaseTimeUnit(unit);
    if (normalized === 'ms') return 'ms';
    return getBaseUnitSubunit(normalized) || normalized;
}

function getThresholdInputUnit(unit = getBaseTimeUnit()) {
    const normalized = normalizeBaseTimeUnit(unit);
    if (normalized === 'ms') return 's';
    return normalized;
}

function getRenderGranularityMs(unit = getBaseTimeUnit()) {
    const normalized = normalizeBaseTimeUnit(unit);
    if (normalized === 'ms') return 1;
    const subUnit = getBaseUnitSubunit(normalized);
    return subUnit ? getUnitFactorMs(subUnit) : getUnitFactorMs(normalized);
}

function getDefaultTimeThreshold(unit = getBaseTimeUnit()) {
    const normalized = normalizeBaseTimeUnit(unit);
    if (normalized === 'ms') return 1000;
    return Math.max(1, Math.round(getUnitFactorMs(normalized)));
}

function getDefaultZoomScaleForBaseUnit(unit = getBaseTimeUnit()) {
    const normalized = normalizeBaseTimeUnit(unit);
    if (normalized === 'ms') return DEFAULT_PIXELS_PER_MS;

    const baseMs = getUnitFactorMs(normalized);
    const granularityMs = getRenderGranularityMs(normalized);
    const unitsPerBase = Math.max(1, baseMs / granularityMs);
    const targetPixelsPerBaseUnit = 120;
    const rawScale = targetPixelsPerBaseUnit / unitsPerBase;
    return clampPixelsPerMs(rawScale);
}

function msToUnitValue(ms, unit = getBaseTimeUnit()) {
    return ms / getUnitFactorMs(unit);
}

function unitValueToMs(value, unit = getBaseTimeUnit()) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return NaN;
    return numericValue * getUnitFactorMs(unit);
}

function formatUnitValue(value, maxDecimals = 3) {
    if (!Number.isFinite(value)) return '0';
    const fixed = value.toFixed(maxDecimals);
    const trimmed = fixed
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.0+$/, '');
    return trimmed === '-0' ? '0' : trimmed;
}

function formatMsForInput(ms, unit = getBaseTimeUnit(), maxDecimals = 2) {
    return formatUnitValue(msToUnitValue(ms, unit), maxDecimals);
}

function parseInputToMs(value, {
    unit = getBaseTimeUnit(),
    fallbackMs = 0,
    minMs = 0,
    maxMs = Number.POSITIVE_INFINITY
} = {}) {
    const msValue = unitValueToMs(value, unit);
    if (!Number.isFinite(msValue)) {
        return Math.max(minMs, Math.min(maxMs, fallbackMs));
    }
    return Math.max(minMs, Math.min(maxMs, Math.round(msValue)));
}

function getBoxStepMs(unit = getBaseTimeUnit()) {
    return Math.max(1, Math.round(getUnitFactorMs(unit)));
}

function getSnapStepMs({
    unit = getBaseTimeUnit(),
    subUnitPrecision = false
} = {}) {
    const normalizedUnit = normalizeBaseTimeUnit(unit);
    if (subUnitPrecision) {
        const subUnit = getBaseUnitSubunit(normalizedUnit);
        if (subUnit) {
            return Math.max(1, Math.round(getUnitFactorMs(subUnit)));
        }
    }
    return getBoxStepMs(normalizedUnit);
}

function isSubUnitPrecisionActive(event) {
    if (!event || !event.altKey) return false;
    return !!getBaseUnitSubunit(getBaseTimeUnit());
}

function snapMsToUnitStep(ms, {
    unit = getBaseTimeUnit(),
    mode = 'round',
    subUnitPrecision = false
} = {}) {
    const stepMs = getSnapStepMs({ unit, subUnitPrecision });
    const numericMs = Number(ms);
    if (!Number.isFinite(numericMs)) return 0;
    if (stepMs <= 1) return Math.round(numericMs);

    const ratio = numericMs / stepMs;
    let snappedRatio = Math.round(ratio);
    if (mode === 'floor') snappedRatio = Math.floor(ratio);
    if (mode === 'ceil') snappedRatio = Math.ceil(ratio);
    return Math.round(snappedRatio * stepMs);
}

function parseBoxInputToMs(value, {
    fallbackMs = 0,
    minMs = 0,
    maxMs = Number.POSITIVE_INFINITY,
    mode = 'round',
    subUnitPrecision = false
} = {}) {
    const parsedMs = parseInputToMs(value, {
        unit: getBaseTimeUnit(),
        fallbackMs,
        minMs: 0,
        maxMs
    });
    const snappedMs = snapMsToUnitStep(parsedMs, {
        unit: getBaseTimeUnit(),
        mode,
        subUnitPrecision
    });
    return Math.max(minMs, Math.min(maxMs, snappedMs));
}

function getScaleBounds() {
    const hasApp = typeof app !== 'undefined' && app;
    const min = hasApp && Number.isFinite(app.minPixelsPerMs) ? app.minPixelsPerMs : 0.001;
    const max = hasApp && Number.isFinite(app.maxPixelsPerMs) ? app.maxPixelsPerMs : 1000;
    return { min, max };
}

function clampPixelsPerMs(value) {
    const { min, max } = getScaleBounds();
    const numericValue = Number.isFinite(value) ? value : DEFAULT_PIXELS_PER_MS;
    return Math.max(min, Math.min(max, numericValue));
}

function normalizeDiagramViewState(viewState) {
    if (!viewState || typeof viewState !== 'object') return null;
    const hasScale = Number.isFinite(viewState.pixelsPerMs);
    const hasFallbackScale = Number.isFinite(viewState.zoomBeforeFitScale);
    const hasFallbackScroll = Number.isFinite(viewState.zoomBeforeFitScrollLeft);
    const hasFitModeFlag = typeof viewState.fitModeActive === 'boolean';
    if (!hasScale && !hasFallbackScale && !hasFallbackScroll && !hasFitModeFlag) return null;

    return {
        pixelsPerMs: hasScale ? clampPixelsPerMs(viewState.pixelsPerMs) : DEFAULT_PIXELS_PER_MS,
        zoomBeforeFitScale: hasFallbackScale ? clampPixelsPerMs(viewState.zoomBeforeFitScale) : null,
        zoomBeforeFitScrollLeft: hasFallbackScroll ? Math.max(0, viewState.zoomBeforeFitScrollLeft) : null,
        fitModeActive: hasFitModeFlag ? !!viewState.fitModeActive : hasFallbackScale
    };
}

function getCurrentViewStateForPersistence() {
    return {
        pixelsPerMs: clampPixelsPerMs(app?.pixelsPerMs),
        zoomBeforeFitScale: Number.isFinite(app?.zoomBeforeFitScale)
            ? clampPixelsPerMs(app.zoomBeforeFitScale)
            : null,
        zoomBeforeFitScrollLeft: Number.isFinite(app?.zoomBeforeFitScrollLeft)
            ? Math.max(0, app.zoomBeforeFitScrollLeft)
            : null,
        fitModeActive: !!app?.fitModeActive
    };
}

function applyDiagramViewState(viewState) {
    const normalized = normalizeDiagramViewState(viewState);
    if (normalized) {
        app.pixelsPerMs = normalized.pixelsPerMs;
        app.zoomBeforeFitScale = normalized.zoomBeforeFitScale;
        app.zoomBeforeFitScrollLeft = normalized.zoomBeforeFitScrollLeft;
        app.fitModeActive = !!normalized.fitModeActive;
        app.hasDiagramViewState = true;
    } else {
        app.pixelsPerMs = getDefaultZoomScaleForBaseUnit();
        app.zoomBeforeFitScale = null;
        app.zoomBeforeFitScrollLeft = null;
        app.fitModeActive = false;
        app.hasDiagramViewState = false;
    }

    if (app.elements?.zoomLevel) {
        app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);
    }
}

function getLaneHeightPx() {
    const cssLaneHeight = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--lane-height'),
        10
    );
    return Number.isFinite(cssLaneHeight) && cssLaneHeight > 0
        ? cssLaneHeight
        : DEFAULT_LANE_HEIGHT;
}

function bindLaneNameInputOnce() {
    const laneNameInput = document.getElementById('lane-name');
    if (!laneNameInput || laneNameInput.dataset.v2LaneNameBound === '1') return;

    // Clone once to clear pre-V2 listeners, then bind a single listener set.
    const newInput = laneNameInput.cloneNode(true);
    newInput.dataset.v2LaneNameBound = '1';
    laneNameInput.parentNode.replaceChild(newInput, laneNameInput);

    const syncLaneName = () => {
        if (app.selectedLaneId) {
            app.diagram.renameLane(parseInt(app.selectedLaneId, 10), newInput.value);
            renderLaneList();
            renderLanesCanvas();
            autoSave();
        }
    };

    newInput.addEventListener('input', syncLaneName);
    newInput.addEventListener('change', syncLaneName);
    newInput.addEventListener('keydown', (e) => {
        // Enter = apply/blur, Shift+Enter = newline.
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            newInput.blur();
        }
    });
}

function readImportedLaneColor(lane, fallback) {
    const candidate = lane.baseColor || lane.color || lane.laneColor || lane.lane_color;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    return fallback;
}

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
        const laneName = (typeof name === 'string' && name.trim()) ? name : `Lane ${this.lanes.length + 1}`;
        const lane = {
            id: this.nextLaneId++,
            name: laneName,
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
            lane.name = (typeof newName === 'string' && newName.trim()) ? newName : `Lane ${lane.order + 1}`;
        }
    }

    insertLaneAt(position, name, baseColor = null) {
        // If no color provided, assign one from PALETTE based on position
        const color = baseColor || PALETTE[(this.lanes.length) % PALETTE.length];
        const laneName = (typeof name === 'string' && name.trim()) ? name : `Lane ${position + 1}`;
        const lane = {
            id: this.nextLaneId++,
            name: laneName,
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
            settings: app.settings, // Include diagram-specific settings
            viewState: getCurrentViewStateForPersistence(),
            measurement: measurement, // Legacy pinned measurement format
            measurementState: getMeasurementStateForPersistence()
        };
    }

    fromJSON(data) {
        this.title = data.title || 'Timeline Diagram';
        this.startTime = data.startTime || '00:00:00 000';
        this.lanes = Array.isArray(data.lanes) ? data.lanes.map(l => ({ ...l })) : [];
        this.boxes = Array.isArray(data.boxes) ? data.boxes.map(b => ({ ...b })) : [];
        // Calculate safe next IDs from actual data to prevent ID collisions
        const maxLaneId = this.lanes.length > 0 ? Math.max(...this.lanes.map(l => l.id)) + 1 : 1;
        const maxBoxId = this.boxes.length > 0 ? Math.max(...this.boxes.map(b => b.id)) + 1 : 1;
        this.nextLaneId = Math.max(data.nextLaneId || 1, maxLaneId);
        this.nextBoxId = Math.max(data.nextBoxId || 1, maxBoxId);
        this.locked = data.locked || false;

        // Migration: Ensure all lanes have required fields (for old saved diagrams)
        this.lanes.forEach((lane, index) => {
            if (typeof lane.name !== 'string' || !lane.name.trim()) {
                lane.name = `Lane ${index + 1}`;
            }
            if (typeof lane.order !== 'number') {
                lane.order = index;
            }
            lane.baseColor = readImportedLaneColor(lane, PALETTE[index % PALETTE.length]);
        });

        // Migration: Ensure boxes have required fields and preserve imported colors.
        // If box color is missing, derive it from lane base color for compatibility with lane-color-only JSON.
        const laneBoxIndexMap = new Map();
        const hueShifts = [0, 15, -12, 25, -20, 35, -30, 10];
        this.boxes.forEach((box, idx) => {
            if (typeof box.startOffset !== 'number') {
                box.startOffset = parseInt(box.startOffset, 10) || 0;
            }
            if (typeof box.duration !== 'number') {
                box.duration = Math.max(1, parseInt(box.duration, 10) || 100);
            }
            if (typeof box.label !== 'string') {
                box.label = '';
            }
            if (typeof box.laneId !== 'number') {
                box.laneId = parseInt(box.laneId, 10) || (this.lanes[0]?.id || 1);
            }

            if (!(typeof box.color === 'string' && box.color.trim())) {
                const lane = this.lanes.find(l => l.id === box.laneId);
                const laneBase = lane?.baseColor || PALETTE[idx % PALETTE.length];
                const boxIdxInLane = laneBoxIndexMap.get(box.laneId) || 0;
                box.color = adjustHue(laneBase, hueShifts[boxIdxInLane % hueShifts.length]);
                laneBoxIndexMap.set(box.laneId, boxIdxInLane + 1);
            }
        });

        // Restore compression state (default to false for new/old diagrams)
        Compression.setEnabled(data.compressionEnabled || false);
        // Restore settings with code defaults when absent.
        app.settings = normalizeTimelineSettings(data.settings);
        // Restore diagram-specific viewport state (zoom/fit toggle cache).
        applyDiagramViewState(data.viewState || null);
        // Restore measurement state (new format) or legacy pinned measurement
        app.pinnedMeasurementData = data.measurementState || data.measurement || null;
    }
}

// =====================================================
// Application State
// =====================================================
const app = {
    diagram: new TimelineDiagram(),
    selectedBoxId: null,
    selectedLaneId: null,
    pixelsPerMs: DEFAULT_PIXELS_PER_MS, // Default scale: 0.15px per ms
    minPixelsPerMs: 0.001, // Allow extreme zoom out (0.67% - see entire timeline)
    maxPixelsPerMs: 1000,  // Allow extreme zoom in (666,666% - sub-microsecond detail)
    zoomBeforeFitScale: null,
    zoomBeforeFitScrollLeft: null,
    fitModeActive: false,
    hasDiagramViewState: false,
    isDragging: false,
    dragData: null,
    isActivelyDraggingOrResizing: false, // Prevents properties panel updates during drag/resize
    boxGap: 4, // Gap between boxes in pixels

    // Measurement tool state
    isMeasuring: false,
    measurePinned: false,
    measureToolActive: false, // Toggle measurement mode without holding Ctrl/Cmd
    measureStart: null,
    measureEnd: null,
    measureSnapPoints: null,
    measurements: [],
    measureSequence: 0,
    measureCurrentColor: '#39FF14',
    measurePanelDrag: null,
    measurePanelPosition: null,
    pinnedMeasurementData: null, // Stored measurement state from loaded diagram

    // Regular tooltip state
    activeUiTooltipTarget: null,
    pendingUiTooltipTarget: null,
    uiTooltipShowTimer: null,

    // Designer helper mode (H shortcut)
    designerHintsVisible: false,
    designerHintsRaf: null,
    designerHintTargets: [],
    designerHintIndex: -1,

    // Global settings
    settings: getDefaultTimelineSettings(),

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
        const timelineWidth = Math.max(1, totalDuration + (app.settings.trailingSpace || 0));
        const padding = 4;
        const availableWidth = Math.max(1, rect.width - padding * 2);
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
        const timelineWidth = Math.max(1, totalDuration + (app.settings.trailingSpace || 0));
        const safeAvailableWidth = Math.max(1, availableWidth);
        const timeScale = safeAvailableWidth / timelineWidth;

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
        const timelineWidth = Math.max(1, totalDuration + (app.settings.trailingSpace || 0));
        const safeAvailableWidth = Math.max(1, availableWidth);
        const timeScale = safeAvailableWidth / timelineWidth;

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

        const timelineWidth = Math.max(1, totalDuration + (app.settings.trailingSpace || 0));
        const safeAvailableWidth = Math.max(1, availableWidth);
        const timeScale = safeAvailableWidth / timelineWidth;

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
            btn.setAttribute('aria-pressed', this.enabled ? 'true' : 'false');
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

        persistCurrentDiagramViewState();
        autoSave();
        saveSessionState();
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

function resetCompressionView(options = {}) {
    const { rerender = true, persist = true } = options;
    Compression.setEnabled(false);
    Compression.invalidate();

    if (rerender) {
        renderTimelineRuler();
        renderLanesCanvas();
        renderTimeMarkers();
        renderAlignmentCanvasOverlay();
        Minimap.render();
        syncZoomFitIndicator();
    }

    if (persist) {
        autoSave();
        saveSessionState();
    }
}

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

// Rollback switch: set to 'floating' to restore legacy top-floating toasts.
const TOAST_LAYOUT_MODE = 'titlebar';
const TOAST_CONTAINERS = {
    titlebar: 'toast-container-titlebar',
    floating: 'toast-container-floating'
};
const activeToastByKey = new Map();
let activeConfirmState = null;

function cleanupToastFromKeyRegistry(toast) {
    const key = toast?.dataset?.toastKey;
    if (!key) return;
    if (activeToastByKey.get(key) === toast) {
        activeToastByKey.delete(key);
    }
}

function pulseToast(toast) {
    if (!toast) return;
    toast.classList.remove('toast-attention');
    // Force restart animation for repeated clicks.
    void toast.offsetWidth;
    toast.classList.add('toast-attention');
    window.setTimeout(() => toast.classList.remove('toast-attention'), 260);
}

function isEditableTypingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    if (!tag) return false;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!target.closest('[contenteditable="true"]');
}

function clearActiveConfirmState() {
    if (!activeConfirmState) return;
    if (activeConfirmState.keydownHandler) {
        document.removeEventListener('keydown', activeConfirmState.keydownHandler, true);
    }
    activeConfirmState = null;
}

function isToastContainerUsable(container) {
    if (!container) return false;
    const styles = window.getComputedStyle(container);
    return styles.display !== 'none' && styles.visibility !== 'hidden';
}

function getToastContainer() {
    const preferredId = TOAST_CONTAINERS[TOAST_LAYOUT_MODE] || TOAST_CONTAINERS.titlebar;
    const fallbackId = preferredId === TOAST_CONTAINERS.titlebar ? TOAST_CONTAINERS.floating : TOAST_CONTAINERS.titlebar;

    const preferred = document.getElementById(preferredId);
    if (isToastContainerUsable(preferred)) return preferred;

    const fallback = document.getElementById(fallbackId);
    if (isToastContainerUsable(fallback)) return fallback;

    return preferred || fallback;
}

function showToast(options) {
    const {
        type = 'info',
        title,
        message,
        duration = 4000,
        actions = null,
        toastKey = null,
        onClose = null,
        replaceExisting = false,
        className = '',
        showClose = true
    } = options;

    const container = getToastContainer();
    if (!container) return null;

    if (toastKey) {
        const existing = activeToastByKey.get(toastKey);
        if (existing && existing.isConnected) {
            if (replaceExisting) {
                hideToast(existing, { reason: 'replace' });
            } else {
                pulseToast(existing);
                return existing;
            }
        }
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    if (typeof className === 'string' && className.trim()) {
        className.trim().split(/\s+/).forEach((token) => {
            if (token) toast.classList.add(token);
        });
    }
    if (actions) toast.classList.add('toast-has-actions');
    if (toastKey) {
        toast.dataset.toastKey = toastKey;
    }

    let html = `
        <span class="toast-icon">${TOAST_ICONS[type]}</span>
        <div class="toast-content">
            ${title ? `<div class="toast-title">${title}</div>` : ''}
            ${message ? `<div class="toast-message">${message}</div>` : ''}
        </div>
    `;

    if (actions) {
        html += `<div class="toast-actions"></div>`;
    }
    if (showClose) {
        html += `<button class="toast-close" aria-label="Close notification" title="Close">×</button>`;
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
                hideToast(toast, { reason: action.type || 'action' });
                if (action.onClick) action.onClick();
            });
            actionsContainer.appendChild(btn);
        });
    }

    // Close button (available for both action and non-action toasts)
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            hideToast(toast, { reason: 'close' });
            if (typeof onClose === 'function') onClose();
        });
    }

    container.appendChild(toast);
    if (toastKey) {
        activeToastByKey.set(toastKey, toast);
    }

    // Auto dismiss if no actions and duration > 0
    if (!actions && duration > 0) {
        setTimeout(() => hideToast(toast, { reason: 'timeout' }), duration);
    }

    return toast;
}

function hideToast(toast, options = {}) {
    const { reason = 'hide', immediate = false } = options;
    if (!toast || toast.classList.contains('hiding')) return;
    if (immediate) {
        cleanupToastFromKeyRegistry(toast);
        if (toast.__onHide && !toast.__didHide) {
            toast.__didHide = true;
            try {
                toast.__onHide(reason);
            } catch (e) {
                console.warn('Toast hide callback failed:', e);
            }
        }
        toast.remove();
        return;
    }
    toast.classList.add('hiding');
    cleanupToastFromKeyRegistry(toast);
    if (toast.__onHide && !toast.__didHide) {
        toast.__didHide = true;
        try {
            toast.__onHide(reason);
        } catch (e) {
            console.warn('Toast hide callback failed:', e);
        }
    }
    setTimeout(() => {
        toast.remove();
    }, 200);
}

function showConfirmToast(options) {
    const {
        title,
        message,
        onConfirm,
        onCancel,
        confirmLabel = 'Delete',
        cancelLabel = 'Cancel',
        confirmKey = 'confirm-global'
    } = options;

    const previousConfirm = activeConfirmState;
    if (previousConfirm?.toast?.isConnected) {
        if (previousConfirm.key === confirmKey) {
            pulseToast(previousConfirm.toast);
            return previousConfirm.toast;
        }

        if (typeof previousConfirm.onCancel === 'function') {
            previousConfirm.onCancel({ reason: 'replaced' });
        } else {
            clearActiveConfirmState();
        }
        hideToast(previousConfirm.toast, { reason: 'replace-confirm', immediate: true });
    }

    const wrappedConfirm = () => {
        clearActiveConfirmState();
        if (typeof onConfirm === 'function') onConfirm();
    };
    const wrappedCancel = (meta = { reason: 'cancel' }) => {
        clearActiveConfirmState();
        if (typeof onCancel === 'function') onCancel(meta);
    };

    const toast = showToast({
        type: 'warning',
        title,
        message,
        duration: 0,
        toastKey: `confirm:${confirmKey}`,
        replaceExisting: true,
        actions: [
            { label: confirmLabel, type: 'confirm', onClick: wrappedConfirm },
            { label: cancelLabel, type: 'cancel', onClick: () => wrappedCancel({ reason: 'cancel-button' }) }
        ]
    });

    if (!toast) return null;

    toast.classList.add('toast-confirm');
    const confirmBtn = toast.querySelector('.toast-btn-confirm');
    const cancelBtn = toast.querySelector('.toast-btn-cancel');
    const closeBtn = toast.querySelector('.toast-close');
    if (confirmBtn) confirmBtn.title = `${confirmLabel} (Ctrl/Cmd+Enter)`;
    if (cancelBtn) cancelBtn.title = `${cancelLabel} (Esc)`;
    if (closeBtn) closeBtn.title = `Cancel (Esc)`;

    toast.__onHide = (reason) => {
        cleanupToastFromKeyRegistry(toast);
        if (activeConfirmState?.toast === toast) {
            if (reason === 'close' || reason === 'timeout' || reason === 'replace' || reason === 'replace-confirm' || reason === 'hide') {
                wrappedCancel({ reason });
            } else {
                clearActiveConfirmState();
            }
        }
    };

    const keydownHandler = (event) => {
        if (!activeConfirmState || activeConfirmState.toast !== toast || !toast.isConnected) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            const cancelBtn = toast.querySelector('.toast-btn-cancel');
            if (cancelBtn) {
                cancelBtn.click();
            } else {
                hideToast(toast, { reason: 'escape' });
                wrappedCancel({ reason: 'escape' });
            }
            return;
        }

        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !isEditableTypingTarget(event.target)) {
            event.preventDefault();
            const confirmBtn = toast.querySelector('.toast-btn-confirm');
            if (confirmBtn) confirmBtn.click();
        }
    };

    document.addEventListener('keydown', keydownHandler, true);
    activeConfirmState = {
        key: confirmKey,
        toast,
        onCancel: wrappedCancel,
        keydownHandler
    };

    return toast;
}

// =====================================================
// Diagram Storage (localStorage)
// =====================================================
const STORAGE_KEY = 'timeline_diagrams';
const ACTIVE_DIAGRAM_KEY = 'timeline_active_diagram';
const SESSION_STATE_KEY = 'timeline_session_state';
const MAX_DIAGRAMS = 10;
let currentDiagramId = null;
let autoSaveTimeout = null;
let pendingDiagramDeleteId = null;
let pendingLaneDeleteId = null;
let pendingPurgeRequest = null;
const laneHistory = {
    undoStack: [],
    redoStack: [],
    maxEntries: 50
};

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

function setCurrentDiagramId(diagramId) {
    currentDiagramId = diagramId || null;
    try {
        if (currentDiagramId) {
            localStorage.setItem(ACTIVE_DIAGRAM_KEY, currentDiagramId);
        } else {
            localStorage.removeItem(ACTIVE_DIAGRAM_KEY);
        }
    } catch (e) {
        console.warn('Failed to persist active diagram id:', e);
    }
}

function getStoredActiveDiagramId() {
    try {
        const id = localStorage.getItem(ACTIVE_DIAGRAM_KEY);
        return (typeof id === 'string' && id.trim()) ? id : null;
    } catch (e) {
        console.warn('Failed to read active diagram id:', e);
        return null;
    }
}

function loadActiveDiagramFromStorage() {
    const activeId = getStoredActiveDiagramId();
    if (!activeId) return false;

    const diagrams = getAllDiagrams();
    const exists = diagrams.some(d => d.id === activeId);
    if (!exists) {
        setCurrentDiagramId(null);
        return false;
    }

    return loadDiagram(activeId);
}

function saveSessionState() {
    try {
        const payload = {
            activeDiagramId: currentDiagramId || null,
            pixelsPerMs: Number.isFinite(app?.pixelsPerMs) ? app.pixelsPerMs : 0.15,
            zoomBeforeFitScale: Number.isFinite(app?.zoomBeforeFitScale) ? app.zoomBeforeFitScale : null,
            zoomBeforeFitScrollLeft: Number.isFinite(app?.zoomBeforeFitScrollLeft) ? app.zoomBeforeFitScrollLeft : null,
            fitModeActive: !!app?.fitModeActive
        };
        localStorage.setItem(SESSION_STATE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('Failed to persist session state:', e);
    }
}

function loadSessionState() {
    try {
        const raw = localStorage.getItem(SESSION_STATE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (e) {
        console.warn('Failed to load session state:', e);
        return null;
    }
}

function persistCurrentDiagramViewState() {
    if (!currentDiagramId) return;

    const diagrams = getAllDiagrams();
    const index = diagrams.findIndex(d => d.id === currentDiagramId);
    if (index < 0) return;

    if (!diagrams[index].data || typeof diagrams[index].data !== 'object') {
        diagrams[index].data = {};
    }
    diagrams[index].data.viewState = getCurrentViewStateForPersistence();
    diagrams[index].data.compressionEnabled = !!Compression.enabled;
    diagrams[index].updatedAt = Date.now();
    saveDiagramsList(diagrams);
}

function applySessionState(state) {
    if (!state || typeof state !== 'object') return;

    if (Number.isFinite(state.pixelsPerMs)) {
        app.pixelsPerMs = Math.max(app.minPixelsPerMs, Math.min(app.maxPixelsPerMs, state.pixelsPerMs));
        if (app.elements?.zoomLevel) {
            app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);
        }
    }

    app.zoomBeforeFitScale = Number.isFinite(state.zoomBeforeFitScale)
        ? Math.max(app.minPixelsPerMs, Math.min(app.maxPixelsPerMs, state.zoomBeforeFitScale))
        : null;
    app.zoomBeforeFitScrollLeft = Number.isFinite(state.zoomBeforeFitScrollLeft)
        ? Math.max(0, state.zoomBeforeFitScrollLeft)
        : null;
    app.fitModeActive = (typeof state.fitModeActive === 'boolean')
        ? state.fitModeActive
        : Number.isFinite(app.zoomBeforeFitScale);
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
        setCurrentDiagramId(generateDiagramId());
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
    saveSessionState();
    // Use V2 badge update
    if (typeof updateDiagramsBadge === 'function') {
        updateDiagramsBadge();
    }
}

function autoSave() {
    if (!currentDiagramId) return;
    // Debounce auto-save
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    autoSaveTimeout = setTimeout(() => {
        saveCurrentDiagram();
        autoSaveTimeout = null;
    }, 1000);
}

function flushPendingAutoSave() {
    if (!autoSaveTimeout) return;
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    if (currentDiagramId) {
        saveCurrentDiagram();
    }
}

function loadDiagram(diagramId) {
    if (currentDiagramId && currentDiagramId !== diagramId) {
        flushPendingAutoSave();
        persistCurrentDiagramViewState();
    }

    const diagrams = getAllDiagrams();
    const diagram = diagrams.find(d => d.id === diagramId);
    if (!diagram) {
        showToast({ type: 'error', title: 'Not Found', message: 'Diagram not found in storage.' });
        return false;
    }

    pendingDiagramDeleteId = null;
    pendingLaneDeleteId = null;
    clearPendingPurgeRequest();
    clearLaneHistory();

    setCurrentDiagramId(diagramId);
    app.diagram.fromJSON(diagram.data);
    app.elements.diagramTitle.value = app.diagram.title;
    app.elements.startTime.value = app.diagram.startTime;
    syncToolbarSettingsControls();

    deselectBox();
    renderLaneList();
    // renderLanesCanvas already refreshes ruler, markers, alignment overlay and minimap.
    renderLanesCanvas();
    updateTotalDuration();
    renderDiagramsList();

    // Update lock state
    updateLockState();

    // Update box labels state
    updateBoxLabelsState();

    // Restore pinned measurement if present
    restorePinnedMeasurement();

    saveSessionState();
    showToast({ type: 'success', title: 'Loaded', message: `"${diagram.title}" restored.`, duration: 2000 });
    return true;
}

function clearPendingDiagramDelete(options = {}) {
    const { rerender = true } = options;
    if (!pendingDiagramDeleteId) return;
    pendingDiagramDeleteId = null;
    if (rerender) renderDiagramsList();
}

function requestDiagramDelete(diagramId) {
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

    if (pendingDiagramDeleteId === diagramId) return;
    pendingDiagramDeleteId = diagramId;
    renderDiagramsList();
}

function confirmDiagramDelete(diagramId) {
    if (!diagramId) return;
    pendingDiagramDeleteId = null;

    const diagrams = getAllDiagrams();
    const diagram = diagrams.find(d => d.id === diagramId);
    if (!diagram) {
        renderDiagramsList();
        return;
    }

    // Re-check lock state before final deletion
    if (diagram.data && diagram.data.locked) {
        showToast({
            type: 'warning',
            title: 'Diagram Locked',
            message: 'Unlock the diagram before deleting.',
            duration: 2500
        });
        renderDiagramsList();
        return;
    }

    const filtered = diagrams.filter(d => d.id !== diagramId);
    saveDiagramsList(filtered);

    if (filtered.length === 0) {
        enterNoDiagramState();
    } else if (diagramId === currentDiagramId) {
        // If deleting current diagram, load the most recent remaining diagram
        loadDiagram(filtered[0].id);
    } else {
        renderDiagramsList();
    }

    // Deleting any diagram should reset compression view to avoid stale gap markers.
    resetCompressionView({ rerender: true, persist: true });

    showToast({ type: 'success', title: 'Deleted', message: 'Diagram removed.', duration: 1600 });
}

function deleteDiagram(diagramId) {
    requestDiagramDelete(diagramId);
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

function buildPurgeRequest(source = 'settings') {
    const diagrams = getAllDiagrams();
    const lockedDiagrams = diagrams.filter(d => d.data && d.data.locked);
    const unlockedDiagrams = diagrams.filter(d => !d.data || !d.data.locked);
    const hasLocked = lockedDiagrams.length > 0;
    const hasUnlocked = unlockedDiagrams.length > 0;

    if (!hasUnlocked && !hasLocked) {
        showToast({ type: 'info', title: 'Nothing to Purge', message: 'No diagrams found.', duration: 2000 });
        return null;
    }

    if (hasLocked && !hasUnlocked) {
        showToast({ type: 'info', title: 'All Diagrams Locked', message: 'No unlocked diagrams to purge.', duration: 2500 });
        return null;
    }

    if (hasLocked && hasUnlocked) {
        return {
            source,
            mode: 'unlocked',
            title: 'Purge Unlocked Diagrams?',
            message: `${unlockedDiagrams.length} unlocked diagram(s) will be deleted. ${lockedDiagrams.length} locked diagram(s) will be preserved.`,
            confirmLabel: 'Purge Unlocked'
        };
    }

    return {
        source,
        mode: 'all',
        title: 'Purge Application?',
        message: 'ALL diagrams and settings will be permanently deleted. This cannot be undone!',
        confirmLabel: 'Purge All'
    };
}

function clearPendingPurgeRequest(options = {}) {
    const { rerender = true } = options;
    pendingPurgeRequest = null;
    if (rerender) {
        renderPurgeInlineConfirm();
    }
}

function renderPurgeInlineConfirm() {
    document.querySelectorAll('.purge-inline-container').forEach(node => node.remove());

    const settingsBtn = document.getElementById('purge-app-btn');
    const modalBtn = document.getElementById('purge-diagrams-btn');
    if (settingsBtn) settingsBtn.classList.remove('is-delete-pending');
    if (modalBtn) modalBtn.classList.remove('is-delete-pending');

    if (!pendingPurgeRequest) return;

    const targetBtn = pendingPurgeRequest.source === 'modal' ? modalBtn : settingsBtn;
    if (!targetBtn) return;
    targetBtn.classList.add('is-delete-pending');

    const container = document.createElement('div');
    container.className = `purge-inline-container purge-inline-${pendingPurgeRequest.source}`;

    const overlay = createInlineDeleteOverlay({
        title: pendingPurgeRequest.title,
        message: pendingPurgeRequest.message,
        confirmLabel: pendingPurgeRequest.confirmLabel,
        cancelLabel: 'Cancel',
        onConfirm: () => confirmPurgeOperation(),
        onCancel: () => clearPendingPurgeRequest()
    });
    overlay.classList.add('inline-delete-inline', 'purge-inline-overlay');
    container.appendChild(overlay);

    if (pendingPurgeRequest.source === 'modal') {
        const footer = targetBtn.closest('.modal-footer');
        if (footer && footer.parentElement) {
            footer.parentElement.insertBefore(container, footer);
        }
        return;
    }

    const group = targetBtn.closest('.form-group') || targetBtn.parentElement;
    if (group) {
        group.appendChild(container);
    }
}

function executePurgeOperation(mode) {
    if (mode === 'unlocked') {
        const diagrams = getAllDiagrams();
        const lockedDiagrams = diagrams.filter(d => d.data && d.data.locked);
        const unlockedDiagrams = diagrams.filter(d => !d.data || !d.data.locked);
        if (unlockedDiagrams.length === 0) {
            showToast({ type: 'info', title: 'All Diagrams Locked', message: 'No unlocked diagrams to purge.', duration: 2500 });
            return;
        }

        saveDiagramsList(lockedDiagrams);
        const currentStillExists = lockedDiagrams.some(d => d.id === currentDiagramId);
        if (!currentStillExists) {
            if (lockedDiagrams.length > 0) {
                loadDiagram(lockedDiagrams[0].id);
            } else {
                enterNoDiagramState();
            }
        } else {
            renderDiagramsList();
        }

        clearSelectedLaneSelection();
        clearLaneHistory();
        if (app.elements.propertiesPanel) {
            app.elements.propertiesPanel.classList.add('hidden');
        }
        showToast({ type: 'success', title: 'Purged', message: `${unlockedDiagrams.length} diagram(s) deleted. Locked diagrams preserved.`, duration: 2600 });
        return;
    }

    // mode: 'all'
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_DIAGRAM_KEY);
    localStorage.removeItem(SESSION_STATE_KEY);

    enterNoDiagramState({ resetSettings: true });

    showToast({ type: 'success', title: 'Purged', message: 'All data has been removed.', duration: 2600 });
}

function confirmPurgeOperation() {
    if (!pendingPurgeRequest) return;
    const mode = pendingPurgeRequest.mode;
    clearPendingPurgeRequest();
    pendingDiagramDeleteId = null;
    pendingLaneDeleteId = null;
    executePurgeOperation(mode);
}

function purgeApplication(source = null) {
    const modal = document.getElementById('diagrams-modal');
    const resolvedSource = source || ((modal && !modal.classList.contains('hidden')) ? 'modal' : 'settings');
    const request = buildPurgeRequest(resolvedSource);
    if (!request) {
        clearPendingPurgeRequest();
        return;
    }

    pendingPurgeRequest = request;
    renderPurgeInlineConfirm();
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

    pendingDiagramDeleteId = null;
    pendingLaneDeleteId = null;
    clearPendingPurgeRequest();
    clearLaneHistory();
    flushPendingAutoSave();

    setCurrentDiagramId(generateDiagramId());
    app.diagram = new TimelineDiagram();
    app.diagram.title = generateDiagramTitle();
    app.diagram.addLane('Lane 1');
    applyDiagramViewState(null);
    app.selectedBoxId = null;
    app.selectedLaneId = null;

    // Clear any pinned measurement
    closeMeasurement();

    app.elements.diagramTitle.value = app.diagram.title;
    app.elements.startTime.value = app.diagram.startTime;
    syncToolbarSettingsControls();

    deselectBox();
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentCanvasOverlay();
    updateTotalDuration();

    // Save the new empty diagram
    saveCurrentDiagram();
    // Render list after save so first diagram appears immediately after zero-diagram state.
    renderDiagramsList();

    showToast({
        type: 'success',
        title: 'Diagram Created',
        message: `"${app.diagram.title}" is ready to use.`,
        duration: 2000
    });
}

function enterNoDiagramState(options = {}) {
    const { resetSettings = false } = options;

    pendingDiagramDeleteId = null;
    pendingLaneDeleteId = null;
    clearPendingPurgeRequest();
    clearLaneHistory();
    flushPendingAutoSave();

    setCurrentDiagramId(null);
    app.diagram = new TimelineDiagram();
    if (resetSettings) {
        app.settings = getDefaultTimelineSettings();
    }
    applyDiagramViewState(null);
    app.selectedBoxId = null;
    app.selectedLaneId = null;
    Compression.setEnabled(false);
    Compression.invalidate();
    closeMeasurement();

    if (app.elements?.diagramTitle) app.elements.diagramTitle.value = '';
    if (app.elements?.startTime) app.elements.startTime.value = app.diagram.startTime;
    syncToolbarSettingsControls();

    deselectBox();
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentCanvasOverlay();
    updateTotalDuration();
    renderDiagramsList();
    updateLockState();
    updateBoxLabelsState();

    if (app.elements.propertiesPanel) {
        app.elements.propertiesPanel.classList.add('hidden');
    }

    saveSessionState();
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

function createInlineDeleteOverlay(options) {
    const {
        title = 'Delete?',
        message = 'This action will remove the item.',
        confirmLabel = 'Delete',
        cancelLabel = 'Cancel',
        onConfirm,
        onCancel
    } = options || {};

    const overlay = document.createElement('div');
    overlay.className = 'inline-delete-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-live', 'polite');
    overlay.addEventListener('click', (e) => e.stopPropagation());

    const content = document.createElement('div');
    content.className = 'inline-delete-content';

    const heading = document.createElement('div');
    heading.className = 'inline-delete-title';
    heading.textContent = title;

    const desc = document.createElement('div');
    desc.className = 'inline-delete-message';
    desc.textContent = message;

    content.appendChild(heading);
    content.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'inline-delete-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'inline-delete-btn inline-delete-btn-confirm';
    confirmBtn.type = 'button';
    confirmBtn.textContent = confirmLabel;
    confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof onConfirm === 'function') onConfirm();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'inline-delete-btn inline-delete-btn-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof onCancel === 'function') onCancel();
    });

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);

    overlay.appendChild(content);
    overlay.appendChild(actions);

    return overlay;
}

function renderDiagramsList() {
    const container = document.getElementById('diagrams-list');
    if (!container) return;

    container.innerHTML = '';
    const diagrams = getAllDiagrams();
    if (pendingDiagramDeleteId && !diagrams.some(d => d.id === pendingDiagramDeleteId)) {
        pendingDiagramDeleteId = null;
    }

    if (diagrams.length === 0) {
        pendingDiagramDeleteId = null;
        container.innerHTML = '<div class="empty-state">No saved diagrams found.</div>';
        updateNewDiagramButton();
        updateLoadButton();
        updateDiagramsBadge();
        return;
    }

    diagrams.forEach(d => {
        const item = document.createElement('div');
        item.className = 'diagram-item';
        if (d.id === currentDiagramId) {
            item.classList.add('active');
        }

        const date = new Date(d.updatedAt).toLocaleString();

        const isLocked = d.data && d.data.locked;
        const isDeletePending = pendingDiagramDeleteId === d.id;

        // Build diagram item with DOM methods
        const info = document.createElement('div');
        info.className = 'diagram-info';
        info.style.cursor = 'pointer';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'diagram-title';
        titleDiv.textContent = d.title || 'Untitled';
        if (isLocked) {
            const lockSpan = document.createElement('span');
            lockSpan.className = 'lock-icon';
            lockSpan.title = 'Locked';
            lockSpan.textContent = '\uD83D\uDD12';
            titleDiv.appendChild(document.createTextNode(' '));
            titleDiv.appendChild(lockSpan);
        }

        const dateDiv = document.createElement('div');
        dateDiv.className = 'diagram-date';
        dateDiv.textContent = date;

        info.appendChild(titleDiv);
        info.appendChild(dateDiv);

        const actions = document.createElement('div');
        actions.className = 'diagram-actions';

        const lockBtn = document.createElement('button');
        lockBtn.className = 'icon-btn lock-btn';
        lockBtn.title = isLocked ? 'Unlock' : 'Lock';
        lockBtn.setAttribute('aria-label', isLocked ? 'Unlock diagram' : 'Lock diagram');
        if (isLocked) lockBtn.classList.add('is-locked');
        lockBtn.innerHTML = `
            <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="10" width="14" height="10" rx="2"></rect>
                <path d="M8 10V7a4 4 0 1 1 8 0v3"></path>
            </svg>
            <span class="sr-only">${isLocked ? 'Unlock' : 'Lock'}</span>
        `;
        lockBtn.dataset.id = d.id;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete-btn';
        deleteBtn.title = 'Delete';
        deleteBtn.textContent = '\u00D7';
        deleteBtn.style.color = 'var(--danger)';
        deleteBtn.style.fontWeight = 'bold';
        deleteBtn.style.fontSize = '16px';
        deleteBtn.dataset.id = d.id;

        actions.appendChild(lockBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);

        if (isDeletePending) {
            item.classList.add('is-delete-pending');
            const overlay = createInlineDeleteOverlay({
                title: 'Delete Diagram?',
                message: `"${d.title || 'Untitled'}" will be permanently removed.`,
                confirmLabel: 'Delete',
                cancelLabel: 'Cancel',
                onConfirm: () => confirmDiagramDelete(d.id),
                onCancel: () => clearPendingDiagramDelete()
            });
            overlay.classList.add('diagram-inline-delete');
            item.appendChild(overlay);
        }

        // Click name/info area to load diagram
        info.addEventListener('click', (e) => {
            e.stopPropagation();
            if (loadDiagram(d.id)) {
                clearPendingDiagramDelete({ rerender: false });
                clearPendingPurgeRequest();
                document.getElementById('diagrams-modal').classList.add('hidden');
            }
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteDiagram(d.id);
        });

        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDiagramLock(d.id);
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

function formatDuration(ms, forceUnit = null) {
    const numericMs = Number(ms);
    const baseUnit = normalizeBaseTimeUnit(forceUnit || getBaseTimeUnit());
    const unitLabel = getBaseUnitLabel(baseUnit);

    if (!Number.isFinite(numericMs)) {
        return `0${unitLabel}`;
    }

    // For non-ms base units, show sub-unit values below threshold and base-unit values above threshold.
    if (baseUnit !== 'ms') {
        const thresholdMs = Math.max(0, Number(app?.settings?.timeFormatThreshold || 0));
        const subUnit = getBaseUnitSubunit(baseUnit);
        const showSubUnit = !!subUnit && thresholdMs > 0 && Math.abs(numericMs) < thresholdMs;
        const activeUnit = showSubUnit ? subUnit : baseUnit;
        const unitValue = msToUnitValue(numericMs, activeUnit);
        const activeLabel = getBaseUnitLabel(activeUnit);
        return `${formatUnitValue(unitValue, 2)}${activeLabel}`;
    }

    const threshold = app.settings.timeFormatThreshold;

    // Handle sub-millisecond values (for extreme zoom)
    if (numericMs < 1 && numericMs > 0) {
        const us = numericMs * 1000; // Convert to microseconds
        if (us < 1) {
            const ns = us * 1000; // Convert to nanoseconds
            return `${ns.toFixed(ns < 10 ? 1 : 0)}ns`;
        }
        return `${us.toFixed(us < 10 ? 1 : 0)}μs`;
    }

    // If threshold is 0, always show ms
    if (threshold === 0) {
        return `${Math.round(numericMs)}ms`;
    }

    // If duration exceeds threshold, show in appropriate unit
    if (numericMs >= threshold) {
        if (numericMs >= 60000) {
            // Show minutes and seconds
            const minutes = Math.floor(numericMs / 60000);
            const seconds = ((numericMs % 60000) / 1000).toFixed(1);
            return seconds === '0.0' ? `${minutes}m` : `${minutes}m ${seconds}s`;
        }
        // Show seconds
        const seconds = (numericMs / 1000).toFixed(numericMs % 1000 === 0 ? 0 : 1);
        return `${seconds}s`;
    }
    return `${Math.round(numericMs)}ms`;
}

function syncBaseTimeUnitUI() {
    const baseUnit = getBaseTimeUnit();
    const unitLabel = getBaseUnitLabel(baseUnit);

    const baseUnitSelect = document.getElementById('config-base-time-unit');
    if (baseUnitSelect && baseUnitSelect.value !== baseUnit) {
        baseUnitSelect.value = baseUnit;
    }

    [
        'config-timeline-duration-unit',
        'config-trailing-space-unit',
        'config-compression-threshold-unit',
        'box-start-unit-label',
        'box-duration-unit-label',
        'box-end-unit-label',
        'props-box-start-unit-label',
        'props-box-duration-unit-label'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = unitLabel;
    });

    const durationInput = document.getElementById('config-timeline-duration');
    if (durationInput) {
        durationInput.step = 'any';
        durationInput.min = formatMsForInput(1000, baseUnit, 6);
        durationInput.value = formatMsForInput(app.settings.timelineDuration, baseUnit);
    }

    const trailingInput = document.getElementById('config-trailing-space');
    if (trailingInput) {
        trailingInput.step = 'any';
        trailingInput.min = '0';
        trailingInput.value = formatMsForInput(app.settings.trailingSpace, baseUnit);
    }

    const compressionInput = document.getElementById('config-compression-threshold');
    if (compressionInput) {
        compressionInput.step = 'any';
        compressionInput.min = formatMsForInput(10, baseUnit, 6);
        compressionInput.value = formatMsForInput(app.settings.compressionThreshold, baseUnit);
    }

    const boxStep = '1';
    if (app.elements?.boxStart) app.elements.boxStart.step = boxStep;
    if (app.elements?.boxDuration) app.elements.boxDuration.step = boxStep;
    const propsStartInput = document.getElementById('props-box-start');
    const propsDurationInput = document.getElementById('props-box-duration');
    if (propsStartInput) propsStartInput.step = boxStep;
    if (propsDurationInput) propsDurationInput.step = boxStep;

    if (app.selectedBoxId && app.elements) {
        const box = app.diagram.boxes.find(b => b.id === app.selectedBoxId);
        if (box) {
            if (app.elements.boxStart) app.elements.boxStart.value = formatMsForInput(box.startOffset, baseUnit);
            if (app.elements.boxDuration) app.elements.boxDuration.value = formatMsForInput(box.duration, baseUnit);
            if (app.elements.boxEnd) app.elements.boxEnd.value = formatMsForInput(box.startOffset + box.duration, baseUnit);

            const propsStart = document.getElementById('props-box-start');
            const propsDuration = document.getElementById('props-box-duration');
            if (propsStart) propsStart.value = formatMsForInput(box.startOffset, baseUnit);
            if (propsDuration) propsDuration.value = formatMsForInput(box.duration, baseUnit);
        }
    }

    syncTimeThresholdControl();
}

/**
 * Format zoom level as a readable percentage string
 * Handles very large/small zoom levels gracefully
 */
function formatZoomLevel(pixelsPerMs) {
    const baseline = Math.max(1e-9, getDefaultZoomScaleForBaseUnit());
    const percent = (pixelsPerMs / baseline) * 100;
    if (percent >= 10000) {
        return `${(percent / 1000).toFixed(0)}k%`;
    }
    if (percent < 1) {
        return `${percent.toFixed(1)}%`;
    }
    return `${Math.round(percent)}%`;
}

function msToPixels(ms) {
    const granularityMs = getRenderGranularityMs();
    return (ms / granularityMs) * app.pixelsPerMs;
}

function pixelsToMs(px) {
    const granularityMs = getRenderGranularityMs();
    return (px / app.pixelsPerMs) * granularityMs;
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

function isBoxVisuallyExpanded(duration) {
    const visualDuration = DurationScaling.getVisualDuration(duration);
    const unclampedWidth = msToPixels(visualDuration);
    const minWidth = DurationScaling.getMinBoxWidth();
    return minWidth > 0 && (unclampedWidth + 0.01) < minWidth;
}

function getRenderedBoxEdges(box) {
    const visualOffset = Compression.getVisualOffset(box);
    const leftPx = msToPixels(visualOffset);
    const widthPx = getBoxVisualWidth(box.duration);
    return {
        leftPx,
        rightPx: leftPx + widthPx,
        widthPx,
        isVisuallyExpanded: isBoxVisuallyExpanded(box.duration)
    };
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

function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const canUndo = laneHistory.undoStack.length > 0;
    const canRedo = laneHistory.redoStack.length > 0;

    if (undoBtn) {
        undoBtn.disabled = !canUndo;
        undoBtn.title = canUndo ? 'Undo lane deletion (Ctrl/Cmd+Z)' : 'Undo lane deletion';
    }
    if (redoBtn) {
        redoBtn.disabled = !canRedo;
        redoBtn.title = canRedo ? 'Redo lane deletion (Ctrl/Cmd+Shift+Z)' : 'Redo lane deletion';
    }
}

function flashUndoButton() {
    const undoBtn = document.getElementById('undo-btn');
    if (!undoBtn) return;

    if (flashUndoButton.timer) {
        clearTimeout(flashUndoButton.timer);
    }

    undoBtn.classList.remove('undo-flash');
    // Force reflow so repeated deletions retrigger the animation.
    void undoBtn.offsetWidth;
    undoBtn.classList.add('undo-flash');

    flashUndoButton.timer = setTimeout(() => {
        undoBtn.classList.remove('undo-flash');
        flashUndoButton.timer = null;
    }, 850);
}

function clearLaneHistory() {
    laneHistory.undoStack = [];
    laneHistory.redoStack = [];
    updateUndoRedoButtons();
}

function pushLaneHistoryEntry(entry) {
    if (!entry) return;
    laneHistory.undoStack.push(entry);
    if (laneHistory.undoStack.length > laneHistory.maxEntries) {
        laneHistory.undoStack.shift();
    }
    laneHistory.redoStack = [];
    updateUndoRedoButtons();
}

function captureLaneDeleteEntry(laneId) {
    const laneIndex = app.diagram.lanes.findIndex(l => l.id === laneId);
    if (laneIndex === -1) return null;

    const laneSnapshot = { ...app.diagram.lanes[laneIndex] };
    const removedBoxes = app.diagram.boxes
        .filter(b => b.laneId === laneId)
        .map(b => ({ ...b }));
    const removedBoxIds = new Set(removedBoxes.map(b => b.id));

    app.diagram.lanes.splice(laneIndex, 1);
    app.diagram.boxes = app.diagram.boxes.filter(b => b.laneId !== laneId);
    app.diagram.lanes.forEach((lane, index) => { lane.order = index; });

    if (parseInt(app.selectedLaneId, 10) === laneId) {
        app.selectedLaneId = null;
        const laneNameInput = document.getElementById('lane-name');
        if (laneNameInput) laneNameInput.value = '';
        if (typeof V2 !== 'undefined' && V2.isV2 && V2.currentMode === 'lane' && typeof V2.hideRightSidebar === 'function') {
            V2.hideRightSidebar();
        }
        syncSelectedLaneUI();
    }
    if (app.selectedBoxId && removedBoxIds.has(app.selectedBoxId)) {
        app.selectedBoxId = null;
        document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));
    }

    return {
        type: 'lane-delete',
        laneSnapshot,
        removedBoxes,
        laneIndex,
        currentLaneId: laneId
    };
}

function restoreLaneDeleteEntry(entry) {
    if (!entry || entry.type !== 'lane-delete' || !entry.laneSnapshot) return false;

    let restoredLaneId = Number.isInteger(entry.currentLaneId) ? entry.currentLaneId : entry.laneSnapshot.id;
    if (app.diagram.lanes.some(l => l.id === restoredLaneId)) {
        restoredLaneId = app.diagram.nextLaneId++;
    }

    const insertionIndex = Math.min(Math.max(entry.laneIndex, 0), app.diagram.lanes.length);
    app.diagram.lanes.splice(insertionIndex, 0, { ...entry.laneSnapshot, id: restoredLaneId });
    app.diagram.lanes.forEach((lane, index) => { lane.order = index; });
    app.diagram.nextLaneId = Math.max(app.diagram.nextLaneId || 1, restoredLaneId + 1);

    const usedBoxIds = new Set(app.diagram.boxes.map(b => b.id));
    let nextBoxId = app.diagram.nextBoxId || 1;
    (entry.removedBoxes || []).forEach(box => {
        let restoredBoxId = box.id;
        if (usedBoxIds.has(restoredBoxId)) {
            while (usedBoxIds.has(nextBoxId)) nextBoxId++;
            restoredBoxId = nextBoxId++;
        }
        usedBoxIds.add(restoredBoxId);
        app.diagram.boxes.push({ ...box, id: restoredBoxId, laneId: restoredLaneId });
    });
    app.diagram.nextBoxId = Math.max(app.diagram.nextBoxId || 1, nextBoxId);
    entry.currentLaneId = restoredLaneId;
    return true;
}

function reapplyLaneDeleteEntry(entry) {
    if (!entry || entry.type !== 'lane-delete') return false;
    const laneId = parseInt(entry.currentLaneId, 10);
    if (!Number.isInteger(laneId)) return false;
    const freshEntry = captureLaneDeleteEntry(laneId);
    if (!freshEntry) return false;

    entry.laneSnapshot = freshEntry.laneSnapshot;
    entry.removedBoxes = freshEntry.removedBoxes;
    entry.laneIndex = freshEntry.laneIndex;
    entry.currentLaneId = freshEntry.currentLaneId;
    return true;
}

function undoLaneDeletion() {
    const entry = laneHistory.undoStack.pop();
    if (!entry) {
        updateUndoRedoButtons();
        return;
    }

    if (!restoreLaneDeleteEntry(entry)) {
        laneHistory.undoStack.push(entry);
        updateUndoRedoButtons();
        return;
    }

    pendingLaneDeleteId = null;
    Compression.invalidate();
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentCanvasOverlay();
    Minimap.render();
    updateTotalDuration();
    autoSave();

    laneHistory.redoStack.push(entry);
    updateUndoRedoButtons();
}

function redoLaneDeletion() {
    const entry = laneHistory.redoStack.pop();
    if (!entry) {
        updateUndoRedoButtons();
        return;
    }

    if (!reapplyLaneDeleteEntry(entry)) {
        laneHistory.redoStack.push(entry);
        updateUndoRedoButtons();
        return;
    }

    pendingLaneDeleteId = null;
    Compression.invalidate();
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentCanvasOverlay();
    Minimap.render();
    if (app.diagram.lanes.length === 0) {
        resetCompressionView({ rerender: true, persist: false });
    }
    updateTotalDuration();
    autoSave();

    laneHistory.undoStack.push(entry);
    updateUndoRedoButtons();
}

function clearPendingLaneDelete(options = {}) {
    const { rerender = true } = options;
    if (!pendingLaneDeleteId) return;
    pendingLaneDeleteId = null;
    if (rerender) renderLaneList();
}

function getLaneDeleteMessage(laneId) {
    const lane = app.diagram.lanes.find(l => l.id === parseInt(laneId, 10));
    if (!lane) return '"Lane" will be removed.';
    const boxCount = app.diagram.getBoxesForLane(lane.id).length;
    return `"${lane.name || 'Lane'}"${boxCount > 0 ? ` and its ${boxCount} box${boxCount > 1 ? 'es' : ''}` : ''} will be removed.`;
}

function requestLaneDelete(laneId) {
    const resolvedLaneId = parseInt(laneId, 10);
    if (!Number.isInteger(resolvedLaneId)) return;
    if (!app.diagram.lanes.some(l => l.id === resolvedLaneId)) return;
    pendingLaneDeleteId = null;
    deleteLaneWithUndo(resolvedLaneId);
}

function confirmLaneDelete(laneId) {
    requestLaneDelete(laneId);
}

function deleteLaneWithUndo(laneId) {
    const entry = captureLaneDeleteEntry(laneId);
    if (!entry) return;

    pushLaneHistoryEntry(entry);
    Compression.invalidate();
    renderLaneList();
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentCanvasOverlay();
    Minimap.render();
    if (app.diagram.lanes.length === 0) {
        resetCompressionView({ rerender: true, persist: false });
    }
    updateTotalDuration();
    autoSave();
    flashUndoButton();
}

function syncSelectedLaneUI() {
    const selectedLaneId = parseInt(app.selectedLaneId, 10);
    const hasSelectedLane = Number.isInteger(selectedLaneId);

    document.querySelectorAll('.lane-item').forEach(item => {
        const laneId = parseInt(item.dataset.laneId, 10);
        item.classList.toggle('is-selected', hasSelectedLane && laneId === selectedLaneId);
    });

    document.querySelectorAll('.lane-row').forEach(row => {
        const laneId = parseInt(row.dataset.laneId, 10);
        const isSelected = hasSelectedLane && laneId === selectedLaneId;
        row.classList.toggle('is-selected', isSelected);
        const label = row.querySelector('.lane-label');
        if (label) label.classList.toggle('is-selected', isSelected);
    });
}

function clearSelectedLaneSelection() {
    if (app.selectedLaneId === null || typeof app.selectedLaneId === 'undefined') return;
    app.selectedLaneId = null;
    syncSelectedLaneUI();
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
        if (parseInt(app.selectedLaneId, 10) === lane.id) item.classList.add('is-selected');
        item.dataset.laneId = lane.id;
        item.draggable = true;

        const laneColorStyle = lane.baseColor ? `background-color: ${lane.baseColor}` : `background-color: ${PALETTE[index % PALETTE.length]}`;

        // V2: Use div.lane-name-div instead of input
        item.innerHTML = `
            <span class="lane-drag-handle" title="Drag to reorder">⋮⋮</span>
            <button class="lane-color-btn" data-lane-id="${lane.id}" title="Change lane color" style="${laneColorStyle}"></button>
            <div class="lane-name-div" data-lane-id="${lane.id}">${escapeHtml(lane.name).replace(/\n/g, '<br>')}</div>
        `;

        // Add click listener to open properties on the item (excluding controls)
        item.addEventListener('click', (e) => {
            if (e.target.closest('.inline-delete-overlay')) return;
            if (e.target.closest('.lane-color-btn')) return;
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
    syncSelectedLaneUI();
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
            const targetIndex = app.diagram.lanes.findIndex(l => l.id === targetLaneId);

            if (draggedIndex === -1 || targetIndex === -1) return;

            const rect = item.getBoundingClientRect();
            const insertAfter = e.clientY > rect.top + rect.height / 2;
            let insertionIndex = insertAfter ? targetIndex + 1 : targetIndex;

            // Removing the dragged lane shifts insertion index when moving downward.
            if (draggedIndex < insertionIndex) {
                insertionIndex--;
            }

            // No-op drops should not trigger re-render/save.
            if (insertionIndex === draggedIndex) return;

            const [draggedLane] = app.diagram.lanes.splice(draggedIndex, 1);
            app.diagram.lanes.splice(insertionIndex, 0, draggedLane);

            // Update order
            app.diagram.lanes.forEach((l, i) => {
                l.order = i;
            });

            renderLaneList();
            renderLanesCanvas();
            autoSave();
        });
    });
}

function renderTimelineRuler() {
    const ruler = app.elements.timelineRuler;

    ruler.innerHTML = '';

    const endTime = getDisplayTimelineEndTimeMs();
    const interval = getAdaptiveRulerInterval(endTime);

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
        for (let tickIndex = 0, compressedTime = 0; compressedTime <= endTime + (interval * 0.0001); tickIndex++, compressedTime = tickIndex * interval) {
            // Convert compressed position to actual time for the label
            const actualTime = Compression.compressedToActual(compressedTime);

            const mark = document.createElement('div');
            mark.className = 'ruler-mark' + (isMajorRulerTickMs(actualTime, interval) ? ' major' : '');
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
        for (let tickIndex = 0, time = 0; time <= endTime + (interval * 0.0001); tickIndex++, time = tickIndex * interval) {
            const mark = document.createElement('div');
            mark.className = 'ruler-mark' + (isMajorRulerTickMs(time, interval) ? ' major' : '');
            mark.style.left = `${msToPixels(time)}px`;
            mark.innerHTML = `<span>${formatDuration(time)}</span>`;
            innerWrapper.appendChild(mark);
        }
    }
}

function renderLanesCanvas() {
    const canvas = app.elements.lanesCanvas;

    // Remove lane-row children but preserve the SVG overlay element
    Array.from(canvas.children).forEach(child => {
        if (child.id !== 'alignment-canvas-overlay') {
            canvas.removeChild(child);
        }
    });

    // STRICT DURATION LOGIC
    // User wants: Duration value MUST affect design area first.
    // But also "Prevent design area from being decreased below end-time of last box"

    const minTrackWidth = msToPixels(getDisplayTimelineEndTimeMs());

    app.diagram.lanes.forEach(lane => {
        const row = document.createElement('div');
        row.className = 'lane-row';
        if (parseInt(app.selectedLaneId, 10) === lane.id) row.classList.add('is-selected');
        row.dataset.laneId = lane.id;
        // Min-width for scrolling - considering sticky label
        // Note: If labels are hidden, --lane-label-width is 0px
        row.style.minWidth = `calc(var(--lane-label-width) + ${minTrackWidth}px)`;

        const label = document.createElement('div');
        label.className = 'lane-label';
        if (parseInt(app.selectedLaneId, 10) === lane.id) label.classList.add('is-selected');
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
    renderAlignmentCanvasOverlay();
    renderTimeMarkers();
    Minimap.render();
    syncSelectedLaneUI();

    if (app.isMeasuring || app.measurements.length > 0 || app.measurePinned) {
        updateMeasurementDisplay();
    }

    syncZoomFitIndicator();
}

function createBoxElement(box) {
    const el = document.createElement('div');
    el.className = 'timeline-box' + (box.id === app.selectedBoxId ? ' selected' : '');
    el.dataset.boxId = box.id;

    const rendered = getRenderedBoxEdges(box);
    const left = rendered.leftPx;
    const width = rendered.widthPx;

    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
    el.style.backgroundColor = box.color;
    el.style.color = getContrastColor(box.color);
    if (rendered.isVisuallyExpanded) {
        el.classList.add('is-min-width-expanded');
    } else {
        el.classList.remove('is-min-width-expanded');
    }

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
    const expandedHint = isBoxVisuallyExpanded(box.duration)
        ? `
        <div class="tooltip-row">
            <span class="label">Display:</span>
            <span class="value">Expanded to minimum width</span>
        </div>
    `
        : '';

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
        ${expandedHint}
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

function getUiTooltipText(target) {
    if (!target) return '';
    const raw = target.getAttribute('data-tooltip')
        || target.getAttribute('title')
        || '';
    return raw.replace(/\s+/g, ' ').trim();
}

function primeUiTooltipTarget(target) {
    if (!target || typeof target.getAttribute !== 'function') return '';
    const nativeTitle = target.getAttribute('title');
    if (nativeTitle && !target.getAttribute('data-tooltip')) {
        target.setAttribute('data-tooltip', nativeTitle);
    }
    if (nativeTitle) {
        target.removeAttribute('title');
    }
    return getUiTooltipText(target);
}

function normalizeNativeTitleTooltips(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('[title]').forEach((node) => {
        if (node.closest('#box-tooltip') || node.closest('#app-tooltip')) return;
        primeUiTooltipTarget(node);
    });
}

function getUiTooltipTargetFromNode(node) {
    if (!(node instanceof Element)) return null;
    const target = node.closest('[data-tooltip], [title]');
    if (!target) return null;
    if (target.closest('#box-tooltip') || target.closest('#app-tooltip')) return null;
    const text = primeUiTooltipTarget(target);
    return text ? target : null;
}

function clearUiTooltipShowTimer() {
    if (app.uiTooltipShowTimer) {
        clearTimeout(app.uiTooltipShowTimer);
        app.uiTooltipShowTimer = null;
    }
    app.pendingUiTooltipTarget = null;
}

function positionUiTooltip(target, tooltipEl) {
    if (!target || !tooltipEl) return;
    const offsetX = 8;
    const offsetY = 7;
    const edgePadding = 6;
    const rect = target.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();

    let x = rect.right + offsetX;
    let y = rect.bottom + offsetY;

    if ((x + tipRect.width) > (window.innerWidth - edgePadding)) {
        x = rect.left - tipRect.width - offsetX;
    }
    if ((y + tipRect.height) > (window.innerHeight - edgePadding)) {
        y = rect.top - tipRect.height - offsetY;
    }

    x = Math.max(edgePadding, Math.min(window.innerWidth - tipRect.width - edgePadding, x));
    y = Math.max(edgePadding, Math.min(window.innerHeight - tipRect.height - edgePadding, y));

    tooltipEl.classList.remove('below');
    tooltipEl.style.left = `${Math.round(x)}px`;
    tooltipEl.style.top = `${Math.round(y)}px`;
}

function showUiTooltip(target) {
    const tooltipEl = app.elements.uiTooltip;
    if (!tooltipEl) return;
    if (app.designerHintsVisible) {
        hideUiTooltip();
        return;
    }

    clearUiTooltipShowTimer();
    const text = primeUiTooltipTarget(target);
    if (!text) {
        hideUiTooltip();
        return;
    }

    tooltipEl.textContent = text;
    tooltipEl.classList.add('visible');
    positionUiTooltip(target, tooltipEl);
    app.activeUiTooltipTarget = target;
}

function scheduleUiTooltip(target, { immediate = false } = {}) {
    if (!target) return;
    clearUiTooltipShowTimer();
    if (immediate) {
        showUiTooltip(target);
        return;
    }
    app.pendingUiTooltipTarget = target;
    app.uiTooltipShowTimer = setTimeout(() => {
        const pendingTarget = app.pendingUiTooltipTarget;
        clearUiTooltipShowTimer();
        if (pendingTarget && pendingTarget.isConnected) {
            showUiTooltip(pendingTarget);
        }
    }, REGULAR_TOOLTIP_DELAY_MS);
}

function hideUiTooltip() {
    clearUiTooltipShowTimer();
    const tooltipEl = app.elements.uiTooltip;
    if (!tooltipEl) return;
    tooltipEl.classList.remove('visible', 'below');
    app.activeUiTooltipTarget = null;
}

function initRegularTooltips() {
    document.addEventListener('mouseover', (e) => {
        const target = getUiTooltipTargetFromNode(e.target);
        if (!target) return;
        if (target !== app.activeUiTooltipTarget) {
            scheduleUiTooltip(target);
        } else {
            positionUiTooltip(target, app.elements.uiTooltip);
        }
    }, true);

    document.addEventListener('mouseout', (e) => {
        const tooltipTarget = getUiTooltipTargetFromNode(e.target);
        if (!tooltipTarget) return;
        const related = e.relatedTarget;
        if (related instanceof Element && tooltipTarget.contains(related)) return;
        if (app.pendingUiTooltipTarget === tooltipTarget || app.activeUiTooltipTarget === tooltipTarget) {
            hideUiTooltip();
        }
    }, true);

    document.addEventListener('focusin', (e) => {
        const target = getUiTooltipTargetFromNode(e.target);
        if (target) scheduleUiTooltip(target, { immediate: true });
    });

    document.addEventListener('focusout', (e) => {
        if (!app.activeUiTooltipTarget) return;
        const activeTarget = app.activeUiTooltipTarget;
        if (e.target === activeTarget || (e.target instanceof Element && activeTarget.contains(e.target))) {
            hideUiTooltip();
        }
    });

    document.addEventListener('scroll', () => {
        if (app.activeUiTooltipTarget && app.elements.uiTooltip?.classList.contains('visible')) {
            positionUiTooltip(app.activeUiTooltipTarget, app.elements.uiTooltip);
        }
    }, true);
}

function getToolbarHintText(element) {
    if (!element) return '';
    const raw = element.getAttribute('data-hint')
        || element.getAttribute('title')
        || element.getAttribute('aria-label')
        || element.textContent
        || '';
    return raw.replace(/\s+/g, ' ').trim();
}

function collectToolbarHintTargets() {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return [];

    const hintNodes = Array.from(toolbar.querySelectorAll('.toolbar-btn, .toolbar-toggle-btn'));
    return hintNodes
        .filter((node) => {
            if (!node.isConnected) return false;
            if (node.closest('.toolbar-threshold-panel')) return false;
            if (node.closest('.hidden')) return false;
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = node.getBoundingClientRect();
            if (rect.width < 8 || rect.height < 8) return false;
            return !!getToolbarHintText(node);
        })
        .map((node) => {
            return {
                node,
                text: getToolbarHintText(node)
            };
        });
}

function ensureDesignerHintsLayer() {
    if (app.elements.designerHintsLayer && app.elements.designerHintsLayer.isConnected) {
        return app.elements.designerHintsLayer;
    }
    const layer = document.createElement('div');
    layer.id = 'designer-hints-layer';
    layer.className = 'designer-hints-layer';
    document.body.appendChild(layer);
    app.elements.designerHintsLayer = layer;
    return layer;
}

function clearDesignerHintTargetHighlight() {
    document.querySelectorAll('.designer-hint-target-active').forEach((node) => {
        node.classList.remove('designer-hint-target-active');
    });
}

function handleDesignerHintTargetPointer(event) {
    if (!app.designerHintsVisible) return;
    const targetNode = event.currentTarget;
    const nextIndex = app.designerHintTargets.findIndex((target) => target.node === targetNode);
    if (nextIndex >= 0) {
        app.designerHintIndex = nextIndex;
        renderDesignerHints();
    }
}

function refreshDesignerHintTargets({ preserveCurrent = true } = {}) {
    normalizeNativeTitleTooltips(document.body);

    const previousNode = preserveCurrent && app.designerHintIndex >= 0
        ? app.designerHintTargets[app.designerHintIndex]?.node
        : null;

    (app.designerHintTargets || []).forEach((target) => {
        if (!target?.node) return;
        target.node.removeEventListener('mouseenter', handleDesignerHintTargetPointer);
        target.node.removeEventListener('focus', handleDesignerHintTargetPointer);
    });
    clearDesignerHintTargetHighlight();

    app.designerHintTargets = collectToolbarHintTargets();
    app.designerHintTargets.forEach((target) => {
        target.node.addEventListener('mouseenter', handleDesignerHintTargetPointer);
        target.node.addEventListener('focus', handleDesignerHintTargetPointer);
    });

    if (!app.designerHintTargets.length) {
        app.designerHintIndex = -1;
        return;
    }

    const preservedIndex = previousNode
        ? app.designerHintTargets.findIndex((target) => target.node === previousNode)
        : -1;
    if (preservedIndex >= 0) {
        app.designerHintIndex = preservedIndex;
        return;
    }

    const clampedPrevious = Number.isFinite(app.designerHintIndex)
        ? Math.max(0, Math.min(app.designerHintTargets.length - 1, app.designerHintIndex))
        : 0;
    app.designerHintIndex = clampedPrevious;
}

function setActiveDesignerHintIndex(nextIndex) {
    const total = app.designerHintTargets.length;
    if (!total) {
        app.designerHintIndex = -1;
        renderDesignerHints();
        return;
    }
    const numericIndex = Number(nextIndex);
    if (!Number.isFinite(numericIndex)) return;
    const wrappedIndex = ((Math.round(numericIndex) % total) + total) % total;
    app.designerHintIndex = wrappedIndex;
    renderDesignerHints();
}

function cycleDesignerHints(direction = 1) {
    const total = app.designerHintTargets.length;
    if (!total) return;
    const current = Number.isFinite(app.designerHintIndex) ? app.designerHintIndex : 0;
    setActiveDesignerHintIndex(current + (direction >= 0 ? 1 : -1));
}

function showDesignerHintsGuidanceToast() {
    showToast({
        type: 'info',
        title: 'Help Mode',
        message: 'Hover toolbar buttons or use \u2190/\u2192 to navigate. Press H or Esc to exit.',
        duration: 4500,
        toastKey: DESIGNER_HINT_TOAST_KEY,
        replaceExisting: true
    });
}

function hideDesignerHintsGuidanceToast() {
    const toast = activeToastByKey.get(DESIGNER_HINT_TOAST_KEY);
    if (toast && toast.isConnected) {
        hideToast(toast, { reason: 'dismiss' });
    }
}

function renderDesignerHints() {
    if (!app.designerHintsVisible) return;

    const layer = ensureDesignerHintsLayer();
    layer.innerHTML = '';
    clearDesignerHintTargetHighlight();

    const total = app.designerHintTargets.length;
    if (!total || app.designerHintIndex < 0 || app.designerHintIndex >= total) {
        layer.classList.remove('active');
        return;
    }

    const target = app.designerHintTargets[app.designerHintIndex];
    if (!target || !target.node || !target.node.isConnected) {
        layer.classList.remove('active');
        return;
    }
    target.node.classList.add('designer-hint-target-active');

    const hint = document.createElement('div');
    hint.className = 'designer-hint-chip';

    const indexChip = document.createElement('span');
    indexChip.className = 'designer-hint-step';
    indexChip.textContent = `${app.designerHintIndex + 1}/${total}`;
    hint.appendChild(indexChip);

    const textChip = document.createElement('span');
    textChip.className = 'designer-hint-text';
    textChip.textContent = target.text;
    hint.appendChild(textChip);

    layer.appendChild(hint);
    layer.classList.add('active');

    const rect = target.node.getBoundingClientRect();
    const hintRect = hint.getBoundingClientRect();
    const edgePadding = 6;
    const offsetX = 10;
    const offsetY = 7;
    let x = rect.right + offsetX;
    let y = rect.bottom + offsetY;

    if ((x + hintRect.width) > (window.innerWidth - edgePadding)) {
        x = rect.left - hintRect.width - offsetX;
    }
    if ((y + hintRect.height) > (window.innerHeight - edgePadding)) {
        y = rect.top - hintRect.height - offsetY;
    }

    x = Math.max(edgePadding, Math.min(window.innerWidth - hintRect.width - edgePadding, x));
    y = Math.max(edgePadding, Math.min(window.innerHeight - hintRect.height - edgePadding, y));

    hint.style.left = `${Math.round(x)}px`;
    hint.style.top = `${Math.round(y)}px`;
}

function scheduleDesignerHintsRender({ refreshTargets = true } = {}) {
    if (!app.designerHintsVisible) return;
    if (app.designerHintsRaf) {
        cancelAnimationFrame(app.designerHintsRaf);
        app.designerHintsRaf = null;
    }
    app.designerHintsRaf = requestAnimationFrame(() => {
        app.designerHintsRaf = null;
        if (refreshTargets) {
            refreshDesignerHintTargets({ preserveCurrent: true });
        }
        renderDesignerHints();
    });
}

function toggleDesignerHints(forceVisible = null) {
    const shouldShow = typeof forceVisible === 'boolean'
        ? forceVisible
        : !app.designerHintsVisible;
    if (shouldShow === app.designerHintsVisible) return;
    app.designerHintsVisible = shouldShow;
    document.body.classList.toggle('designer-hints-active', shouldShow);
    if (shouldShow) {
        normalizeNativeTitleTooltips(document.body);
        hideUiTooltip();
        refreshDesignerHintTargets({ preserveCurrent: false });
        showDesignerHintsGuidanceToast();
        scheduleDesignerHintsRender({ refreshTargets: false });
        return;
    }
    if (app.designerHintsRaf) {
        cancelAnimationFrame(app.designerHintsRaf);
        app.designerHintsRaf = null;
    }
    hideDesignerHintsGuidanceToast();
    (app.designerHintTargets || []).forEach((target) => {
        if (!target?.node) return;
        target.node.removeEventListener('mouseenter', handleDesignerHintTargetPointer);
        target.node.removeEventListener('focus', handleDesignerHintTargetPointer);
    });
    clearDesignerHintTargetHighlight();
    app.designerHintTargets = [];
    app.designerHintIndex = -1;
    const layer = app.elements.designerHintsLayer || document.getElementById('designer-hints-layer');
    if (layer) {
        layer.classList.remove('active');
        layer.innerHTML = '';
    }
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
    app.elements.boxStart.value = formatMsForInput(box.startOffset);
    app.elements.boxDuration.value = formatMsForInput(box.duration);

    // Show end time (start + duration)
    if (app.elements.boxEnd) {
        app.elements.boxEnd.value = formatMsForInput(box.startOffset + box.duration);
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

    const endTime = getDisplayTimelineEndTimeMs();
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
        const edges = getRenderedBoxEdges(box);
        // Actual times for labels
        const actualStart = box.startOffset;
        const actualEnd = box.startOffset + box.duration;

        markers.push({
            visualX: edges.leftPx,         // For positioning
            actualTime: actualStart,       // For label
            type: 'start',
            boxId: box.id,
            color: box.color,
            label: formatDuration(actualStart)
        });
        markers.push({
            visualX: edges.rightPx,        // For positioning
            actualTime: actualEnd,         // For label
            type: 'end',
            boxId: box.id,
            color: box.color,
            label: formatDuration(actualEnd)
        });
    });

    // Sort by visual position for proper layout
    markers.sort((a, b) => a.visualX - b.visualX);

    // Layout Logic: Horizontal text with vertical stacking for collisions
    const levels = [];
    const charWidth = 7;
    const padding = 10;

    markers.forEach(m => {
        const x = m.visualX;
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
        const x = m.visualX;

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
    if (app.selectedLaneId !== null) {
        app.selectedLaneId = null;
        syncSelectedLaneUI();
    }

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
    syncSelectedLaneUI();
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
    app.isActivelyDraggingOrResizing = true;
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
    app.isActivelyDraggingOrResizing = true;
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

        const subUnitPrecision = isSubUnitPrecisionActive(e);
        box.startOffset = Math.max(0, snapMsToUnitStep(newStart, { subUnitPrecision }));

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
        renderAlignmentCanvasOverlay();
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

        const subUnitPrecision = isSubUnitPrecisionActive(e);
        const boxStepMs = Math.max(MIN_BOX_DURATION_MS, getSnapStepMs({ subUnitPrecision }));
        if (app.dragData.side === 'right') {
            const snappedEnd = snapMsToUnitStep(mouseMs, { subUnitPrecision });
            const minEnd = box.startOffset + boxStepMs;
            const finalEnd = Math.max(minEnd, snappedEnd);
            box.duration = Math.max(boxStepMs, finalEnd - box.startOffset);
        } else {
            const endOffset = app.dragData.originalStart + app.dragData.originalDuration;
            const minDurationForThisBox = Math.min(boxStepMs, Math.max(MIN_BOX_DURATION_MS, endOffset));
            const snappedStart = snapMsToUnitStep(mouseMs, { subUnitPrecision });
            const maxStart = endOffset - minDurationForThisBox;
            const newStart = Math.max(0, Math.min(snappedStart, maxStart));
            box.startOffset = newStart;
            box.duration = Math.max(minDurationForThisBox, endOffset - box.startOffset);
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
        renderAlignmentCanvasOverlay();

        updatePropertiesPanel();
    }
}

function handleMouseUp(e) {
    if (!app.isDragging || !app.dragData) return;
    const dragType = app.dragData.type;
    const didMove = !!app.dragData.didMove;

    if (dragType === 'create') {
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

            const subUnitPrecision = isSubUnitPrecisionActive(e);
            const boxStepMs = Math.max(MIN_BOX_DURATION_MS, getSnapStepMs({ subUnitPrecision }));
            let startOffset = Math.max(0, snapMsToUnitStep(actualStartMs, { subUnitPrecision }));
            let endOffset = Math.max(startOffset + boxStepMs, snapMsToUnitStep(actualEndMs, { subUnitPrecision }));
            if (endOffset <= startOffset) {
                endOffset = startOffset + boxStepMs;
            }
            const duration = Math.max(endOffset - startOffset, boxStepMs);

            const box = app.diagram.addBox(
                app.dragData.laneId,
                startOffset,
                duration,
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
    } else if (dragType === 'move' || dragType === 'resize') {
        // Only finalize drag visuals when there was real movement.
        // This prevents compression-mode re-renders from swallowing a simple click.
        if (didMove) {
            // Recalculate compression gaps after moving/resizing
            if (Compression.enabled) {
                Compression.invalidate();
                renderTimelineRuler();
                renderLanesCanvas();
            } else {
                renderTimelineRuler();
            }
            // Always finalize marker and minimap positions after drag/resize.
            renderTimeMarkers();
            Minimap.render();
            renderAlignmentCanvasOverlay();
            updateTotalDuration();

            // After drag/resize: only update properties values if sidebar already shows box props.
            // Do NOT auto-open the sidebar — that should only happen on deliberate click.
            if (V2 && V2.isV2) {
                if (V2.currentMode === 'box' && app.selectedBoxId) {
                    // Sidebar already open in box mode — just refresh values
                    const box = app.diagram.boxes.find(b => b.id === app.selectedBoxId);
                    if (box) {
                        app.elements.boxLabel.value = box.label;
                        app.elements.boxColor.value = box.color;
                        app.elements.boxStart.value = formatMsForInput(box.startOffset);
                        app.elements.boxDuration.value = formatMsForInput(box.duration);
                        if (app.elements.boxEnd) app.elements.boxEnd.value = formatMsForInput(box.startOffset + box.duration);
                        const baseTime = parseTime(app.diagram.startTime);
                        app.elements.boxTimeStart.textContent = formatTime(baseTime + box.startOffset);
                        app.elements.boxTimeEnd.textContent = formatTime(baseTime + box.startOffset + box.duration);
                    }
                }
            } else {
                updatePropertiesPanel();
            }
        } else {
            // No movement: keep DOM stable and let the click handler open properties.
            if (typeof renderAlignmentCanvasOverlay === 'function') {
                renderAlignmentCanvasOverlay();
            }
        }
    }

    // Preserve didMove flag for the click handler (fires after mouseup)
    app.lastDragDidMove = didMove;
    app.isDragging = false;
    app.isActivelyDraggingOrResizing = false;
    app.dragData = null;
}

// =====================================================
// Measurement Tool
// =====================================================
const SNAP_THRESHOLD = 8; // pixels
const MEASUREMENT_COLORS = ['#39FF14', '#FF2D55', '#00D2FF', '#FFB020', '#8B5CF6', '#00E676', '#FF6B00', '#FFD60A'];
const MIN_MEASUREMENT_DISTANCE_PX = 2;

function getLaneLabelWidthPx() {
    const sourceEl = app?.elements?.lanesCanvas || document.body || document.documentElement;
    const raw = getComputedStyle(sourceEl).getPropertyValue('--lane-label-width');
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 160;
}

function getLaneLabelWidthForExportPx() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--lane-label-width');
    const parsed = parseFloat(raw);
    // Exports must keep lane headers visible even when UI labels are hidden.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 160;
}

function visualMsToActualMs(visualMs) {
    const safeVisualMs = Math.max(0, visualMs);
    return Compression.enabled ? Compression.compressedToActual(safeVisualMs) : safeVisualMs;
}

function cloneMeasurementPoint(point) {
    if (!point) return null;
    return {
        x: point.x,
        y: point.y,
        clientX: point.clientX,
        clientY: point.clientY,
        snapped: !!point.snapped,
        snapTimeMs: Number.isFinite(point.snapTimeMs) ? point.snapTimeMs : null
    };
}

function getNextMeasurementColor() {
    const color = MEASUREMENT_COLORS[app.measureSequence % MEASUREMENT_COLORS.length];
    app.measureSequence += 1;
    return color;
}

function sanitizeMeasurementColor(color, fallback = MEASUREMENT_COLORS[0]) {
    const normalized = String(color || '').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized) ? normalized : fallback;
}

function hexToRgbTuple(hexColor) {
    const hex = sanitizeMeasurementColor(hexColor).replace('#', '');
    const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;

    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16)
    };
}

function rgbTupleToHex({ r, g, b }) {
    const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
    const toHex = (n) => clamp(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function srgbToLinear(channel) {
    const s = channel / 255;
    return s <= 0.03928 ? (s / 12.92) : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hexColor) {
    const rgb = hexToRgbTuple(hexColor);
    if (!rgb) return 0;
    const r = srgbToLinear(rgb.r);
    const g = srgbToLinear(rgb.g);
    const b = srgbToLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(l1, l2) {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

function darkenHexColor(hexColor, factor = 0.86) {
    const rgb = hexToRgbTuple(hexColor);
    if (!rgb) return sanitizeMeasurementColor(hexColor);
    return rgbTupleToHex({
        r: rgb.r * factor,
        g: rgb.g * factor,
        b: rgb.b * factor
    });
}

function getReadableMeasureColor(hexColor, minContrast = 4.5) {
    const base = sanitizeMeasurementColor(hexColor);
    if (!document.body.classList.contains('light-theme')) return base;

    let adjusted = base;
    let steps = 0;
    while (contrastRatio(relativeLuminance(adjusted), 1) < minContrast && steps < 10) {
        adjusted = darkenHexColor(adjusted, 0.86);
        steps += 1;
    }
    return adjusted;
}

function createMeasurementEntry(startPoint, endPoint, color) {
    return {
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        color: sanitizeMeasurementColor(color),
        start: cloneMeasurementPoint(startPoint),
        end: cloneMeasurementPoint(endPoint)
    };
}

function normalizeMeasurementPoint(point) {
    if (!point || typeof point !== 'object') return null;

    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return {
        x,
        y,
        clientX: Number.isFinite(point.clientX) ? Number(point.clientX) : null,
        clientY: Number.isFinite(point.clientY) ? Number(point.clientY) : null,
        snapped: !!point.snapped,
        snapTimeMs: Number.isFinite(point.snapTimeMs) ? Number(point.snapTimeMs) : null
    };
}

function normalizeMeasurementEntry(entry, fallbackColor) {
    if (!entry || typeof entry !== 'object') return null;
    const start = normalizeMeasurementPoint(entry.start);
    const end = normalizeMeasurementPoint(entry.end);
    if (!start || !end) return null;

    return {
        id: (typeof entry.id === 'string' && entry.id.trim()) ? entry.id : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        color: sanitizeMeasurementColor(entry.color, fallbackColor),
        start,
        end
    };
}

function getMeasurementStateForPersistence() {
    const persistedMeasurements = (app.measurements || [])
        .map((entry, index) => normalizeMeasurementEntry(entry, MEASUREMENT_COLORS[index % MEASUREMENT_COLORS.length]))
        .filter(Boolean);

    return {
        toolActive: !!app.measureToolActive,
        pinned: !!app.measurePinned,
        start: normalizeMeasurementPoint(app.measureStart),
        end: normalizeMeasurementPoint(app.measureEnd),
        measurements: persistedMeasurements,
        sequence: Math.max(0, parseInt(app.measureSequence, 10) || 0),
        currentColor: sanitizeMeasurementColor(app.measureCurrentColor, MEASUREMENT_COLORS[0]),
        panelPosition: app.measurePanelPosition && Number.isFinite(app.measurePanelPosition.x) && Number.isFinite(app.measurePanelPosition.y)
            ? { x: Number(app.measurePanelPosition.x), y: Number(app.measurePanelPosition.y) }
            : null
    };
}

function computeMeasurementMetrics(measurement) {
    if (!measurement || !measurement.start || !measurement.end) return null;

    const laneLabelWidth = getLaneLabelWidthPx();
    const leftPoint = measurement.start.x <= measurement.end.x ? measurement.start : measurement.end;
    const rightPoint = leftPoint === measurement.start ? measurement.end : measurement.start;

    const leftVisualMs = pixelsToMs(leftPoint.x - laneLabelWidth);
    const rightVisualMs = pixelsToMs(rightPoint.x - laneLabelWidth);

    const actualStartMs = Number.isFinite(leftPoint.snapTimeMs)
        ? leftPoint.snapTimeMs
        : visualMsToActualMs(leftVisualMs);
    const actualEndMs = Number.isFinite(rightPoint.snapTimeMs)
        ? rightPoint.snapTimeMs
        : visualMsToActualMs(rightVisualMs);
    const actualDuration = Math.max(0, actualEndMs - actualStartMs);

    return {
        actualStartMs,
        actualEndMs,
        actualDuration,
        durationText: formatDuration(Math.round(actualDuration)),
        startText: formatDuration(Math.round(actualStartMs)),
        endText: formatDuration(Math.round(actualEndMs))
    };
}

function createSvgElement(tagName, attributes = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tagName);
    Object.entries(attributes).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            el.setAttribute(key, String(value));
        }
    });
    return el;
}

function canvasPointToOverlay(point, overlayRect) {
    const canvas = app.elements.lanesCanvas;
    if (!canvas || !point) return null;

    const canvasRect = canvas.getBoundingClientRect();
    return {
        x: canvasRect.left + point.x - canvas.scrollLeft - overlayRect.left,
        y: canvasRect.top + point.y - canvas.scrollTop - overlayRect.top
    };
}

function getMeasurementLineVector(startX, startY, endX, endY) {
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;

    return { dx, dy, length, ux, uy, px, py };
}

function getMeasurementArrowPoints(startX, startY, endX, endY, arrowLength = 8, arrowHalfWidth = 4) {
    const vector = getMeasurementLineVector(startX, startY, endX, endY);
    const baseX = endX - vector.ux * arrowLength;
    const baseY = endY - vector.uy * arrowLength;

    return {
        vector,
        leftX: baseX + vector.px * arrowHalfWidth,
        leftY: baseY + vector.py * arrowHalfWidth,
        rightX: baseX - vector.px * arrowHalfWidth,
        rightY: baseY - vector.py * arrowHalfWidth
    };
}

function renderMeasurementOverlay(activeMeasurement = null) {
    const overlay = document.getElementById('measurement-overlay');
    if (!overlay) return;

    const entries = app.measurements.slice();
    if (activeMeasurement) {
        entries.push(activeMeasurement);
    }

    overlay.innerHTML = '';
    if (entries.length === 0) return;

    const overlayRect = overlay.getBoundingClientRect();
    const isLightTheme = document.body.classList.contains('light-theme');
    const baseOpacity = isLightTheme ? 0.96 : 0.88;
    const draftOpacity = isLightTheme ? 1 : 0.95;
    const lineStrokeWidth = app.measurePinned ? (isLightTheme ? 2.2 : 2) : (isLightTheme ? 1.8 : 1.5);
    const labelBgFill = isLightTheme ? 'rgba(255, 255, 255, 0.95)' : 'rgba(5, 10, 14, 0.88)';
    const labelBgStroke = isLightTheme ? 'rgba(15, 23, 42, 0.18)' : 'none';

    entries.forEach((measurement, index) => {
        const start = canvasPointToOverlay(measurement.start, overlayRect);
        const end = canvasPointToOverlay(measurement.end, overlayRect);
        const metrics = computeMeasurementMetrics(measurement);
        if (!start || !end || !metrics) return;

        const rawColor = sanitizeMeasurementColor(measurement.color, MEASUREMENT_COLORS[index % MEASUREMENT_COLORS.length]);
        const color = getReadableMeasureColor(rawColor, 4.5);
        const opacity = activeMeasurement && measurement.id === activeMeasurement.id ? draftOpacity : baseOpacity;
        const arrow = getMeasurementArrowPoints(start.x, start.y, end.x, end.y, 8, 4);
        const vector = arrow.vector;
        const tickHalf = 5;
        const group = createSvgElement('g', { class: 'measurement-item' });

        group.appendChild(createSvgElement('line', {
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            class: 'measurement-line',
            stroke: color,
            'stroke-opacity': opacity,
            'stroke-width': lineStrokeWidth
        }));

        group.appendChild(createSvgElement('line', {
            x1: start.x,
            y1: start.y - tickHalf,
            x2: start.x,
            y2: start.y + tickHalf,
            stroke: color,
            'stroke-opacity': opacity,
            'stroke-width': 1.5
        }));

        group.appendChild(createSvgElement('line', {
            x1: end.x + vector.px * tickHalf,
            y1: end.y + vector.py * tickHalf,
            x2: end.x - vector.px * tickHalf,
            y2: end.y - vector.py * tickHalf,
            stroke: color,
            'stroke-opacity': opacity,
            'stroke-width': 1.5
        }));

        group.appendChild(createSvgElement('path', {
            d: `M${arrow.leftX},${arrow.leftY} L${end.x},${end.y} L${arrow.rightX},${arrow.rightY}`,
            fill: 'none',
            stroke: color,
            'stroke-opacity': opacity,
            'stroke-width': 1.5,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        }));

        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const labelText = metrics.durationText;
        const textWidth = labelText.length * 8 + 10;

        group.appendChild(createSvgElement('rect', {
            x: midX - (textWidth / 2),
            y: midY - 24,
            width: textWidth,
            height: 16,
            rx: 3,
            fill: labelBgFill,
            stroke: labelBgStroke,
            'stroke-width': isLightTheme ? 0.8 : 0
        }));

        const textEl = createSvgElement('text', {
            x: midX,
            y: midY - 12,
            class: 'measurement-label',
            fill: color
        });
        textEl.textContent = labelText;
        group.appendChild(textEl);

        overlay.appendChild(group);
    });
}

function applyMeasurementPanelPosition() {
    const panel = document.getElementById('measurement-info');
    if (!panel || !panel.classList.contains('active')) return;

    if (!app.measurePanelPosition) {
        app.measurePanelPosition = {
            x: Math.max(12, window.innerWidth - (panel.offsetWidth || 300) - 20),
            y: 96
        };
    }

    const min = 8;
    const maxX = Math.max(min, window.innerWidth - panel.offsetWidth - min);
    const maxY = Math.max(min, window.innerHeight - panel.offsetHeight - min);

    app.measurePanelPosition.x = Math.min(maxX, Math.max(min, app.measurePanelPosition.x));
    app.measurePanelPosition.y = Math.min(maxY, Math.max(min, app.measurePanelPosition.y));

    panel.style.left = `${Math.round(app.measurePanelPosition.x)}px`;
    panel.style.top = `${Math.round(app.measurePanelPosition.y)}px`;
}

function buildMeasurementInfoRowMarkup(metrics) {
    const startText = escapeHtml(metrics.startText);
    const durationText = escapeHtml(metrics.durationText);
    const endText = escapeHtml(metrics.endText);
    const ariaLabel = `Start ${metrics.startText}, Duration ${metrics.durationText}, End ${metrics.endText}`;

    return `
        <div class="measure-panel-values" role="img" aria-label="${escapeHtml(ariaLabel)}">
            <svg class="measure-row-lines" width="100%" height="100%" aria-hidden="true">
                <line class="measure-row-line measure-row-line-a" x1="0" y1="9" x2="0" y2="9"></line>
                <line class="measure-row-line measure-row-line-b" x1="0" y1="9" x2="0" y2="9"></line>
                <line class="measure-row-arrow measure-row-arrow-a" x1="0" y1="9" x2="0" y2="9"></line>
                <line class="measure-row-arrow measure-row-arrow-b" x1="0" y1="9" x2="0" y2="9"></line>
            </svg>
            <span class="measure-value measure-value-start" title="Start">${startText}</span>
            <span class="measure-value measure-value-duration" title="Duration">${durationText}</span>
            <span class="measure-value measure-value-end" title="End">${endText}</span>
        </div>
    `;
}

function buildMeasurementInfoColumnsSvg() {
    return `
        <div class="measure-header-values" role="img" aria-label="Start to Duration to End guide">
            <svg class="measure-header-lines" width="100%" height="100%" aria-hidden="true">
                <line class="measure-header-line measure-header-line-a" x1="0" y1="0" x2="0" y2="0"></line>
                <line class="measure-header-line measure-header-line-b" x1="0" y1="0" x2="0" y2="0"></line>
                <line class="measure-header-arrow measure-header-arrow-a" x1="0" y1="0" x2="0" y2="0"></line>
                <line class="measure-header-arrow measure-header-arrow-b" x1="0" y1="0" x2="0" y2="0"></line>
            </svg>
            <span class="measure-header-label measure-header-label-start">Start</span>
            <span class="measure-header-label measure-header-label-duration">Duration</span>
            <span class="measure-header-label measure-header-label-end">End</span>
        </div>
    `;
}

function setMeasurementSvgLine(lineEl, x1, y1, x2, y2) {
    if (!lineEl) return;
    const valid = Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)
        && Math.hypot(x2 - x1, y2 - y1) >= 1;
    if (!valid) {
        lineEl.style.display = 'none';
        return;
    }

    lineEl.style.display = '';
    lineEl.setAttribute('x1', (Math.round(x1 * 10) / 10).toString());
    lineEl.setAttribute('y1', (Math.round(y1 * 10) / 10).toString());
    lineEl.setAttribute('x2', (Math.round(x2 * 10) / 10).toString());
    lineEl.setAttribute('y2', (Math.round(y2 * 10) / 10).toString());
}

function layoutMeasurementInfoHeader() {
    const panel = document.getElementById('measurement-info');
    if (!panel) return;

    const valuesEl = panel.querySelector('.measure-header-values');
    const headerSvg = panel.querySelector('.measure-header-lines');
    const startEl = panel.querySelector('.measure-header-label-start');
    const durationEl = panel.querySelector('.measure-header-label-duration');
    const endEl = panel.querySelector('.measure-header-label-end');
    if (!valuesEl || !headerSvg || !startEl || !durationEl || !endEl) return;

    const valuesRect = valuesEl.getBoundingClientRect();
    const width = valuesRect.width;
    const height = Math.max(20, valuesEl.clientHeight || 20);
    if (width <= 0) return;

    headerSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    headerSvg.setAttribute('preserveAspectRatio', 'none');

    const toLocal = (rect) => ({
        left: rect.left - valuesRect.left,
        right: rect.right - valuesRect.left
    });

    const start = toLocal(startEl.getBoundingClientRect());
    const duration = toLocal(durationEl.getBoundingClientRect());
    const end = toLocal(endEl.getBoundingClientRect());
    const startRect = startEl.getBoundingClientRect();
    const durationRect = durationEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();

    const y = (
        (startRect.top + startRect.bottom) +
        (durationRect.top + durationRect.bottom) +
        (endRect.top + endRect.bottom)
    ) / 6 - valuesRect.top;
    const lineY = Math.max(4, Math.min(height - 2, y));
    const gap = 8;
    const arrowLen = 6;
    const arrowHalf = 3;

    const segment1Start = start.right + gap;
    const segment1End = duration.left - gap;
    const arrowTip = end.left - gap;
    const segment2Start = duration.right + gap;
    const segment2End = arrowTip - arrowLen;

    setMeasurementSvgLine(headerSvg.querySelector('.measure-header-line-a'), segment1Start, lineY, segment1End, lineY);
    setMeasurementSvgLine(headerSvg.querySelector('.measure-header-line-b'), segment2Start, lineY, segment2End, lineY);
    setMeasurementSvgLine(headerSvg.querySelector('.measure-header-arrow-a'), arrowTip - arrowLen, lineY - arrowHalf, arrowTip, lineY);
    setMeasurementSvgLine(headerSvg.querySelector('.measure-header-arrow-b'), arrowTip - arrowLen, lineY + arrowHalf, arrowTip, lineY);
}

function layoutMeasurementInfoRows() {
    const panel = document.getElementById('measurement-info');
    if (!panel || !panel.classList.contains('active')) return;

    const rows = panel.querySelectorAll('.measure-panel-row');

    rows.forEach(row => {
        const valuesEl = row.querySelector('.measure-panel-values');
        const svg = row.querySelector('.measure-row-lines');
        const startEl = row.querySelector('.measure-value-start');
        const durationEl = row.querySelector('.measure-value-duration');
        const endEl = row.querySelector('.measure-value-end');
        if (!valuesEl || !svg || !startEl || !durationEl || !endEl) return;

        const valuesRect = valuesEl.getBoundingClientRect();
        const width = valuesRect.width;
        const height = Math.max(18, valuesEl.clientHeight || 18);
        if (width <= 0) return;

        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('preserveAspectRatio', 'none');

        const toLocal = (rect) => ({
            left: rect.left - valuesRect.left,
            right: rect.right - valuesRect.left,
            center: (rect.left + rect.right) / 2 - valuesRect.left
        });

        const start = toLocal(startEl.getBoundingClientRect());
        const duration = toLocal(durationEl.getBoundingClientRect());
        const end = toLocal(endEl.getBoundingClientRect());
        const startRect = startEl.getBoundingClientRect();
        const durationRect = durationEl.getBoundingClientRect();
        const endRect = endEl.getBoundingClientRect();

        const centerY = (
            (startRect.top + startRect.bottom) +
            (durationRect.top + durationRect.bottom) +
            (endRect.top + endRect.bottom)
        ) / 6 - valuesRect.top;
        const lineY = Math.max(4, Math.min(height - 2, centerY));
        const gap = 6;
        const arrowLen = 6;
        const arrowHalf = 3;

        const segment1Start = start.right + gap;
        const segment1End = duration.left - gap;
        const arrowTip = end.left - gap;
        const segment2Start = duration.right + gap;
        const segment2End = arrowTip - arrowLen;

        setMeasurementSvgLine(row.querySelector('.measure-row-line-a'), segment1Start, lineY, segment1End, lineY);
        setMeasurementSvgLine(row.querySelector('.measure-row-line-b'), segment2Start, lineY, segment2End, lineY);
        setMeasurementSvgLine(row.querySelector('.measure-row-arrow-a'), arrowTip - arrowLen, lineY - arrowHalf, arrowTip, lineY);
        setMeasurementSvgLine(row.querySelector('.measure-row-arrow-b'), arrowTip - arrowLen, lineY + arrowHalf, arrowTip, lineY);
    });

    layoutMeasurementInfoHeader();
}

function renderMeasurementInfo(activeMeasurement = null) {
    const panel = document.getElementById('measurement-info');
    if (!panel) return;

    const entries = app.measurements.slice();
    if (activeMeasurement) {
        entries.push(activeMeasurement);
    }

    const shouldShow = entries.length > 0 && (app.measureToolActive || app.measurePinned || app.isMeasuring || app.measurements.length > 0);
    panel.classList.toggle('active', shouldShow);
    panel.classList.toggle('pinned', app.measurePinned);

    if (!shouldShow) {
        panel.innerHTML = '';
        return;
    }

    const recentEntries = entries.slice(-12).reverse();
    const rowsHtml = recentEntries.map((measurement, index) => {
        const metrics = computeMeasurementMetrics(measurement);
        if (!metrics) return '';

        const rawColor = sanitizeMeasurementColor(measurement.color, MEASUREMENT_COLORS[index % MEASUREMENT_COLORS.length]);
        const color = getReadableMeasureColor(rawColor, 4.8);
        const draftClass = activeMeasurement && measurement.id === activeMeasurement.id ? ' is-draft' : '';

        return `
            <div class="measure-panel-row${draftClass}" style="--measure-color:${color}">
                ${buildMeasurementInfoRowMarkup(metrics)}
            </div>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="measurement-info-header">
            <span class="measurement-info-title">Measures${recentEntries.length > 0 ? ` (${recentEntries.length})` : ''}</span>
            <span class="measurement-info-hint">Drag to move${activeMeasurement ? ' • drawing' : ''}</span>
        </div>
        <div class="measurement-info-columns">
            ${buildMeasurementInfoColumnsSvg()}
        </div>
        <div class="measurement-info-list">${rowsHtml}</div>
    `;

    applyMeasurementPanelPosition();
    layoutMeasurementInfoRows();
    requestAnimationFrame(() => layoutMeasurementInfoRows());
}

function startMeasurementPanelDrag(e) {
    const panel = document.getElementById('measurement-info');
    if (!panel || !panel.classList.contains('active')) return;
    if (!e.target.closest('.measurement-info-header')) return;

    const rect = panel.getBoundingClientRect();
    app.measurePanelDrag = {
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top
    };
    panel.classList.add('dragging');
    e.preventDefault();
}

function handleMeasurementPanelDrag(e) {
    if (!app.measurePanelDrag) return;
    app.measurePanelPosition = {
        x: e.clientX - app.measurePanelDrag.offsetX,
        y: e.clientY - app.measurePanelDrag.offsetY
    };
    applyMeasurementPanelPosition();
}

function stopMeasurementPanelDrag() {
    if (!app.measurePanelDrag) return;
    app.measurePanelDrag = null;
    const panel = document.getElementById('measurement-info');
    if (panel) {
        panel.classList.remove('dragging');
    }
    autoSave();
    saveSessionState();
}

function getMeasurementsForExport() {
    const entries = app.measurements.slice();
    if (app.isMeasuring && app.measureStart && app.measureEnd) {
        entries.push(createMeasurementEntry(app.measureStart, app.measureEnd, app.measureCurrentColor || MEASUREMENT_COLORS[0]));
    }
    if (entries.length > 0) {
        return entries;
    }
    if (app.measurePinned && app.measureStart && app.measureEnd) {
        return [createMeasurementEntry(app.measureStart, app.measureEnd, app.measureCurrentColor || MEASUREMENT_COLORS[0])];
    }
    return [];
}

function getMeasurementSnapPoints() {
    const canvas = app.elements.lanesCanvas;
    if (!canvas) return [];
    const canvasRect = canvas.getBoundingClientRect();
    const pointsByX = new Map();

    const addPoint = (x, actualTime) => {
        const key = Math.round(x * 1000) / 1000;
        if (!pointsByX.has(key)) {
            pointsByX.set(key, { x, actualTime });
        }
    };

    // Snap to actual rendered box edges (same geometry user sees),
    // independent from alignment overlay layer coordinates.
    canvas.querySelectorAll('.timeline-box[data-box-id]').forEach(boxEl => {
        const boxId = parseInt(boxEl.dataset.boxId, 10);
        const box = app.diagram.boxes.find(b => b.id === boxId);
        if (!box) return;

        const boxRect = boxEl.getBoundingClientRect();
        const leftX = boxRect.left - canvasRect.left + canvas.scrollLeft;
        const rightX = boxRect.right - canvasRect.left + canvas.scrollLeft;
        addPoint(leftX, box.startOffset);
        addPoint(rightX, box.startOffset + box.duration);
    });

    return Array.from(pointsByX.values()).sort((a, b) => a.x - b.x);
}

function getClosestMeasurementSnapPoint(rawX, snapPoints = getMeasurementSnapPoints()) {
    let closestPoint = null;
    let closestDist = SNAP_THRESHOLD;

    for (const point of snapPoints) {
        const dist = Math.abs(point.x - rawX);
        if (dist < closestDist) {
            closestDist = dist;
            closestPoint = point;
        }
    }

    return closestPoint;
}

function resolveMeasurementPoint(clientX, clientY, snapPoints = getMeasurementSnapPoints()) {
    const canvas = app.elements.lanesCanvas;
    const rect = canvas.getBoundingClientRect();
    const minX = getLaneLabelWidthPx();
    const rawX = Math.max(minX, clientX - rect.left + canvas.scrollLeft);
    const y = clientY - rect.top + canvas.scrollTop;
    const snapPoint = getClosestMeasurementSnapPoint(rawX, snapPoints);
    const resolvedX = snapPoint ? snapPoint.x : rawX;

    return {
        x: resolvedX,
        y,
        clientX: rect.left + resolvedX - canvas.scrollLeft,
        clientY,
        snapped: !!snapPoint,
        snapTimeMs: snapPoint ? snapPoint.actualTime : null
    };
}

function startMeasurement(e) {
    app.measureSnapPoints = getMeasurementSnapPoints();
    const resolvedPoint = resolveMeasurementPoint(e.clientX, e.clientY, app.measureSnapPoints);
    app.measureCurrentColor = getNextMeasurementColor();

    app.isMeasuring = true;
    app.measureStart = { ...resolvedPoint };
    app.measureEnd = { ...resolvedPoint };

    // Show measurement overlay
    const overlay = document.getElementById('measurement-overlay');
    if (overlay) overlay.classList.add('active');

    updateMeasurementDisplay();
    e.preventDefault();
}

function updateMeasurement(e) {
    if (!app.isMeasuring) return;

    const snapPoints = app.measureSnapPoints || getMeasurementSnapPoints();
    app.measureEnd = resolveMeasurementPoint(e.clientX, e.clientY, snapPoints);
    updateMeasurementDisplay();
}

function endMeasurement() {
    if (!app.isMeasuring) return;

    const completedMeasurement = createMeasurementEntry(app.measureStart, app.measureEnd, app.measureCurrentColor);
    const hasDistance = completedMeasurement.start && completedMeasurement.end
        && Math.abs(completedMeasurement.end.x - completedMeasurement.start.x) >= MIN_MEASUREMENT_DISTANCE_PX;

    app.isMeasuring = false;
    app.measureSnapPoints = null;

    if (hasDistance) {
        app.measurements.push(completedMeasurement);
        app.measureStart = cloneMeasurementPoint(completedMeasurement.start);
        app.measureEnd = cloneMeasurementPoint(completedMeasurement.end);
    } else {
        app.measureStart = null;
        app.measureEnd = null;
    }

    updateMeasurementDisplay();

    // Ctrl/Cmd measurement mode: auto-hide after delay unless pinned
    if (!app.measurePinned && !app.measureToolActive) {
        setTimeout(() => {
            if (!app.isMeasuring && !app.measurePinned && !app.measureToolActive) {
                app.measurements = [];
                app.measureStart = null;
                app.measureEnd = null;
                const overlay = document.getElementById('measurement-overlay');
                const infoBox = document.getElementById('measurement-info');
                if (overlay) overlay.classList.remove('active');
                if (infoBox) infoBox.classList.remove('active');
                const measureBar = document.getElementById('measurement-bar');
                if (measureBar) measureBar.classList.add('hidden');
                autoSave();
                saveSessionState();
            }
        }, 2000);
    }

    autoSave();
    saveSessionState();
}

function toggleMeasurementPin() {
    app.measurePinned = !app.measurePinned;
    const overlay = document.getElementById('measurement-overlay');
    const infoBox = document.getElementById('measurement-info');

    if (app.measurePinned) {
        if (overlay) overlay.classList.add('pinned');
        if (infoBox) infoBox.classList.add('pinned');
    } else {
        if (overlay) overlay.classList.remove('pinned');
        if (infoBox) infoBox.classList.remove('pinned');
        // Fade out after unpinning
        setTimeout(() => {
            if (!app.isMeasuring && !app.measurePinned && !app.measureToolActive) {
                app.measurements = [];
                app.measureStart = null;
                app.measureEnd = null;
                if (overlay) overlay.classList.remove('active');
                if (infoBox) infoBox.classList.remove('active');
                // Also hide toolbar bar
                const measureBar = document.getElementById('measurement-bar');
                if (measureBar) measureBar.classList.add('hidden');
                autoSave();
                saveSessionState();
            }
        }, 2000);
    }

    // Update toolbar bar pin button state
    const barPinBtn = document.getElementById('measure-bar-pin');
    if (barPinBtn) {
        barPinBtn.classList.toggle('active', app.measurePinned);
        barPinBtn.title = app.measurePinned ? 'Unpin measurement' : 'Pin measurement';
    }

    updateMeasurementDisplay();
    autoSave();
    saveSessionState();
}

function closeMeasurement() {
    app.isMeasuring = false;
    app.measurePinned = false;
    app.measureToolActive = false;
    app.measureSnapPoints = null;
    app.measureStart = null;
    app.measureEnd = null;
    app.measurements = [];
    app.measureSequence = 0;
    app.measureCurrentColor = MEASUREMENT_COLORS[0];
    app.measurePanelDrag = null;
    const overlay = document.getElementById('measurement-overlay');
    const infoBox = document.getElementById('measurement-info');
    if (overlay) overlay.classList.remove('active', 'pinned');
    if (infoBox) {
        infoBox.classList.remove('active', 'pinned', 'dragging');
        infoBox.innerHTML = '';
    }
    // Hide toolbar measurement bar
    const measureBar = document.getElementById('measurement-bar');
    if (measureBar) measureBar.classList.add('hidden');
    const barPinBtn = document.getElementById('measure-bar-pin');
    if (barPinBtn) {
        barPinBtn.classList.remove('active');
        barPinBtn.title = 'Pin measurement';
    }
    const toolBtn = document.getElementById('measure-tool-btn');
    if (toolBtn) {
        toolBtn.classList.remove('active');
        toolBtn.setAttribute('aria-pressed', 'false');
    }
    document.body.style.cursor = '';
}

function toggleMeasurementTool() {
    app.measureToolActive = !app.measureToolActive;
    const btn = document.getElementById('measure-tool-btn');

    if (app.measureToolActive) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        document.body.style.cursor = 'crosshair';
        // Show measurement bar with zero values
        const measureBar = document.getElementById('measurement-bar');
        if (measureBar) {
            measureBar.classList.remove('hidden');
            const durEl = document.getElementById('measure-bar-duration');
            const startEl = document.getElementById('measure-bar-start');
            const endEl = document.getElementById('measure-bar-end');
            if (durEl) durEl.textContent = '0ms';
            if (startEl) startEl.textContent = '0ms';
            if (endEl) endEl.textContent = '0ms';
        }
    } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
        document.body.style.cursor = '';
        closeMeasurement();
    }

    updateMeasurementDisplay();
    autoSave();
    saveSessionState();
}

function restorePinnedMeasurement() {
    // First close any existing measurement
    closeMeasurement();

    // Check if there's measurement data to restore
    if (!app.pinnedMeasurementData) return;

    const canvas = app.elements.lanesCanvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const lanesAreaHeight = app.diagram.lanes.length * getLaneHeightPx();
    const defaultY = lanesAreaHeight / 2;
    const persisted = app.pinnedMeasurementData;

    const normalizePointForCanvas = (point) => {
        const normalized = normalizeMeasurementPoint(point);
        if (!normalized || !Number.isFinite(normalized.x)) return null;
        const safeY = Number.isFinite(normalized.y) ? normalized.y : defaultY;
        return {
            x: normalized.x,
            y: safeY,
            clientX: rect.left + normalized.x - canvas.scrollLeft,
            clientY: rect.top + safeY - canvas.scrollTop,
            snapped: !!normalized.snapped,
            snapTimeMs: Number.isFinite(normalized.snapTimeMs) ? normalized.snapTimeMs : null
        };
    };

    const normalizeEntryForCanvas = (entry, fallbackColor, idx) => {
        const normalized = normalizeMeasurementEntry(entry, fallbackColor);
        if (!normalized) return null;
        const start = normalizePointForCanvas(normalized.start);
        const end = normalizePointForCanvas(normalized.end);
        if (!start || !end) return null;

        return {
            id: normalized.id || `m-restore-${Date.now()}-${idx}`,
            color: sanitizeMeasurementColor(normalized.color, fallbackColor),
            start,
            end
        };
    };

    if (persisted && typeof persisted === 'object' && (persisted.measurements || persisted.toolActive !== undefined || persisted.pinned !== undefined)) {
        const restoredMeasurements = Array.isArray(persisted.measurements)
            ? persisted.measurements
                .map((entry, idx) => normalizeEntryForCanvas(entry, MEASUREMENT_COLORS[idx % MEASUREMENT_COLORS.length], idx))
                .filter(Boolean)
            : [];

        const restoredStart = normalizePointForCanvas(persisted.start)
            || (restoredMeasurements[0] ? cloneMeasurementPoint(restoredMeasurements[restoredMeasurements.length - 1].start) : null);
        const restoredEnd = normalizePointForCanvas(persisted.end)
            || (restoredMeasurements[0] ? cloneMeasurementPoint(restoredMeasurements[restoredMeasurements.length - 1].end) : null);

        app.measurements = restoredMeasurements;
        app.measureStart = restoredStart;
        app.measureEnd = restoredEnd;
        app.measurePinned = !!persisted.pinned;
        app.measureToolActive = !!persisted.toolActive;
        app.measureSequence = Math.max(restoredMeasurements.length, parseInt(persisted.sequence, 10) || 0);
        app.measureCurrentColor = sanitizeMeasurementColor(persisted.currentColor, MEASUREMENT_COLORS[app.measureSequence % MEASUREMENT_COLORS.length]);
        app.measurePanelPosition = (persisted.panelPosition && Number.isFinite(persisted.panelPosition.x) && Number.isFinite(persisted.panelPosition.y))
            ? { x: Number(persisted.panelPosition.x), y: Number(persisted.panelPosition.y) }
            : null;
    } else {
        // Legacy format: pinned range only
        const startX = Number(persisted?.startX);
        const endX = Number(persisted?.endX);
        if (Number.isFinite(startX) && Number.isFinite(endX)) {
            const clientStartX = rect.left + startX - canvas.scrollLeft;
            const clientEndX = rect.left + endX - canvas.scrollLeft;
            const clientY = rect.top + defaultY - canvas.scrollTop;
            const restoredStart = { x: startX, y: defaultY, clientX: clientStartX, clientY: clientY, snapped: false, snapTimeMs: null };
            const restoredEnd = { x: endX, y: defaultY, clientX: clientEndX, clientY: clientY, snapped: false, snapTimeMs: null };

            app.measureStart = cloneMeasurementPoint(restoredStart);
            app.measureEnd = cloneMeasurementPoint(restoredEnd);
            app.measurements = [createMeasurementEntry(restoredStart, restoredEnd, MEASUREMENT_COLORS[0])];
            app.measurePinned = true;
            app.measureToolActive = false;
            app.measureSequence = 1;
            app.measureCurrentColor = MEASUREMENT_COLORS[1 % MEASUREMENT_COLORS.length];
            app.measurePanelPosition = null;
        }
    }

    const measureToolBtn = document.getElementById('measure-tool-btn');
    if (measureToolBtn) {
        measureToolBtn.classList.toggle('active', app.measureToolActive);
        measureToolBtn.setAttribute('aria-pressed', app.measureToolActive ? 'true' : 'false');
    }
    document.body.style.cursor = app.measureToolActive ? 'crosshair' : '';

    // Update display
    updateMeasurementDisplay();

    // Clear the stored data
    app.pinnedMeasurementData = null;
    saveSessionState();
}

function updateMeasurementDisplay() {
    const overlay = document.getElementById('measurement-overlay');
    if (!overlay) return;
    const activeMeasurement = (app.isMeasuring && app.measureStart && app.measureEnd)
        ? createMeasurementEntry(app.measureStart, app.measureEnd, app.measureCurrentColor || MEASUREMENT_COLORS[0])
        : null;
    const latestMeasurement = activeMeasurement || (app.measurements.length > 0 ? app.measurements[app.measurements.length - 1] : null);
    const latestMetrics = latestMeasurement ? computeMeasurementMetrics(latestMeasurement) : null;

    const hasRenderableMeasurements = !!activeMeasurement || app.measurements.length > 0;
    overlay.classList.toggle('active', hasRenderableMeasurements || app.measurePinned);
    overlay.classList.toggle('pinned', app.measurePinned);

    renderMeasurementOverlay(activeMeasurement);
    renderMeasurementInfo(activeMeasurement);

    // Update measurement toolbar bar
    const measureBar = document.getElementById('measurement-bar');
    if (measureBar) {
        if (latestMetrics) {
            measureBar.classList.remove('hidden');
        } else if (app.measureToolActive) {
            measureBar.classList.remove('hidden');
        } else if (!app.measureToolActive && !app.measurePinned) {
            measureBar.classList.add('hidden');
        }

        const durEl = document.getElementById('measure-bar-duration');
        const startEl = document.getElementById('measure-bar-start');
        const endEl = document.getElementById('measure-bar-end');
        const pinEl = document.getElementById('measure-bar-pin');

        if (latestMetrics) {
            if (durEl) durEl.textContent = latestMetrics.durationText;
            if (startEl) startEl.textContent = latestMetrics.startText;
            if (endEl) endEl.textContent = latestMetrics.endText;
        } else if (app.measureToolActive) {
            if (durEl) durEl.textContent = '0ms';
            if (startEl) startEl.textContent = '0ms';
            if (endEl) endEl.textContent = '0ms';
        }

        if (pinEl) {
            pinEl.classList.toggle('active', app.measurePinned);
            pinEl.title = app.measurePinned ? 'Unpin measurement' : 'Pin measurement';
        }
    }

}

function getDisplayTimelineDurationMs({ forFit = false } = {}) {
    const hasBoxes = (app?.diagram?.boxes?.length || 0) > 0;
    const totalDuration = Math.max(0, Number(app?.diagram?.getTotalDuration?.() || 0));
    const settingsDuration = Math.max(1, Number(app?.settings?.timelineDuration || 8000));
    const compressedDuration = Math.max(0, Number(Compression.getCompressedDuration() || 0));
    const fitLike = !!forFit || !!app?.fitModeActive;

    if (Compression.enabled) {
        if (hasBoxes) return Math.max(1, compressedDuration);
        return settingsDuration;
    }

    if (!hasBoxes) return settingsDuration;
    if (fitLike) return Math.max(1, totalDuration);
    return Math.max(totalDuration, settingsDuration);
}

function getDisplayTimelineEndTimeMs({ forFit = false } = {}) {
    const trailing = Math.max(0, Number(app?.settings?.trailingSpace || 0));
    return Math.max(1, getDisplayTimelineDurationMs({ forFit }) + trailing);
}

function getFitToViewScale() {
    const fitDuration = getDisplayTimelineEndTimeMs({ forFit: true });

    const laneLabelWidth = getLaneLabelWidthPx();
    const canvasWidth = app.elements.lanesCanvas.clientWidth - (laneLabelWidth + 20);
    if (canvasWidth <= 0) return null;

    const granularityMs = getRenderGranularityMs();
    const fitScale = canvasWidth / ((fitDuration / granularityMs) * 1.1);
    return Math.max(app.minPixelsPerMs, Math.min(app.maxPixelsPerMs, fitScale));
}

function isZoomAtFitScale(scale = app.pixelsPerMs) {
    const fitScale = getFitToViewScale();
    if (!fitScale) return false;
    const tolerance = Math.max(1e-6, fitScale * 0.01);
    return Math.abs(scale - fitScale) <= tolerance;
}

function isFitModeActive() {
    return !!app.fitModeActive;
}

function syncZoomFitIndicator() {
    const fitBtn = document.getElementById('zoom-fit');
    if (!fitBtn) return;

    const isActive = isFitModeActive();

    fitBtn.classList.toggle('fit-active', isActive);
    fitBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    scheduleDesignerHintsRender();
}

function handleZoom(direction) {
    const canvas = app.elements.lanesCanvas;
    const laneLabelWidth = getLaneLabelWidthPx();

    // Get current viewport center in time (ms)
    const viewportWidth = canvas.clientWidth - laneLabelWidth;
    const scrollLeft = canvas.scrollLeft;
    const centerX = scrollLeft + viewportWidth / 2;
    const centerTimeMs = pixelsToMs(centerX);

    // Apply zoom
    const factor = direction === 'in' ? 1.25 : 0.8;
    if (app.fitModeActive) {
        app.fitModeActive = false;
        app.zoomBeforeFitScale = null;
        app.zoomBeforeFitScrollLeft = null;
    }
    app.pixelsPerMs = Math.max(app.minPixelsPerMs,
        Math.min(app.maxPixelsPerMs, app.pixelsPerMs * factor));

    app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);

    renderLanesCanvas();

    // Restore scroll position to keep the same time at center
    const newCenterX = msToPixels(centerTimeMs);
    const newScrollLeft = newCenterX - viewportWidth / 2;
    canvas.scrollLeft = Math.max(0, newScrollLeft);

    // Sync ruler and markers
    app.elements.timelineRuler.scrollLeft = canvas.scrollLeft;
    app.elements.timeMarkers.scrollLeft = canvas.scrollLeft;
    syncZoomFitIndicator();
    persistCurrentDiagramViewState();
    saveSessionState();
}

function handleZoomFit() {
    const canvas = app.elements.lanesCanvas;
    if (!canvas) return;
    const fitScale = getFitToViewScale();
    if (!fitScale) {
        syncZoomFitIndicator();
        return;
    }

    const applyScroll = (targetLeft) => {
        const maxScroll = Math.max(0, canvas.scrollWidth - canvas.clientWidth);
        const clamped = Math.max(0, Math.min(maxScroll, targetLeft));
        canvas.scrollLeft = clamped;
        app.elements.timelineRuler.scrollLeft = clamped;
        app.elements.timeMarkers.scrollLeft = clamped;
    };

    if (isFitModeActive()) {
        const fallbackScale = Number.isFinite(app.zoomBeforeFitScale)
            ? app.zoomBeforeFitScale
            : getDefaultZoomScaleForBaseUnit();
        const fallbackScrollLeft = Number.isFinite(app.zoomBeforeFitScrollLeft)
            ? app.zoomBeforeFitScrollLeft
            : canvas.scrollLeft;
        app.pixelsPerMs = Math.max(app.minPixelsPerMs, Math.min(app.maxPixelsPerMs, fallbackScale));
        app.fitModeActive = false;
        app.zoomBeforeFitScale = null;
        app.zoomBeforeFitScrollLeft = null;
        app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);
        renderLanesCanvas();
        applyScroll(fallbackScrollLeft);
    } else {
        app.zoomBeforeFitScale = app.pixelsPerMs;
        app.zoomBeforeFitScrollLeft = canvas.scrollLeft;
        app.fitModeActive = true;
        app.pixelsPerMs = fitScale;
        app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);
        renderLanesCanvas();
        // Fit should show the projected diagram from its start edge.
        applyScroll(0);
    }
    syncZoomFitIndicator();
    persistCurrentDiagramViewState();
    saveSessionState();
}

// =====================================================
// Properties Panel Handlers
// =====================================================
function handleBoxPropertyChange(event = null) {
    if (!app.selectedBoxId) return;
    if (app.diagram.locked) return; // Silent fail for property changes when locked

    const box = app.diagram.boxes.find(b => b.id === app.selectedBoxId);
    if (!box) return;

    const sourceId = event?.target?.id || '';
    const minDurationMs = Math.max(MIN_BOX_DURATION_MS, getBoxStepMs());
    let nextStartOffset = box.startOffset;
    let nextDuration = box.duration;

    if (sourceId === 'box-start') {
        nextStartOffset = parseBoxInputToMs(app.elements.boxStart.value, {
            fallbackMs: box.startOffset,
            minMs: 0
        });
    } else if (sourceId === 'box-duration') {
        nextDuration = parseBoxInputToMs(app.elements.boxDuration.value, {
            fallbackMs: box.duration,
            minMs: minDurationMs
        });
    }

    const updates = {
        label: app.elements.boxLabel.value,
        color: app.elements.boxColor.value,
        startOffset: nextStartOffset,
        duration: nextDuration
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

function handleDeleteLane(laneId = null) {
    if (!isEditingAllowed()) return;

    const resolvedLaneId = laneId !== null ? parseInt(laneId, 10) : parseInt(app.selectedLaneId, 10);
    if (!Number.isInteger(resolvedLaneId)) return;

    const lane = app.diagram.lanes.find(l => l.id === resolvedLaneId);
    if (!lane) return;
    requestLaneDelete(resolvedLaneId);
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
            setCurrentDiagramId(generateDiagramId());
            app.diagram = new TimelineDiagram();
            app.diagram.fromJSON(data);
            clearPendingPurgeRequest();
            clearLaneHistory();

            app.elements.diagramTitle.value = app.diagram.title;
            app.elements.startTime.value = app.diagram.startTime;
            syncToolbarSettingsControls();

            deselectBox();
            renderLaneList();
            renderLanesCanvas();
            renderTimelineRuler();
            renderTimeMarkers();
            renderAlignmentCanvasOverlay();
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
            clearPendingPurgeRequest();
            clearLaneHistory();
            // Schedule measurement restore after initial render
            setTimeout(() => restorePinnedMeasurement(), 100);
            return true;
        }
    }
    return false;
}

function triggerToolbarButtonFeedback(buttonId, activeTitle, duration = 1200) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    const defaultTitle = btn.dataset.defaultTitle || btn.title || '';
    if (defaultTitle) {
        btn.dataset.defaultTitle = defaultTitle;
    }

    if (!triggerToolbarButtonFeedback.feedbackTimers) {
        triggerToolbarButtonFeedback.feedbackTimers = new Map();
    }

    const timers = triggerToolbarButtonFeedback.feedbackTimers;
    if (timers.has(buttonId)) {
        clearTimeout(timers.get(buttonId));
    }

    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    if (activeTitle) {
        btn.title = activeTitle;
    }

    const timer = setTimeout(() => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
        if (btn.dataset.defaultTitle) {
            btn.title = btn.dataset.defaultTitle;
        }
        timers.delete(buttonId);
    }, duration);

    timers.set(buttonId, timer);
}

function shareAsURL() {
    const encoded = encodeToURL();
    const url = `${window.location.origin}${window.location.pathname}?d=${encoded}`;

    // Check URL length (browsers have limits, typically ~2000 chars)
    if (url.length > 8000) {
        showToast({
            type: 'warning',
            title: 'Diagram Too Large',
            message: 'Use Download/Load to share large diagrams.'
        });
        return;
    }

    // Copy to clipboard
    navigator.clipboard.writeText(url).then(() => {
        // Share button feedback uses the same active/toggle styling as other toolbar controls.
        triggerToolbarButtonFeedback('share-url', 'Link copied');

        // Show instructive toast
        showToast({
            type: 'success',
            title: 'Link Copied!',
            message: 'Share this URL with collaborators to view your timeline diagram.',
            duration: 3500
        });
    }).catch(() => {
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
    const lines = [];
    const paragraphs = String(text || '').split(/\r?\n/);

    paragraphs.forEach(paragraph => {
        const words = paragraph.split(' ');
        let currentLine = '';

        // Preserve intentional blank lines
        if (paragraph.trim() === '') {
            lines.push('');
            return;
        }

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
    });

    return lines;
}

function getRulerIntervalCandidatesMs() {
    const baseUnit = getBaseTimeUnit();
    const baseMs = getUnitFactorMs(baseUnit);
    const subUnit = getBaseUnitSubunit(baseUnit);
    const subMs = subUnit ? getUnitFactorMs(subUnit) : baseMs;
    const thresholdMs = Math.max(0, Number(app?.settings?.timeFormatThreshold || 0));

    const canonical = [
        0.001, 0.002, 0.005,
        0.01, 0.02, 0.05,
        0.1, 0.2, 0.5,
        1, 2, 5,
        10, 20, 50,
        100, 200, 500,
        1000, 2000, 5000,
        10000, 30000, 60000,
        120000, 300000, 600000,
        900000, 1800000, 3600000,
        7200000, 21600000, 43200000,
        86400000, 172800000, 604800000,
        1209600000, 2592000000, 7776000000,
        31536000000, 63072000000, 157680000000
    ];

    const dynamic = [
        subMs / 10, subMs / 5, subMs / 2,
        subMs, subMs * 2, subMs * 3, subMs * 6, subMs * 12,
        baseMs / 20, baseMs / 10, baseMs / 5, baseMs / 2,
        baseMs, baseMs * 2, baseMs * 5
    ];

    if (thresholdMs > 0) {
        dynamic.push(thresholdMs / 4, thresholdMs / 2, thresholdMs, thresholdMs * 2);
    }

    const merged = [...dynamic, ...canonical]
        .filter(v => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);

    // Deduplicate near-equal values to keep selection deterministic.
    const deduped = [];
    merged.forEach(value => {
        if (deduped.length === 0 || Math.abs(deduped[deduped.length - 1] - value) > (value * 1e-9)) {
            deduped.push(value);
        }
    });
    return deduped;
}

function getAdaptiveRulerInterval(endTimeMs, options = {}) {
    const minPixelSpacing = Number.isFinite(options.minPixelSpacing) ? options.minPixelSpacing : 60;
    const maxTicks = Number.isFinite(options.maxTicks) ? options.maxTicks : 360;
    const safeEndTime = Math.max(1, Number(endTimeMs) || 1);
    const intervals = getRulerIntervalCandidatesMs();

    for (const interval of intervals) {
        const tickCount = Math.ceil(safeEndTime / interval) + 1;
        if (tickCount > maxTicks) continue;
        if (msToPixels(interval) >= minPixelSpacing) return interval;
    }

    for (const interval of intervals) {
        const tickCount = Math.ceil(safeEndTime / interval) + 1;
        if (tickCount <= maxTicks) return interval;
    }

    return Math.max(1, Math.ceil(safeEndTime / Math.max(2, maxTicks - 1)));
}

function getRulerMajorIntervalMs(intervalMs) {
    const safeInterval = Math.max(1, Number(intervalMs) || 1);
    const baseUnit = getBaseTimeUnit();

    // In ms mode, keep emphasis on human-friendly second/minute boundaries.
    if (baseUnit === 'ms') {
        if (safeInterval < 1000) return 1000;
        if (safeInterval < 5000) return 5000;
        if (safeInterval < 60000) return 10000;
        if (safeInterval < 300000) return 60000;
        return Math.max(60000, safeInterval * 5);
    }

    // In non-ms modes, emphasize base-unit boundaries, then reduce density for larger steps.
    const baseMs = getUnitFactorMs(baseUnit);
    if (safeInterval < baseMs) return baseMs;
    if (safeInterval < baseMs * 5) return baseMs * 5;
    return Math.max(baseMs, safeInterval * 5);
}

function isMajorRulerTickMs(valueMs, intervalMs) {
    const majorInterval = getRulerMajorIntervalMs(intervalMs);
    const numericValue = Number(valueMs);
    if (!Number.isFinite(numericValue)) return false;

    const normalizedRemainder = ((numericValue % majorInterval) + majorInterval) % majorInterval;
    const epsilon = Math.max(0.001, majorInterval * 1e-6);
    return normalizedRemainder < epsilon || Math.abs(majorInterval - normalizedRemainder) < epsilon;
}

function getExportTimelineMetrics() {
    const settingsDuration = app.settings.timelineDuration || 0;
    const actualDuration = Math.max(app.diagram.getTotalDuration(), settingsDuration, DEFAULT_MIN_TIMELINE_MS);
    const visualDuration = Compression.enabled
        ? Math.max(Compression.getCompressedDuration(), DEFAULT_MIN_TIMELINE_MS)
        : actualDuration;
    const trailingSpace = app.settings.trailingSpace || 0;
    const endTime = visualDuration + trailingSpace;
    return {
        actualDuration,
        visualDuration,
        trailingSpace,
        endTime,
        interval: getAdaptiveRulerInterval(endTime)
    };
}

function exportToPNG() {
    // Use manual canvas rendering for full control
    const lanes = app.diagram.lanes;
    const boxes = app.diagram.boxes;

    const scale = 2; // High DPI
    const headerHeight = 50;
    const laneHeight = getLaneHeightPx();
    const laneLabelWidth = getLaneLabelWidthForExportPx();
    const rulerHeight = 40;
    const footerHeight = 40;
    const metrics = getExportTimelineMetrics();
    const width = laneLabelWidth + msToPixels(metrics.endTime) + 50;
    const lanesAreaHeight = lanes.length * laneHeight;
    const lanesStartY = headerHeight + rulerHeight;

    // Pre-calculate time markers layout to determine height
    const markers = [];
    boxes.forEach(box => {
        const edges = getRenderedBoxEdges(box);
        markers.push({
            visualX: edges.leftPx,
            actualTime: box.startOffset,
            type: 'start',
            color: box.color,
            label: formatDuration(box.startOffset)
        });
        markers.push({
            visualX: edges.rightPx,
            actualTime: box.startOffset + box.duration,
            type: 'end',
            color: box.color,
            label: formatDuration(box.startOffset + box.duration)
        });
    });
    markers.sort((a, b) => a.visualX - b.visualX);

    // Pre-calculate marker levels
    const levels = [];
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = '9px Monaco, monospace';

    markers.forEach(m => {
        const x = laneLabelWidth + m.visualX;
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
    for (let idx = 0, axisTime = 0; axisTime <= metrics.endTime + 0.0001; idx++, axisTime = idx * metrics.interval) {
        const x = laneLabelWidth + msToPixels(axisTime);
        const labelTime = Compression.enabled ? Compression.compressedToActual(axisTime) : axisTime;
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.moveTo(x, rulerY);
        ctx.lineTo(x, rulerY + rulerHeight);
        ctx.stroke();
        ctx.fillText(formatDuration(labelTime), x + 4, rulerY + rulerHeight - 8);
    }

    if (Compression.enabled) {
        const breakMarkers = Compression.getBreakMarkers();
        breakMarkers.forEach(marker => {
            const x = laneLabelWidth + msToPixels(marker.compressedStart);
            const gapSize = marker.actualEnd - marker.actualStart;
            const gapLabel = formatDuration(gapSize);

            ctx.strokeStyle = '#e8a317';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, rulerY);
            ctx.lineTo(x, rulerY + rulerHeight);
            ctx.stroke();

            ctx.font = '600 9px Monaco, monospace';
            const labelW = ctx.measureText(gapLabel).width + 8;
            ctx.fillStyle = '#e8a317';
            ctx.fillRect(x + 3, rulerY, labelW, 12);
            ctx.fillStyle = '#000000';
            ctx.fillText(gapLabel, x + 7, rulerY + 9);
            ctx.font = '11px Monaco, monospace';
        });
    }

    // Draw lane backgrounds first (alignment lines/boxes are layered above this)
    lanes.forEach((lane, index) => {
        const y = lanesStartY + (index * laneHeight);
        ctx.fillStyle = index % 2 === 0 ? '#0f1419' : '#101520';
        ctx.fillRect(laneLabelWidth, y, width - laneLabelWidth, laneHeight);
    });

    // Draw alignment lines as background guides before boxes
    if (app.settings.showAlignmentLines && boxes.length > 0) {
        const boxBottomInsetPx = 6;
        const lineBottom = lanesStartY + lanesAreaHeight;

        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;

        boxes.forEach(box => {
            const laneIndex = lanes.findIndex(l => l.id === box.laneId);
            if (laneIndex < 0) return;
            const lineTop = lanesStartY + (laneIndex * laneHeight) + laneHeight - boxBottomInsetPx;
            if (lineTop >= lineBottom) return;

            const edges = getRenderedBoxEdges(box);
            const xPositions = [laneLabelWidth + edges.leftPx, laneLabelWidth + edges.rightPx];

            ctx.strokeStyle = box.color;
            xPositions.forEach(x => {
                ctx.beginPath();
                ctx.moveTo(x, lineTop);
                ctx.lineTo(x, lineBottom);
                ctx.stroke();
            });
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
        ctx.font = '10px Inter, sans-serif';
        const maxLabelWidth = laneLabelWidth - 24;
        const labelLineHeight = 13;
        const lines = wrapText(ctx, lane.name, maxLabelWidth, labelLineHeight);
        const totalTextHeight = lines.length * labelLineHeight;
        const startTextY = y + (laneHeight - totalTextHeight) / 2 + 10;
        lines.forEach((line, lineIndex) => {
            ctx.fillText(line, 12, startTextY + lineIndex * labelLineHeight);
        });

        // Boxes for this lane
        const laneBoxes = boxes.filter(b => b.laneId === lane.id);
        laneBoxes.forEach(box => {
            const visualStart = Compression.enabled ? Compression.getVisualOffset(box) : box.startOffset;
            const bx = laneLabelWidth + msToPixels(visualStart);
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

    // Draw time markers with marker-area ticks only
    ctx.font = '9px Monaco, monospace';
    markers.forEach(m => {
        const yPos = timeMarkersY + timeMarkersHeight - 6 - (m.level * 14);

        // Draw tick line in time markers area
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(m.x, timeMarkersY + 2);
        ctx.lineTo(m.x, yPos - 6);
        ctx.stroke();

        // Draw label
        ctx.fillStyle = m.color;
        ctx.textAlign = 'left';
        ctx.fillText(m.text, m.x, yPos);
    });
    ctx.textAlign = 'left';

    // Draw measurements
    const exportMeasurements = getMeasurementsForExport();
    if (exportMeasurements.length > 0) {
        const appLaneLabelWidth = getLaneLabelWidthPx();
        ctx.font = '600 14px Monaco, monospace';
        ctx.textAlign = 'center';

        exportMeasurements.forEach((measurement, index) => {
            const metrics = computeMeasurementMetrics(measurement);
            if (!metrics || !measurement.start || !measurement.end) return;

            const measureColor = sanitizeMeasurementColor(measurement.color, MEASUREMENT_COLORS[index % MEASUREMENT_COLORS.length]);
            const startXCanvas = measurement.start.x;
            const endXCanvas = measurement.end.x;

            const exportStartX = laneLabelWidth + (startXCanvas - appLaneLabelWidth);
            const exportEndX = laneLabelWidth + (endXCanvas - appLaneLabelWidth);
            const relativeStartY = Number.isFinite(measurement.start.y) ? measurement.start.y : (lanesAreaHeight / 2);
            const relativeEndY = Number.isFinite(measurement.end.y) ? measurement.end.y : relativeStartY;
            const exportStartY = Math.max(lanesStartY + 8, Math.min(lanesStartY + lanesAreaHeight - 8, lanesStartY + relativeStartY));
            const exportEndY = Math.max(lanesStartY + 8, Math.min(lanesStartY + lanesAreaHeight - 8, lanesStartY + relativeEndY));
            const arrow = getMeasurementArrowPoints(exportStartX, exportStartY, exportEndX, exportEndY, 8, 4);
            const vector = arrow.vector;
            const tickHalf = 5;

            ctx.strokeStyle = measureColor;
            ctx.lineWidth = app.measurePinned ? 2 : 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(exportStartX, exportStartY);
            ctx.lineTo(exportEndX, exportEndY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(exportStartX, exportStartY - tickHalf);
            ctx.lineTo(exportStartX, exportStartY + tickHalf);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(arrow.leftX, arrow.leftY);
            ctx.lineTo(exportEndX, exportEndY);
            ctx.lineTo(arrow.rightX, arrow.rightY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(exportEndX + vector.px * tickHalf, exportEndY + vector.py * tickHalf);
            ctx.lineTo(exportEndX - vector.px * tickHalf, exportEndY - vector.py * tickHalf);
            ctx.stroke();

            const measureText = metrics.durationText;
            const midX = (exportStartX + exportEndX) / 2;
            const midY = (exportStartY + exportEndY) / 2;
            const textWidth = ctx.measureText(measureText).width + 8;

            ctx.fillStyle = '#0f1419';
            ctx.fillRect(midX - textWidth / 2, midY - 22, textWidth, 16);
            ctx.fillStyle = measureColor;
            ctx.fillText(measureText, midX, midY - 10);
        });

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
    triggerToolbarButtonFeedback('export-png', 'PNG exported');
}

// Helper function to wrap text for SVG (returns array of lines)
function wrapTextSVG(text, maxWidth, charWidth) {
    const maxChars = Math.floor(maxWidth / charWidth);
    const lines = [];
    const paragraphs = String(text || '').split(/\r?\n/);

    paragraphs.forEach(paragraph => {
        const words = paragraph.split(' ');
        let currentLine = '';

        // Preserve intentional blank lines
        if (paragraph.trim() === '') {
            lines.push('');
            return;
        }

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
    });

    return lines;
}

function exportToSVG() {
    const lanes = app.diagram.lanes;
    const boxes = app.diagram.boxes;

    const headerHeight = 50;
    const laneHeight = getLaneHeightPx();
    const laneLabelWidth = getLaneLabelWidthForExportPx();
    const rulerHeight = 40;
    const footerHeight = 40;
    const metrics = getExportTimelineMetrics();
    const width = Math.round(laneLabelWidth + msToPixels(metrics.endTime) + 50);
    const lanesAreaHeight = lanes.length * laneHeight;
    const lanesStartY = headerHeight + rulerHeight;

    // Pre-calculate time markers layout (same as PNG)
    const markers = [];
    boxes.forEach(box => {
        const edges = getRenderedBoxEdges(box);
        markers.push({
            visualX: edges.leftPx,
            actualTime: box.startOffset,
            type: 'start',
            color: box.color,
            label: formatDuration(box.startOffset)
        });
        markers.push({
            visualX: edges.rightPx,
            actualTime: box.startOffset + box.duration,
            type: 'end',
            color: box.color,
            label: formatDuration(box.startOffset + box.duration)
        });
    });
    markers.sort((a, b) => a.visualX - b.visualX);

    // Calculate marker levels
    const levels = [];
    const charWidth = 6;
    markers.forEach(m => {
        const x = laneLabelWidth + m.visualX;
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
      .lane-label { font-family: 'Inter', -apple-system, sans-serif; font-size: 10px; fill: #ffffff; }
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
    for (let idx = 0, axisTime = 0; axisTime <= metrics.endTime + 0.0001; idx++, axisTime = idx * metrics.interval) {
        const x = Math.round(laneLabelWidth + msToPixels(axisTime));
        const labelTime = Compression.enabled ? Compression.compressedToActual(axisTime) : axisTime;
        svg += `  <line x1="${x}" y1="${rulerY}" x2="${x}" y2="${rulerY + rulerHeight}" stroke="rgba(255,255,255,0.1)"/>\n`;
        svg += `  <text x="${x + 4}" y="${rulerY + rulerHeight - 8}" class="ruler-text">${formatDuration(labelTime)}</text>\n`;
    }

    if (Compression.enabled) {
        const breakMarkers = Compression.getBreakMarkers();
        breakMarkers.forEach(marker => {
            const x = Math.round(laneLabelWidth + msToPixels(marker.compressedStart));
            const gapSize = marker.actualEnd - marker.actualStart;
            const gapLabel = formatDuration(gapSize);
            const labelW = Math.max(22, gapLabel.length * 6 + 8);

            svg += `  <line x1="${x}" y1="${rulerY}" x2="${x}" y2="${rulerY + rulerHeight}" stroke="#e8a317" stroke-width="2"/>\n`;
            svg += `  <rect x="${x + 3}" y="${rulerY}" width="${labelW}" height="12" fill="#e8a317"/>\n`;
            svg += `  <text x="${x + 7}" y="${rulerY + 9}" style="font-family: 'Monaco', 'Menlo', monospace; font-size: 9px; font-weight: 600; fill: #000;">${gapLabel}</text>\n`;
        });
    }

    // Lane backgrounds first
    lanes.forEach((lane, index) => {
        const y = lanesStartY + (index * laneHeight);
        svg += `  <rect x="${laneLabelWidth}" y="${y}" width="${width - laneLabelWidth}" height="${laneHeight}" fill="${index % 2 === 0 ? '#0f1419' : '#101520'}"/>\n`;
    });

    // Alignment lines as background guides before boxes
    if (app.settings.showAlignmentLines && boxes.length > 0) {
        const boxBottomInsetPx = 6;
        const lineBottom = lanesStartY + lanesAreaHeight;

        svg += `  <!-- Alignment Lines -->\n`;
        boxes.forEach(box => {
            const laneIndex = lanes.findIndex(l => l.id === box.laneId);
            if (laneIndex < 0) return;
            const lineTop = lanesStartY + (laneIndex * laneHeight) + laneHeight - boxBottomInsetPx;
            if (lineTop >= lineBottom) return;

            const edges = getRenderedBoxEdges(box);
            const xPositions = [
                Math.round(laneLabelWidth + edges.leftPx),
                Math.round(laneLabelWidth + edges.rightPx)
            ];

            xPositions.forEach(x => {
                svg += `  <line x1="${x}" y1="${Math.round(lineTop)}" x2="${x}" y2="${Math.round(lineBottom)}" stroke="${box.color}" stroke-opacity="0.5" stroke-dasharray="4 4"/>\n`;
            });
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
        const labelLines = wrapTextSVG(lane.name, laneLabelWidth - 24, 6);
        const lineHeight = 13;
        const totalTextHeight = labelLines.length * lineHeight;
        const startTextY = y + (laneHeight - totalTextHeight) / 2 + 10;
        labelLines.forEach((line, lineIndex) => {
            svg += `  <text x="12" y="${startTextY + lineIndex * lineHeight}" class="lane-label">${escapeHtml(line)}</text>\n`;
        });

        // Boxes for this lane
        const laneBoxes = boxes.filter(b => b.laneId === lane.id);
        laneBoxes.forEach(box => {
            const visualStart = Compression.enabled ? Compression.getVisualOffset(box) : box.startOffset;
            const bx = Math.round(laneLabelWidth + msToPixels(visualStart));
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

    // Draw time markers with colored labels and marker-area ticks
    markers.forEach(m => {
        const yPos = timeMarkersY + timeMarkersHeight - 6 - (m.level * 14);
        // Tick line in time markers area
        svg += `  <line x1="${Math.round(m.x)}" y1="${timeMarkersY + 2}" x2="${Math.round(m.x)}" y2="${yPos - 6}" stroke="${m.color}"/>\n`;
        // Label
        svg += `  <text x="${Math.round(m.x)}" y="${yPos}" text-anchor="left" class="time-marker" fill="${m.color}">${m.text}</text>\n`;
    });

    // Draw measurements
    const exportMeasurements = getMeasurementsForExport();
    if (exportMeasurements.length > 0) {
        const appLaneLabelWidth = getLaneLabelWidthPx();
        svg += `  <!-- Measurements -->\n`;

        exportMeasurements.forEach((measurement, index) => {
            const metrics = computeMeasurementMetrics(measurement);
            if (!metrics || !measurement.start || !measurement.end) return;

            const measureColor = sanitizeMeasurementColor(measurement.color, MEASUREMENT_COLORS[index % MEASUREMENT_COLORS.length]);
            const startXCanvas = measurement.start.x;
            const endXCanvas = measurement.end.x;

            const exportStartX = Math.round(laneLabelWidth + (startXCanvas - appLaneLabelWidth));
            const exportEndX = Math.round(laneLabelWidth + (endXCanvas - appLaneLabelWidth));
            const relativeStartY = Number.isFinite(measurement.start.y) ? measurement.start.y : (lanesAreaHeight / 2);
            const relativeEndY = Number.isFinite(measurement.end.y) ? measurement.end.y : relativeStartY;
            const exportStartY = Math.round(Math.max(lanesStartY + 8, Math.min(lanesStartY + lanesAreaHeight - 8, lanesStartY + relativeStartY)));
            const exportEndY = Math.round(Math.max(lanesStartY + 8, Math.min(lanesStartY + lanesAreaHeight - 8, lanesStartY + relativeEndY)));
            const strokeWidth = app.measurePinned ? 2 : 1.5;
            const arrow = getMeasurementArrowPoints(exportStartX, exportStartY, exportEndX, exportEndY, 8, 4);
            const vector = arrow.vector;
            const tickHalf = 5;

            svg += `  <line x1="${exportStartX}" y1="${exportStartY}" x2="${exportEndX}" y2="${exportEndY}" stroke="${measureColor}" stroke-width="${strokeWidth}"/>\n`;
            svg += `  <line x1="${exportStartX}" y1="${exportStartY - tickHalf}" x2="${exportStartX}" y2="${exportStartY + tickHalf}" stroke="${measureColor}" stroke-width="1.5"/>\n`;

            svg += `  <path d="M${arrow.leftX},${arrow.leftY} L${exportEndX},${exportEndY} L${arrow.rightX},${arrow.rightY}" fill="none" stroke="${measureColor}" stroke-width="1.5"/>\n`;
            svg += `  <line x1="${exportEndX + vector.px * tickHalf}" y1="${exportEndY + vector.py * tickHalf}" x2="${exportEndX - vector.px * tickHalf}" y2="${exportEndY - vector.py * tickHalf}" stroke="${measureColor}" stroke-width="1.5"/>\n`;

            const measureText = metrics.durationText;
            const midX = (exportStartX + exportEndX) / 2;
            const midY = (exportStartY + exportEndY) / 2;
            const textWidth = measureText.length * 8 + 8;

            svg += `  <rect x="${midX - textWidth / 2}" y="${midY - 22}" width="${textWidth}" height="16" fill="#0f1419"/>\n`;
            svg += `  <text x="${midX}" y="${midY - 10}" text-anchor="middle" style="font-family: 'Monaco', 'Menlo', monospace; font-size: 14px; font-weight: 600; fill: ${measureColor};">${measureText}</text>\n`;
        });
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
    triggerToolbarButtonFeedback('export-svg', 'SVG exported');
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
    syncSelectedLaneUI();

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

function formatThresholdInputValue(msValue, baseUnit = getBaseTimeUnit()) {
    return formatMsForInput(msValue, getThresholdInputUnit(baseUnit), 0);
}

function parseThresholdInputValue(rawValue, baseUnit = getBaseTimeUnit(), fallbackMs = null) {
    const fallback = Number.isFinite(fallbackMs)
        ? fallbackMs
        : Number(app.settings.timeFormatThreshold || getDefaultTimeThreshold(baseUnit));
    const parsedUnits = Number(rawValue);
    if (!Number.isFinite(parsedUnits)) {
        return parseInputToMs(fallback, {
            unit: 'ms',
            fallbackMs: fallback,
            minMs: 0
        });
    }
    const roundedUnits = Math.max(0, Math.round(parsedUnits));
    return parseInputToMs(roundedUnits, {
        unit: getThresholdInputUnit(baseUnit),
        fallbackMs: fallback,
        minMs: 0
    });
}

function isThresholdPanelOpen() {
    const panel = document.getElementById('threshold-config-panel');
    return !!panel && !panel.classList.contains('hidden');
}

function setThresholdPanelOpen(open) {
    const panel = document.getElementById('threshold-config-panel');
    const toggleBtn = document.getElementById('threshold-toggle-btn');
    if (!panel || !toggleBtn) return;
    const shouldOpen = !!open;
    panel.classList.toggle('hidden', !shouldOpen);
    toggleBtn.classList.toggle('active', shouldOpen);
    toggleBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    scheduleDesignerHintsRender();
}

function toggleThresholdPanel() {
    setThresholdPanelOpen(!isThresholdPanelOpen());
}

function closeThresholdPanel() {
    setThresholdPanelOpen(false);
}

function ensureThresholdBaseUnitOptions() {
    const options = document.getElementById('threshold-base-unit-options');
    if (!options) return;

    if (options.childElementCount !== THRESHOLD_BASE_UNIT_ORDER.length) {
        options.innerHTML = '';
        THRESHOLD_BASE_UNIT_ORDER.forEach(unit => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'threshold-unit-btn';
            button.dataset.unit = unit;
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', 'false');
            button.textContent = getBaseUnitLabel(unit);
            options.appendChild(button);
        });
    }
}

function syncThresholdBaseUnitButtons() {
    const options = document.getElementById('threshold-base-unit-options');
    if (!options) return;
    const activeUnit = getBaseTimeUnit();

    options.querySelectorAll('.threshold-unit-btn').forEach(button => {
        const unit = normalizeBaseTimeUnit(button.dataset.unit);
        const isActive = unit === activeUnit;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-checked', isActive ? 'true' : 'false');
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.title = `${getBaseUnitLabel(unit)} base unit`;
    });
}

function handleThresholdBaseUnitSelect(unit) {
    const normalizedUnit = normalizeBaseTimeUnit(unit);
    if (normalizedUnit === getBaseTimeUnit()) return;

    const baseUnitSelect = document.getElementById('config-base-time-unit');
    if (baseUnitSelect) {
        baseUnitSelect.value = normalizedUnit;
    } else {
        app.settings.baseTimeUnit = normalizedUnit;
    }
    handleSettingsChange();
}

function commitCustomTimeThreshold() {
    const customInput = document.getElementById('config-time-threshold-custom');
    const modeSubunit = document.getElementById('threshold-mode-subunit');
    if (!customInput || !modeSubunit || !modeSubunit.checked) return false;

    const baseUnit = getBaseTimeUnit();
    const thresholdInputUnit = getThresholdInputUnit(baseUnit);
    const fallbackMs = Math.max(1, Number(app.settings.timeFormatThreshold) || getDefaultTimeThreshold(baseUnit));
    const customValue = parseThresholdInputValue(customInput.value, baseUnit, fallbackMs);

    if (!Number.isFinite(customValue) || customValue <= 0) {
        showToast({
            type: 'warning',
            title: 'Invalid Threshold',
            message: `Enter a value greater than 0 (${getBaseUnitLabel(thresholdInputUnit)}).`,
            duration: 2500
        });
        requestAnimationFrame(() => {
            customInput.focus();
            customInput.select();
        });
        return false;
    }

    app.settings.timeFormatThreshold = Math.max(1, customValue);
    syncTimeThresholdControl();
    handleSettingsChange();
    return true;
}

function handleTimeThresholdModeChange() {
    const modeBaseOnly = document.getElementById('threshold-mode-base-only');
    const modeSubunit = document.getElementById('threshold-mode-subunit');
    if (!modeBaseOnly || !modeSubunit) return;

    if (modeBaseOnly.checked) {
        app.settings.timeFormatThreshold = 0;
        syncTimeThresholdControl();
        handleSettingsChange();
        return;
    }

    if (modeSubunit.checked) {
        const committed = commitCustomTimeThreshold();
        if (!committed) {
            syncTimeThresholdControl();
        }
    }
}

function updateToolbarToggleButtons() {
    const toggleIds = [
        'config-show-alignment',
        'config-show-labels',
        'config-compact-view',
        'config-auto-open-properties',
        'config-lock-diagram'
    ];

    toggleIds.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const label = input.closest('.toolbar-toggle-btn');
        if (label) {
            label.classList.toggle('active', !!input.checked);
        }
    });
    scheduleDesignerHintsRender();
}

function syncTimeThresholdControl() {
    const toggleBtn = document.getElementById('threshold-toggle-btn');
    const baseUnitOptions = document.getElementById('threshold-base-unit-options');
    const modeBaseOnly = document.getElementById('threshold-mode-base-only');
    const modeSubunit = document.getElementById('threshold-mode-subunit');
    const baseOnlyLabel = document.getElementById('threshold-mode-base-only-label');
    const subunitPrefix = document.getElementById('threshold-mode-subunit-prefix');
    const subunitSuffix = document.getElementById('threshold-mode-subunit-suffix');
    const thresholdInput = document.getElementById('config-time-threshold-custom');
    if (!toggleBtn || !baseUnitOptions || !modeBaseOnly || !modeSubunit || !baseOnlyLabel || !subunitPrefix || !subunitSuffix || !thresholdInput) {
        return;
    }
    ensureThresholdBaseUnitOptions();

    const baseUnit = getBaseTimeUnit();
    const threshold = Number(app.settings.timeFormatThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
        app.settings.timeFormatThreshold = getDefaultTimeThreshold(baseUnit);
    }

    const baseLabel = getBaseUnitLabel(baseUnit);
    const subunit = getThresholdDisplaySubUnit(baseUnit);
    const subunitLabel = getBaseUnitLabel(subunit);
    const thresholdUnit = getThresholdInputUnit(baseUnit);
    const thresholdUnitLabel = getBaseUnitLabel(thresholdUnit);
    const thresholdUnitMs = getUnitFactorMs(thresholdUnit);

    baseOnlyLabel.textContent = `Display ${baseLabel} only`;
    subunitPrefix.textContent = `Display ${subunitLabel} below`;
    subunitSuffix.textContent = thresholdUnitLabel;

    toggleBtn.title = baseUnit === 'ms'
        ? 'Threshold Rules: display ms only or switch to s/min above threshold'
        : `Threshold Rules: display ${baseLabel} only or show ${subunitLabel} below threshold`;

    thresholdInput.step = '1';
    thresholdInput.min = '0';

    let normalizedThreshold = Math.max(0, parseInt(app.settings.timeFormatThreshold, 10) || 0);
    if (normalizedThreshold > 0) {
        normalizedThreshold = Math.max(
            thresholdUnitMs,
            Math.round(normalizedThreshold / thresholdUnitMs) * thresholdUnitMs
        );
    }
    app.settings.timeFormatThreshold = normalizedThreshold;
    const showBaseOnly = normalizedThreshold === 0;
    modeBaseOnly.checked = showBaseOnly;
    modeSubunit.checked = !showBaseOnly;
    thresholdInput.disabled = showBaseOnly;

    const displayThresholdMs = showBaseOnly ? getDefaultTimeThreshold(baseUnit) : normalizedThreshold;
    thresholdInput.value = formatThresholdInputValue(displayThresholdMs, baseUnit);
    syncThresholdBaseUnitButtons();
}

function syncToolbarSettingsControls() {
    const alignmentCheckbox = document.getElementById('config-show-alignment');
    if (alignmentCheckbox) alignmentCheckbox.checked = !!app.settings.showAlignmentLines;

    const labelsCheckbox = document.getElementById('config-show-labels');
    if (labelsCheckbox) labelsCheckbox.checked = !!app.settings.showBoxLabels;

    const compactCheckbox = document.getElementById('config-compact-view');
    if (compactCheckbox) compactCheckbox.checked = !!app.settings.compactView;

    const autoOpenCheckbox = document.getElementById('config-auto-open-properties');
    if (autoOpenCheckbox) autoOpenCheckbox.checked = !!app.settings.autoOpenBoxProperties;

    const lockCheckbox = document.getElementById('config-lock-diagram');
    if (lockCheckbox) lockCheckbox.checked = !!app.diagram.locked;

    syncBaseTimeUnitUI();
    updateToolbarToggleButtons();
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

    syncBaseTimeUnitUI();

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

    updateToolbarToggleButtons();

    // Deselect any box/lane
    app.selectedBoxId = null;
    app.selectedLaneId = null;
    document.querySelectorAll('.timeline-box.selected').forEach(el => el.classList.remove('selected'));
    syncSelectedLaneUI();

    panel.classList.remove('hidden');
    if (settingsBtn) settingsBtn.classList.add('active');
}

function handleSettingsChange(event = null) {
    const previousBaseUnit = getBaseTimeUnit();

    // Page title: only sync when title input actually triggered the update.
    const pageTitleInput = document.getElementById('config-page-title');
    const titleTriggered = !!(event && event.target && event.target.id === 'config-page-title');
    if (pageTitleInput && titleTriggered) {
        app.diagram.title = pageTitleInput.value;
        app.elements.diagramTitle.value = pageTitleInput.value;
    }

    const baseUnitSelect = document.getElementById('config-base-time-unit');
    if (baseUnitSelect) {
        app.settings.baseTimeUnit = normalizeBaseTimeUnit(baseUnitSelect.value);
    }

    const baseUnit = getBaseTimeUnit();
    if (baseUnit !== previousBaseUnit) {
        // Reset positive threshold to the new unit default while preserving "base unit only" mode (0).
        const currentThreshold = Math.max(0, Number(app.settings.timeFormatThreshold) || 0);
        app.settings.timeFormatThreshold = currentThreshold === 0
            ? 0
            : getDefaultTimeThreshold(baseUnit);
        app.pixelsPerMs = getDefaultZoomScaleForBaseUnit(baseUnit);
        if (app.elements?.zoomLevel) {
            app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);
        }
        app.fitModeActive = false;
        app.zoomBeforeFitScale = null;
        app.zoomBeforeFitScrollLeft = null;
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

    updateToolbarToggleButtons();
    syncBaseTimeUnitUI();

    // Re-render to apply changes
    renderLanesCanvas();
    renderTimelineRuler();
    renderTimeMarkers();
    renderAlignmentCanvasOverlay();
    updateTotalDuration();
    autoSave();
    saveSessionState();
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
            message: 'Disable Lock in the toolbar to edit.',
            duration: 2000
        });
        return false;
    }
    return true;
}

function updateLockState() {
    const body = document.body;

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

    const lockCheckbox = document.getElementById('config-lock-diagram');
    if (lockCheckbox) {
        lockCheckbox.checked = !!app.diagram.locked;
    }
    updateToolbarToggleButtons();
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

    const uiTooltip = document.createElement('div');
    uiTooltip.id = 'app-tooltip';
    uiTooltip.className = 'tooltip app-tooltip';
    uiTooltip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(uiTooltip);

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
        tooltip: tooltip,
        uiTooltip: uiTooltip
    };

    initRegularTooltips();

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

        // Update alignment overlay with proper scroll position
        renderAlignmentCanvasOverlay();

        // Update minimap viewport indicator
        Minimap.updateViewport();

        // Keep measurement overlay aligned while scrolling
        if (app.isMeasuring || app.measurements.length > 0 || app.measurePinned) {
            updateMeasurementDisplay();
        }
    });
    // Settings button
    document.getElementById('settings-btn').addEventListener('click', showSettingsPanel);

    // Settings change handlers
    const pageTitleInput = document.getElementById('config-page-title');
    if (pageTitleInput) {
        pageTitleInput.addEventListener('input', handleSettingsChange);
    }

    const thresholdToggleBtn = document.getElementById('threshold-toggle-btn');
    if (thresholdToggleBtn) {
        thresholdToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleThresholdPanel();
        });
    }

    const thresholdPanel = document.getElementById('threshold-config-panel');
    if (thresholdPanel) {
        thresholdPanel.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    const thresholdBaseUnitOptions = document.getElementById('threshold-base-unit-options');
    if (thresholdBaseUnitOptions) {
        thresholdBaseUnitOptions.addEventListener('click', (e) => {
            const button = e.target.closest('.threshold-unit-btn');
            if (!button) return;
            e.preventDefault();
            handleThresholdBaseUnitSelect(button.dataset.unit);
        });
    }

    const thresholdModeBaseOnly = document.getElementById('threshold-mode-base-only');
    if (thresholdModeBaseOnly) {
        thresholdModeBaseOnly.addEventListener('change', handleTimeThresholdModeChange);
    }

    const thresholdModeSubunit = document.getElementById('threshold-mode-subunit');
    if (thresholdModeSubunit) {
        thresholdModeSubunit.addEventListener('change', handleTimeThresholdModeChange);
    }

    const thresholdCustomInput = document.getElementById('config-time-threshold-custom');
    if (thresholdCustomInput) {
        thresholdCustomInput.addEventListener('change', commitCustomTimeThreshold);
        thresholdCustomInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitCustomTimeThreshold();
                thresholdCustomInput.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                syncTimeThresholdControl();
                thresholdCustomInput.blur();
            }
        });
    }

    document.addEventListener('mousedown', (e) => {
        if (!isThresholdPanelOpen()) return;
        const thresholdMenu = document.querySelector('.toolbar-threshold-menu');
        if (thresholdMenu && !thresholdMenu.contains(e.target)) {
            closeThresholdPanel();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isThresholdPanelOpen()) {
            closeThresholdPanel();
        }
    });

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

    const baseUnitSelect = document.getElementById('config-base-time-unit');
    if (baseUnitSelect) {
        baseUnitSelect.addEventListener('change', handleSettingsChange);
    }

    ['config-show-alignment', 'config-show-labels', 'config-compact-view', 'config-auto-open-properties', 'config-lock-diagram']
        .forEach(id => {
            const input = document.getElementById(id);
            if (input) input.addEventListener('change', updateToolbarToggleButtons);
        });

    // Duration Scaling controls (PoC - Removable)
    initDurationScalingUI();

    // Initialize Minimap
    Minimap.init();
    syncToolbarSettingsControls();

    // Click zoom label to reset to 100%
    app.elements.zoomLevel.style.cursor = 'pointer';
    app.elements.zoomLevel.addEventListener('click', () => {
        app.fitModeActive = false;
        app.zoomBeforeFitScale = null;
        app.zoomBeforeFitScrollLeft = null;
        app.pixelsPerMs = getDefaultZoomScaleForBaseUnit(); // 100%
        app.elements.zoomLevel.textContent = formatZoomLevel(app.pixelsPerMs);
        renderLanesCanvas();
        syncZoomFitIndicator();
        persistCurrentDiagramViewState();
        saveSessionState();
    });

    // Compress toggle button
    const compressToggle = document.getElementById('compress-toggle');
    if (compressToggle) {
        compressToggle.addEventListener('click', () => Compression.toggle());
    }

    // Measurement bar pin button
    const measureBarPin = document.getElementById('measure-bar-pin');
    if (measureBarPin) {
        measureBarPin.addEventListener('click', () => toggleMeasurementPin());
    }

    const measurementInfo = document.getElementById('measurement-info');
    if (measurementInfo) {
        measurementInfo.addEventListener('mousedown', startMeasurementPanelDrag);
    }

    window.addEventListener('resize', () => {
        if (app.isMeasuring || app.measurements.length > 0 || app.measurePinned) {
            updateMeasurementDisplay();
            applyMeasurementPanelPosition();
        }
        scheduleDesignerHintsRender();
    });

    // Trailing space controls
    const trailingSlider = document.getElementById('config-trailing-slider');
    const trailingInput = document.getElementById('config-trailing-space');
    if (trailingSlider && trailingInput) {
        // Initialize with current value
        trailingSlider.value = app.settings.trailingSpace;
        trailingInput.value = formatMsForInput(app.settings.trailingSpace);

        const syncTrailing = (msValue) => {
            const nextValue = Math.max(0, parseInt(msValue, 10) || 0);
            app.settings.trailingSpace = nextValue;
            trailingSlider.value = String(nextValue);
            trailingInput.value = formatMsForInput(nextValue);
            renderLanesCanvas();
            Minimap.render();
        };
        trailingSlider.addEventListener('input', () => syncTrailing(trailingSlider.value));
        trailingInput.addEventListener('change', () => {
            const parsedMs = parseInputToMs(trailingInput.value, {
                fallbackMs: app.settings.trailingSpace,
                minMs: 0
            });
            syncTrailing(parsedMs);
        });
    }

    // Compression threshold controls
    const compressionSlider = document.getElementById('config-compression-slider');
    const compressionInput = document.getElementById('config-compression-threshold');
    if (compressionSlider && compressionInput) {
        const syncCompression = (msValue) => {
            const nextValue = Math.max(10, parseInt(msValue, 10) || 500);
            app.settings.compressionThreshold = nextValue;
            compressionSlider.value = String(nextValue);
            compressionInput.value = formatMsForInput(nextValue);
            if (Compression.enabled) {
                Compression.invalidate(); // Clear cache before re-render
                renderTimelineRuler();
                renderLanesCanvas();
                renderTimeMarkers();
                Minimap.render();
            }
        };
        compressionSlider.addEventListener('input', () => syncCompression(compressionSlider.value));
        compressionInput.addEventListener('change', () => {
            const parsedMs = parseInputToMs(compressionInput.value, {
                fallbackMs: app.settings.compressionThreshold,
                minMs: 10
            });
            syncCompression(parsedMs);
        });
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
            if (e.key === 'Enter' && !e.shiftKey) {
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
        if (!currentDiagramId) {
            createNewDiagram();
            return;
        }
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
    const deleteLaneBtn = document.getElementById('delete-lane');
    if (deleteLaneBtn) {
        deleteLaneBtn.addEventListener('click', () => handleDeleteLane());
    }

    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => undoLaneDeletion());
    }
    const redoBtn = document.getElementById('redo-btn');
    if (redoBtn) {
        redoBtn.addEventListener('click', () => redoLaneDeletion());
    }
    updateUndoRedoButtons();

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
        handleMeasurementPanelDrag(e);
        if (app.isMeasuring) {
            updateMeasurement(e);
        }
    });

    document.addEventListener('mouseup', (e) => {
        stopMeasurementPanelDrag();
        if (app.isMeasuring && e.button === 0) {
            endMeasurement();
        }
    });

    // Cancel measurement on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && app.isMeasuring) {
            app.isMeasuring = false;
            app.measureSnapPoints = null;
            app.measureStart = null;
            app.measureEnd = null;
            updateMeasurementDisplay();
        }
    });

    // Click outside to deselect
    app.elements.lanesCanvas.addEventListener('click', (e) => {
        if (e.target === app.elements.lanesCanvas || e.target.classList.contains('lane-row')) {
            deselectBox();
        }
    });

    // Click-away lane deselection
    document.addEventListener('mousedown', (e) => {
        const hasSelectedLane = !(app.selectedLaneId === null || typeof app.selectedLaneId === 'undefined');
        const hasPendingLaneDelete = !!pendingLaneDeleteId;
        if (!hasSelectedLane && !hasPendingLaneDelete) return;

        // Keep selection when interacting with lane-specific controls/areas
        if (
            e.target.closest('.lane-item') ||
            e.target.closest('.lane-label') ||
            e.target.closest('#lane-props') ||
            e.target.closest('#measurement-info')
        ) {
            return;
        }

        clearPendingLaneDelete();
        clearSelectedLaneSelection();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isTextInputActive = !!active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT' ||
            active.isContentEditable
        );
        const lowerKey = typeof e.key === 'string' ? e.key.toLowerCase() : '';

        if (!isTextInputActive && !e.ctrlKey && !e.metaKey && !e.altKey && lowerKey === 'h') {
            e.preventDefault();
            toggleDesignerHints();
            return;
        }

        if (app.designerHintsVisible && !isTextInputActive && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                cycleDesignerHints(1);
                return;
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                cycleDesignerHints(-1);
                return;
            }
        }

        if (e.key === 'Escape') {
            if (app.designerHintsVisible) {
                e.preventDefault();
                toggleDesignerHints(false);
                return;
            }
            if (pendingPurgeRequest) {
                e.preventDefault();
                e.stopImmediatePropagation();
                clearPendingPurgeRequest();
                return;
            }
            if (pendingDiagramDeleteId) {
                e.preventDefault();
                e.stopImmediatePropagation();
                clearPendingDiagramDelete();
                return;
            }
            if (pendingLaneDeleteId) {
                e.preventDefault();
                e.stopImmediatePropagation();
                clearPendingLaneDelete();
                return;
            }
        }

        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !isTextInputActive) {
            if (pendingPurgeRequest) {
                e.preventDefault();
                e.stopImmediatePropagation();
                confirmPurgeOperation();
                return;
            }
            if (pendingDiagramDeleteId) {
                e.preventDefault();
                e.stopImmediatePropagation();
                confirmDiagramDelete(pendingDiagramDeleteId);
                return;
            }
            if (pendingLaneDeleteId) {
                e.preventDefault();
                e.stopImmediatePropagation();
                confirmLaneDelete(pendingLaneDeleteId);
                return;
            }
        }

        if ((e.ctrlKey || e.metaKey) && !e.altKey && !isTextInputActive) {
            if (lowerKey === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    redoLaneDeletion();
                } else {
                    undoLaneDeletion();
                }
                return;
            }
            if (lowerKey === 'y') {
                e.preventDefault();
                redoLaneDeletion();
                return;
            }
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (isTextInputActive) return;

            if (app.selectedBoxId) {
                e.preventDefault();
                handleDeleteBox();
                return;
            }
            if (app.selectedLaneId) {
                e.preventDefault();
                handleDeleteLane();
                return;
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
        renderAlignmentCanvasOverlay();
        syncZoomFitIndicator();
        scheduleDesignerHintsRender();
    });

    // Share button
    document.getElementById('share-url').addEventListener('click', shareAsURL);

    // Purge Application button (in settings)
    document.getElementById('purge-app-btn').addEventListener('click', () => purgeApplication('settings'));

    // Purge button in diagrams modal
    const purgeDiagramsBtn = document.getElementById('purge-diagrams-btn');
    if (purgeDiagramsBtn) purgeDiagramsBtn.addEventListener('click', () => purgeApplication('modal'));

    // Measurement tool button
    document.getElementById('measure-tool-btn').addEventListener('click', toggleMeasurementTool);

    // Diagrams panel toggle
    document.getElementById('diagrams-toggle').addEventListener('click', toggleDiagramsPanel);

    // New diagram button
    document.getElementById('new-diagram-btn').addEventListener('click', createNewDiagram);

    // Try to load from URL first
    const loadedFromURL = loadFromURL();
    const sessionState = loadSessionState();

    if (loadedFromURL) {
        // URL loaded - create new diagram ID for this shared diagram
        setCurrentDiagramId(generateDiagramId());
        app.elements.diagramTitle.value = app.diagram.title;
        app.elements.startTime.value = app.diagram.startTime;
        saveCurrentDiagram();
    } else if (!loadActiveDiagramFromStorage() && !loadMostRecentDiagram()) {
        // No saved diagrams - keep an empty workspace until user/import creates a diagram.
        enterNoDiagramState();
    }

    if (!loadedFromURL && sessionState && !currentDiagramId) {
        applySessionState(sessionState);
    }

    // Initial render
    renderLaneList();
    renderLanesCanvas();
    renderDiagramsList();
    updateTotalDuration();
    updateBoxLabelsState();
    saveSessionState();

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
// - Lane list refinements
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

        // Close sidebar on click outside
        document.addEventListener('mousedown', (e) => {
            const sidebar = this.rightSidebar;
            if (!sidebar || !sidebar.classList.contains('visible')) return;
            // Don't close if clicking inside the sidebar itself
            if (sidebar.contains(e.target)) return;
            // Don't close if clicking on settings button (it toggles)
            const sBtn = document.getElementById('settings-btn');
            if (sBtn && sBtn.contains(e.target)) return;
            // Don't close if clicking on a box (that opens box properties)
            if (e.target.closest('.box')) return;
            // Don't close if clicking on lane list items/actions
            if (e.target.closest('.lane-item')) return;
            this.hideRightSidebar();
        });

        // Close sidebar on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const sidebar = this.rightSidebar;
                if (sidebar && sidebar.classList.contains('visible')) {
                    this.hideRightSidebar();
                    e.stopPropagation();
                }
            }
        });
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
                clearPendingDiagramDelete({ rerender: false });
                clearPendingPurgeRequest();
                modal.classList.add('hidden');
            });
        }

        // Close on overlay click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    clearPendingDiagramDelete({ rerender: false });
                    clearPendingPurgeRequest();
                    modal.classList.add('hidden');
                }
            });
        }

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
                clearPendingDiagramDelete({ rerender: false });
                clearPendingPurgeRequest();
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
            if (btn) {
                btn.classList.add('is-light');
                btn.title = 'Switch to dark theme';
                btn.setAttribute('aria-label', 'Switch to dark theme');
            }
        } else {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            if (btn) {
                btn.classList.remove('is-light');
                btn.title = 'Switch to light theme';
                btn.setAttribute('aria-label', 'Switch to light theme');
            }
        }
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
            durationInput.value = formatMsForInput(app.settings.timelineDuration);
            durationInput.addEventListener('change', () => {
                const lastBoxEnd = app.diagram.getTotalDuration();
                let newValue = parseInputToMs(durationInput.value, {
                    fallbackMs: app.settings.timelineDuration,
                    minMs: 1000
                });

                // Validate: can't be less than last box end
                if (newValue < lastBoxEnd) {
                    newValue = Math.ceil(lastBoxEnd / 100) * 100; // Round up to nearest 100
                    durationInput.value = formatMsForInput(newValue);
                    showToast({
                        type: 'warning',
                        title: 'Duration adjusted',
                        message: `Cannot be less than last box end (${formatDuration(lastBoxEnd)}).`,
                        duration: 3000
                    });
                }

                app.settings.timelineDuration = newValue;
                durationInput.value = formatMsForInput(newValue);
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
            syncSelectedLaneUI();

            // Populate settings values
            const pageTitleInput = document.getElementById('config-page-title');
            if (pageTitleInput) pageTitleInput.value = app.diagram.title;

            syncBaseTimeUnitUI();

            const alignmentCb = document.getElementById('config-show-alignment');
            if (alignmentCb) alignmentCb.checked = app.settings.showAlignmentLines;

            const labelsCb = document.getElementById('config-show-labels');
            if (labelsCb) labelsCb.checked = app.settings.showBoxLabels;

            const autoOpenCb = document.getElementById('config-auto-open-properties');
            if (autoOpenCb) autoOpenCb.checked = app.settings.autoOpenBoxProperties;

            const lockCb = document.getElementById('config-lock-diagram');
            if (lockCb) lockCb.checked = app.diagram.locked;
            updateToolbarToggleButtons();

            const durationInput = document.getElementById('config-timeline-duration');
            if (durationInput) durationInput.value = formatMsForInput(app.settings.timelineDuration || 8000);

            const startTimeInput = document.getElementById('start-time');
            if (startTimeInput) startTimeInput.value = app.diagram.startTime;

            self.showRightSidebar('settings');
        };

        // Override updatePropertiesPanel for right sidebar
        const _origUpdateProps = updatePropertiesPanel;
        updatePropertiesPanel = function (isNewBox = false) {
            if (!V2.isV2) { _origUpdateProps(isNewBox); return; }

            // CRITICAL: Never open/update panel during active drag/resize
            if (app.isActivelyDraggingOrResizing) {
                return;
            }

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
            app.elements.boxStart.value = formatMsForInput(box.startOffset);
            app.elements.boxDuration.value = formatMsForInput(box.duration);

            if (app.elements.boxEnd) {
                app.elements.boxEnd.value = formatMsForInput(box.startOffset + box.duration);
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
            syncSelectedLaneUI();

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

// Initialize V2 after the main init
document.addEventListener('DOMContentLoaded', () => {
    V2.init();
}, { once: true });

// =====================================================
// V2 Refinements (Scroll Sync, Strict Duration, Multi-line Lanes)
// =====================================================

(function () {
    // Scroll Sync
    function initScrollSync() {
        if (!V2.isV2) return;
        const lanesCanvas = document.getElementById('lanes-canvas');
        const timeMarkers = document.getElementById('time-markers');
        const timelineRuler = document.getElementById('timeline-ruler');
        if (!lanesCanvas || !timeMarkers || !timelineRuler) return;

        let isSyncing = false;
        const syncScrollLeft = (source, left) => {
            if (isSyncing) return;
            isSyncing = true;

            if (source !== lanesCanvas) lanesCanvas.scrollLeft = left;
            if (source !== timeMarkers) timeMarkers.scrollLeft = left;
            if (source !== timelineRuler) timelineRuler.scrollLeft = left;

            requestAnimationFrame(() => {
                isSyncing = false;
            });
        };

        lanesCanvas.addEventListener('scroll', () => syncScrollLeft(lanesCanvas, lanesCanvas.scrollLeft));
        timeMarkers.addEventListener('scroll', () => syncScrollLeft(timeMarkers, timeMarkers.scrollLeft));
        timelineRuler.addEventListener('scroll', () => syncScrollLeft(timelineRuler, timelineRuler.scrollLeft));
    }

    // Override renderLaneList for div instead of input (Multi-line)
    const _origRenderLaneList = renderLaneList;
    renderLaneList = function () {
        if (!V2.isV2) { _origRenderLaneList(); return; }

        const container = app.elements.laneList;
        container.innerHTML = '';

        app.diagram.lanes.forEach((lane, index) => {
            const item = document.createElement('div');
            item.className = 'lane-item';
            if (parseInt(app.selectedLaneId, 10) === lane.id) item.classList.add('is-selected');
            item.dataset.laneId = lane.id;
            item.draggable = true;

            const laneColorStyle = lane.baseColor ? `background-color: ${lane.baseColor}` : `background-color: ${PALETTE[index % PALETTE.length]}`;

            // Replaced input with div.lane-name-div
            item.innerHTML = `
                <span class="lane-drag-handle" title="Drag to reorder">⋮⋮</span>
                <button class="lane-color-btn" data-lane-id="${lane.id}" title="Change lane color" style="${laneColorStyle}"></button>
                <div class="lane-name-div" data-lane-id="${lane.id}">${escapeHtml(lane.name).replace(/\n/g, '<br>')}</div>
            `;

            // Add click listener to open properties on the item (excluding controls)
            item.addEventListener('click', (e) => {
                if (e.target.closest('.inline-delete-overlay')) return;
                if (e.target.closest('.lane-color-btn')) return;
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

        // Attach lane drag/drop ordering handlers in V2 as well.
        setupLaneDragAndDrop();
        syncSelectedLaneUI();

        // Lane color swatch should open lane properties in V2
        container.querySelectorAll('.lane-color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isEditingAllowed()) return;
                const laneId = parseInt(e.target.dataset.laneId, 10);
                showLanePropertiesPanel(laneId);
            });
        });

        // Invoke global drag init if available (legacy hook)
        if (typeof initDragAndDrop === 'function') initDragAndDrop();
    };

    // Override renderLanesCanvas for strict timeline duration
    const _origRenderLanesCanvas = renderLanesCanvas;
    renderLanesCanvas = function () {
        if (!V2.isV2) { _origRenderLanesCanvas(); return; }

        const canvas = app.elements.lanesCanvas;

        // Remove lane-row children but preserve the SVG overlay element
        Array.from(canvas.children).forEach(child => {
            if (child.id !== 'alignment-canvas-overlay') {
                canvas.removeChild(child);
            }
        });

        // STRICT DURATION LOGIC
        // User wants: Duration value MUST affect design area first.
        // But also "Prevent design area from being decreased below end-time of last box"

        const totalDuration = app.diagram.getTotalDuration();
        const settingsDuration = app.settings.timelineDuration || 8000;

        if (totalDuration > settingsDuration) {
            app.settings.timelineDuration = totalDuration;
            const durationInput = document.getElementById('config-timeline-duration');
            if (durationInput) durationInput.value = formatMsForInput(totalDuration);
        }

        const minTrackWidth = msToPixels(getDisplayTimelineEndTimeMs());

        app.diagram.lanes.forEach(lane => {
            const row = document.createElement('div');
            row.className = 'lane-row';
            if (parseInt(app.selectedLaneId, 10) === lane.id) row.classList.add('is-selected');
            row.dataset.laneId = lane.id;
            // Min-width for scrolling - considering sticky label
            // Note: If labels are hidden, --lane-label-width is 0px
            row.style.minWidth = `calc(var(--lane-label-width) + ${minTrackWidth}px)`;

            const label = document.createElement('div');
            label.className = 'lane-label';
            if (parseInt(app.selectedLaneId, 10) === lane.id) label.classList.add('is-selected');
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
        renderAlignmentCanvasOverlay();
        renderTimeMarkers();
        Minimap.render();
        syncSelectedLaneUI();
        syncZoomFitIndicator();
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
            // Recalculate alignment overlay positioning based on lane-labels visibility
            renderAlignmentCanvasOverlay();
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

    function runWhenV2Ready(callback) {
        if (V2.isV2) {
            callback();
            return;
        }
        requestAnimationFrame(() => runWhenV2Ready(callback));
    }

    // Initialize once V2 has been activated.
    document.addEventListener('DOMContentLoaded', () => {
        runWhenV2Ready(() => {
            initScrollSync();
            initCompactView();
        });
    }, { once: true });

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
        durationInput.value = formatMsForInput(app.settings.timelineDuration);

        // Listen for input changes (User changes duration manually)
        durationInput.addEventListener('change', () => {
            let val = parseInputToMs(durationInput.value, {
                fallbackMs: app.settings.timelineDuration,
                minMs: 1000
            });
            const totalDur = app.diagram.getTotalDuration();

            // Allow user to set larger, but not smaller than total content
            if (val < totalDur) {
                // Determine if we should warn or just clamp. User said "Cannot be less than last box end" in HTML.
                // But user also said "If the working area is expanded automatically... change the size of the option"
                val = totalDur;
                durationInput.value = formatMsForInput(val);
                showToast({ type: 'info', title: 'Duration Adjusted', message: `Minimum duration is ${formatDuration(totalDur)} based on existing boxes.` });
            }

            app.settings.timelineDuration = val;
            durationInput.value = formatMsForInput(val);
            renderLanesCanvas();
            renderTimelineRuler();
            renderTimeMarkers();
            Minimap.render();
            autoSave();
        });

        // Auto-expansion sync is handled inside the V2 renderLanesCanvas override.
    }

    // 2. COMPACT VIEW ALIGNMENT
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
                // Force full re-layout on next frame.
                requestAnimationFrame(() => {
                    renderTimelineRuler();
                    renderLanesCanvas();
                    renderTimeMarkers();
                    const canvas = document.getElementById('lanes-canvas');
                    if (canvas) canvas.dispatchEvent(new Event('scroll'));
                });
            });
        }
    }

    function runWhenV2Ready(callback) {
        if (V2.isV2) {
            callback();
            return;
        }
        requestAnimationFrame(() => runWhenV2Ready(callback));
    }

    // Initialize once V2 has been activated.
    document.addEventListener('DOMContentLoaded', () => {
        runWhenV2Ready(() => {
            initDurationSync();
            initCompactViewFix();
        });
    }, { once: true });

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
        bindLaneNameInputOnce();
    }

    // 2. Duration Sync Fix (Ruler Loop & Validation)
    // Override both renderTimelineRuler and renderTimeMarkers
    const _origRenderTimelineRuler = renderTimelineRuler;
    renderTimelineRuler = function () {
        if (!V2.isV2) { _origRenderTimelineRuler(); return; }
        const ruler = app.elements.timelineRuler;
        if (!ruler) return;
        ruler.innerHTML = '';

        const endTime = getDisplayTimelineEndTimeMs();
        const interval = getAdaptiveRulerInterval(endTime);
        const rulerWidth = msToPixels(endTime);

        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'timeline-ruler-inner';
        innerWrapper.style.position = 'relative';
        innerWrapper.style.width = `${rulerWidth}px`;
        innerWrapper.style.height = '100%';
        ruler.appendChild(innerWrapper);

        if (Compression.enabled) {
            const breakMarkers = Compression.getBreakMarkers();

            // Draw marks at compressed positions while showing actual times.
            for (let tickIndex = 0, compressedTime = 0; compressedTime <= endTime + (interval * 0.0001); tickIndex++, compressedTime = tickIndex * interval) {
                const actualTime = Compression.compressedToActual(compressedTime);
                const mark = document.createElement('div');
                mark.className = 'ruler-mark' + (isMajorRulerTickMs(actualTime, interval) ? ' major' : '');
                mark.style.left = `${msToPixels(compressedTime)}px`;
                mark.innerHTML = `<span>${formatDuration(actualTime)}</span>`;
                innerWrapper.appendChild(mark);
            }

            // Restore orange compression break lines and labels on ruler.
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
            // Correct loop logic
            for (let tickIndex = 0, time = 0; time <= endTime + (interval * 0.0001); tickIndex++, time = tickIndex * interval) {
                const mark = document.createElement('div');
                mark.className = 'ruler-mark' + (isMajorRulerTickMs(time, interval) ? ' major' : '');
                mark.style.left = `${msToPixels(time)}px`;
                mark.innerHTML = `<span>${formatDuration(time)}</span>`;
                innerWrapper.appendChild(mark);
            }
        }
    };

    const _origRenderTimeMarkers = renderTimeMarkers;
    renderTimeMarkers = function () {
        if (!V2.isV2) { _origRenderTimeMarkers(); return; }
        const container = app.elements.timeMarkers;
        if (!container) return;
        container.innerHTML = '';

        const endTime = getDisplayTimelineEndTimeMs();
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
            const edges = getRenderedBoxEdges(box);
            const actualStart = box.startOffset;
            const actualEnd = box.startOffset + box.duration;
            markers.push({ visualX: edges.leftPx, actualTime: actualStart, type: 'start', boxId: box.id, color: box.color, label: formatDuration(actualStart) });
            markers.push({ visualX: edges.rightPx, actualTime: actualEnd, type: 'end', boxId: box.id, color: box.color, label: formatDuration(actualEnd) });
        });
        markers.sort((a, b) => a.visualX - b.visualX);

        const levels = [];
        const charWidth = 7;
        const padding = 10;
        markers.forEach(m => {
            const x = m.visualX;
            const text = `${m.type === 'start' ? 'S' : 'E'}: ${m.label}`;
            const width = text.length * charWidth + padding;
            const startX = x + 2;
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
            const x = m.visualX;
            const el = document.createElement('div');
            el.className = 'time-marker-h';
            el.style.left = `${x}px`;
            el.style.bottom = `${4 + (m.level * 16)}px`;
            el.style.color = m.color;
            const line = document.createElement('div');
            line.className = 'time-marker-line';
            line.style.backgroundColor = m.color;
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
    };

    // 4. Default Trailing Space = 0
    function initTrailingSpace() {
        const trailingValue = Math.max(0, parseInt(app.settings.trailingSpace, 10) || 0);
        app.settings.trailingSpace = trailingValue;

        const trailingInput = document.getElementById('config-trailing-space');
        if (trailingInput) trailingInput.value = formatMsForInput(trailingValue);

        const trailingSlider = document.getElementById('config-trailing-slider');
        if (trailingSlider) trailingSlider.value = trailingValue;
    }

    function runWhenV2Ready(callback) {
        if (V2.isV2) {
            callback();
            return;
        }
        requestAnimationFrame(() => runWhenV2Ready(callback));
    }

    document.addEventListener('DOMContentLoaded', () => {
        runWhenV2Ready(() => {
            initLaneNameInput();
            initTrailingSpace();
        });
    }, { once: true });

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

            // 4. Update Properties Panel ONLY if it is already open AND not actively dragging/resizing
            const sidebar = document.getElementById('right-sidebar');
            const isActive = sidebar && sidebar.classList.contains('visible');

            if (isActive && !app.isActivelyDraggingOrResizing) {
                // If open and not dragging, update values
                if (typeof updatePropertiesPanel === 'function') {
                    updatePropertiesPanel(isNewBox);
                }
            } else {
                // If closed or actively dragging/resizing, DO NOT call updatePropertiesPanel,
                // because updatePropertiesPanel (V2 version) has logic to auto-open it.
                // By skipping it, we keep the sidebar closed during drag/resize.
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
        app.isActivelyDraggingOrResizing = true;
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

        // 4. Update panel ONLY if it is already open (visible) AND not actively dragging/resizing
        const sidebar = document.getElementById('right-sidebar');
        if (sidebar && sidebar.classList.contains('visible') && !app.isActivelyDraggingOrResizing) {
            updatePropertiesPanel();
        } else {
            // Ensure it remains closed during resize (do nothing)
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

// =====================================================
// Floating Properties Card (Timeline Precision Design)
// =====================================================

(function () {

    const PropertiesCard = {
        card: null,
        closeBtn: null,
        boxSection: null,
        laneSection: null,
        currentMode: null, // 'box', 'lane', or null

        init() {
            this.card = document.getElementById('properties-card');
            this.closeBtn = document.getElementById('properties-close-btn');
            this.boxSection = document.getElementById('box-properties-section');
            this.laneSection = document.getElementById('lane-properties-section');

            if (!this.card) return;

            // Close button listener
            this.closeBtn.addEventListener('click', () => this.hide());

            // Input listeners for box properties
            const boxLabel = document.getElementById('props-box-label');
            const boxStart = document.getElementById('props-box-start');
            const boxDuration = document.getElementById('props-box-duration');
            const boxColor = document.getElementById('props-box-color');

            if (boxLabel) boxLabel.addEventListener('change', () => this.updateBoxProperty('label'));
            if (boxStart) boxStart.addEventListener('change', () => this.updateBoxProperty('start'));
            if (boxDuration) boxDuration.addEventListener('change', () => this.updateBoxProperty('duration'));
            if (boxColor) boxColor.addEventListener('change', () => this.updateBoxProperty('color'));

            // Input listeners for lane properties
            const laneName = document.getElementById('props-lane-name');
            const laneColor = document.getElementById('props-lane-color');

            if (laneName) laneName.addEventListener('change', () => this.updateLaneProperty('name'));
            if (laneColor) laneColor.addEventListener('change', () => this.updateLaneProperty('color'));
        },

        showBox(boxId) {
            const box = app.diagram.boxes.find(b => b.id === boxId);
            if (!box) {
                this.hide();
                return;
            }

            this.currentMode = 'box';
            const baseTime = parseTime(app.diagram.startTime);
            const absoluteStart = formatTime(baseTime + box.startOffset);

            // Populate fields
            document.getElementById('props-box-label').value = box.label || '';
            document.getElementById('props-box-start').value = formatMsForInput(box.startOffset);
            document.getElementById('props-box-duration').value = formatMsForInput(box.duration);
            document.getElementById('props-box-color').value = box.color;
            document.getElementById('props-duration-display').textContent = formatDuration(box.duration);
            document.getElementById('props-absolute-time').textContent = absoluteStart;

            // Show/hide sections
            this.boxSection.classList.remove('hidden');
            this.laneSection.classList.add('hidden');

            this.show();
        },

        showLane(laneId) {
            const lane = app.diagram.lanes.find(l => l.id === parseInt(laneId));
            if (!lane) {
                this.hide();
                return;
            }

            this.currentMode = 'lane';

            // Populate fields
            document.getElementById('props-lane-name').value = lane.name || '';
            document.getElementById('props-lane-color').value = lane.baseColor;

            // Show/hide sections
            this.boxSection.classList.add('hidden');
            this.laneSection.classList.remove('hidden');

            this.show();
        },

        show() {
            if (this.card) {
                this.card.classList.remove('hidden');
            }
        },

        hide() {
            if (this.card) {
                this.card.classList.add('hidden');
            }
            this.currentMode = null;
        },

        updateBoxProperty(property) {
            if (this.currentMode !== 'box' || !app.selectedBoxId) return;

            const box = app.diagram.boxes.find(b => b.id === app.selectedBoxId);
            if (!box) return;

            const boxStart = document.getElementById('props-box-start');
            const boxDuration = document.getElementById('props-box-duration');
            const boxLabel = document.getElementById('props-box-label');
            const boxColor = document.getElementById('props-box-color');

            if (property === 'label') {
                box.label = boxLabel.value;
            } else if (property === 'start') {
                box.startOffset = parseBoxInputToMs(boxStart.value, { fallbackMs: 0, minMs: 0 });
            } else if (property === 'duration') {
                const minDurationMs = Math.max(MIN_BOX_DURATION_MS, getBoxStepMs());
                box.duration = parseBoxInputToMs(boxDuration.value, {
                    fallbackMs: minDurationMs,
                    minMs: minDurationMs
                });
            } else if (property === 'color') {
                box.color = boxColor.value;
            }

            // Update display
            const baseTime = parseTime(app.diagram.startTime);
            document.getElementById('props-duration-display').textContent = formatDuration(box.duration);
            document.getElementById('props-absolute-time').textContent = formatTime(baseTime + box.startOffset);

            // Refresh UI
            renderTimelineRuler();
            renderLanesCanvas();
            renderTimeMarkers();
            renderAlignmentCanvasOverlay();
            autoSave();
        },

        updateLaneProperty(property) {
            if (this.currentMode !== 'lane' || !app.selectedLaneId) return;

            const lane = app.diagram.lanes.find(l => l.id === parseInt(app.selectedLaneId));
            if (!lane) return;

            const laneName = document.getElementById('props-lane-name');
            const laneColor = document.getElementById('props-lane-color');

            if (property === 'name') {
                lane.name = laneName.value;
            } else if (property === 'color') {
                lane.baseColor = laneColor.value;
            }

            // Refresh UI
            renderLaneList();
            renderLanesCanvas();
            renderAlignmentCanvasOverlay();
            autoSave();
        }
    };

    // Initialize when DOM is ready
    PropertiesCard.init();

    // Export for use in selectBox
    window.PropertiesCard = PropertiesCard;

})();

// =====================================================
// Alignment Canvas Overlay - Scrollable alignment lines
// =====================================================

(function () {

    // Function to render alignment lines on the overlay SVG
    window.renderAlignmentCanvasOverlay = function() {
        const overlay = document.getElementById('alignment-canvas-overlay');
        const lanesCanvas = document.getElementById('lanes-canvas');
        
        if (!overlay || !lanesCanvas) return;

        // Clear existing lines
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

        // Check setting and boxes exist
        if (!app.settings.showAlignmentLines || app.diagram.boxes.length === 0) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'block';

        // Collapse SVG before measuring so it doesn't inflate scrollWidth/Height
        overlay.setAttribute('width', 0);
        overlay.setAttribute('height', 0);

        // Get lane-label width offset (SVG is positioned at left: var(--lane-label-width))
        const labelWidth = getLaneLabelWidthPx();

        // Set overlay dimensions to match the lane-track area (not full canvas)
        const canvasHeight = lanesCanvas.scrollHeight;
        const canvasWidth = lanesCanvas.scrollWidth - labelWidth;

        overlay.setAttribute('width', canvasWidth);
        overlay.setAttribute('height', canvasHeight);

        // Render per-box owned lines from the box bottom downward only.
        const laneHeight = getLaneHeightPx();
        const lineBottom = canvasHeight;
        const boxBottomInsetPx = 6;

        app.diagram.boxes.forEach(box => {
            const laneIndex = app.diagram.lanes.findIndex(l => l.id === box.laneId);
            if (laneIndex < 0) return;

            const lineTop = Math.max(0, (laneIndex * laneHeight) + laneHeight - boxBottomInsetPx);
            if (lineTop >= lineBottom) return;

            const edges = getRenderedBoxEdges(box);
            const xPositions = [edges.leftPx, edges.rightPx];

            xPositions.forEach(xPos => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', xPos);
                line.setAttribute('y1', lineTop);
                line.setAttribute('x2', xPos);
                line.setAttribute('y2', lineBottom);
                line.setAttribute('stroke', box.color);
                line.setAttribute('stroke-width', '1.5');
                line.setAttribute('stroke-dasharray', '4 4');
                line.setAttribute('opacity', '0.7');
                line.setAttribute('class', 'alignment-line');
                overlay.appendChild(line);
            });
        });
    };

})();
