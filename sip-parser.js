// SIP Log Parser - Redesigned UI
// Parses SIP logs, Events, and Requests - saves to Timeline Diagram app storage

const SIP_PARSER_VERSION = '2.0.0';

// =====================================================
// Constants
// =====================================================
const STORAGE_KEY = 'timeline_diagrams';
const SIP_LOGS_KEY = 'sip_saved_logs';
const MAX_DIAGRAMS = 10;
const MAX_SAVED_LOGS = 20;

const CID_COLORS = [
    '#60a5fa', '#a78bfa', '#22d3ee', '#f472b6', '#2dd4bf',
    '#c084fc', '#38bdf8', '#818cf8', '#e879f9', '#67e8f9'
];

// Hex CID colors to rgba for delta badge backgrounds
function cidColorToRgba(hexColor, alpha) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// =====================================================
// State
// =====================================================
let parsedMessages = [];
let cidMap = new Map();
let connidMap = new Map();
let refidMap = new Map();

let filters = {
    showSip: true,
    showEvents: true,
    showRequests: true,
    enabledCids: new Set(),
};

let eventsGridData = {
    messages: [],
    dnColumns: [],
    switchColumn: null,
    hasNoDnColumn: false,
    connids: []
};

let currentView = 'messages'; // 'messages' | 'dn-grid'
let isParsed = false;
let isInputExpanded = false;
let showElapsed = true;
let showPerCid = true;
let showCrossCid = false;
let compactView = false;
// Per-view bookmark state (separate dictionaries)
let sipSpanBookmarks = [];   // Array of { timestamp, timeStr, element }
let kazimirBookmarks = [];   // Array of { timestamp, timeStr, element }
let pendingSipBookmarks = []; // Message IDs to restore after render
let pendingKazimirBookmarks = [];

// =====================================================
// Parsing Functions (from sip-parser.js - unchanged)
// =====================================================

function parseSipTimestamp(timeStr) {
    const [hours, minutes, secondsMs] = timeStr.split(':');
    const [seconds, ms] = secondsMs.split('.');
    return (parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)) * 1000 + parseInt(ms);
}

function parseSipLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const sipMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(<-|->)(\d{3}|\w+)\s+\[([^\]]+)\](.*)$/);

    if (sipMatch) {
        const [, timestamp, direction, method, bracketed, rest] = sipMatch;

        const fromMatch = bracketed.match(/f:\s*([^|]*)/);
        const toMatch = bracketed.match(/t:\s*([^|]*)/);
        const cseqMatch = bracketed.match(/cs:\s*(\d+)\s+(\w+)/);
        const cidMatch = bracketed.match(/\|\s*([A-Za-z][\w-]*\d+)\s*$/);

        const contentMatch = rest.trim().match(/^(application\/[\w.-]+|text\/[\w.-]+)/);

        const from = fromMatch ? fromMatch[1].trim() : '';
        const to = toMatch ? toMatch[1].trim() : '';
        const cseq = cseqMatch ? parseInt(cseqMatch[1]) : null;
        const cseqMethod = cseqMatch ? cseqMatch[2] : '';
        const cid = cidMatch ? cidMatch[1] : '';
        const content = contentMatch ? contentMatch[1] : '';

        const isResponse = /^\d{3}$/.test(method);

        return {
            type: 'sip',
            timestamp: parseSipTimestamp(timestamp),
            timeStr: timestamp,
            direction,
            method,
            isResponse,
            from,
            to,
            cseq,
            cseqMethod,
            cid,
            content,
            raw: trimmed
        };
    }

    const eventMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(Event\w+)\(([^)]*)\)/);
    if (eventMatch) {
        const [, timestamp, eventType, params] = eventMatch;
        const parsed = parseEventParams(params);
        return {
            type: 'event',
            timestamp: parseSipTimestamp(timestamp),
            timeStr: timestamp,
            direction: '->',
            eventType,
            dn: parsed.dn,
            odn: parsed.odn,
            connid: parsed.connid,
            refid: parsed.refid,
            msgid: parsed.msgid,
            raw: trimmed
        };
    }

    const requestMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(Request\w+)\(([^)]*)\)/);
    if (requestMatch) {
        const [, timestamp, requestType, params] = requestMatch;
        const parsed = parseEventParams(params);
        return {
            type: 'request',
            timestamp: parseSipTimestamp(timestamp),
            timeStr: timestamp,
            direction: '<-',
            eventType: requestType,
            dn: parsed.dn,
            odn: parsed.odn,
            connid: parsed.connid,
            refid: parsed.refid,
            msgid: parsed.msgid,
            raw: trimmed
        };
    }

    return null;
}

function parseEventParams(params) {
    const result = { dn: '', odn: '', connid: '', refid: '', msgid: '' };

    const dnMatch = params.match(/dn='?([^'|]*)'?\|/);
    if (dnMatch) result.dn = dnMatch[1] === 'null' ? '' : dnMatch[1];

    const odnMatch = params.match(/odn='?([^'|]*)'?\|/);
    if (odnMatch) result.odn = odnMatch[1] === 'null' ? '' : odnMatch[1];

    const connidMatch = params.match(/connid=([^|]*)\|/);
    if (connidMatch) result.connid = connidMatch[1];

    const refidMatch = params.match(/refid=([^|]*)\|/);
    if (refidMatch) result.refid = refidMatch[1];

    const msgidMatch = params.match(/msgid=([^)]*)/);
    if (msgidMatch) result.msgid = msgidMatch[1];

    return result;
}

function parseSipLog(log) {
    const lines = log.split('\n');
    const messages = [];
    cidMap.clear();
    connidMap.clear();
    refidMap.clear();
    let cidIndex = 0;
    let connidIndex = 0;

    for (const line of lines) {
        const msg = parseSipLine(line);
        if (msg) {
            if (msg.type === 'sip' && msg.cid && !cidMap.has(msg.cid)) {
                cidMap.set(msg.cid, cidIndex % 10);
                cidIndex++;
            }
            if ((msg.type === 'event' || msg.type === 'request') && msg.connid && !connidMap.has(msg.connid)) {
                connidMap.set(msg.connid, connidIndex % 10);
                connidIndex++;
            }
            if (msg.refid && msg.refid !== '' && msg.refid !== '4294967295') {
                if (!refidMap.has(msg.refid)) {
                    refidMap.set(msg.refid, []);
                }
                refidMap.get(msg.refid).push(msg);
            }
            messages.push(msg);
        }
    }

    // Assign unique IDs to each message for bookmark matching
    for (let i = 0; i < messages.length; i++) {
        messages[i]._id = i;
    }

    const lastTimeByCid = new Map();
    const lastTimeByRefid = new Map();

    for (const msg of messages) {
        if (msg.type === 'sip') {
            if (msg.cid) {
                const lastTime = lastTimeByCid.get(msg.cid);
                msg.delta = lastTime !== undefined ? msg.timestamp - lastTime : null;
                lastTimeByCid.set(msg.cid, msg.timestamp);
            } else {
                msg.delta = null;
            }
        } else {
            if (msg.refid && msg.refid !== '' && msg.refid !== '4294967295') {
                const lastTime = lastTimeByRefid.get(msg.refid);
                msg.delta = lastTime !== undefined ? msg.timestamp - lastTime : null;
                lastTimeByRefid.set(msg.refid, msg.timestamp);
            } else {
                msg.delta = null;
            }
        }
    }

    return messages;
}

// =====================================================
// Events/Requests DN Grid Parsing (from sip-parser.js)
// =====================================================

function parseEventsRequestsOnly(log) {
    const lines = log.split('\n');
    const messages = [];
    const dnSet = new Map();
    const connidSet = new Set();
    let dnOrder = 0;
    let hasNoDn = false;
    let switchName = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const eventMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(Event\w+)\(([^)]*)\)/);
        if (eventMatch) {
            const [, timestamp, eventType, params] = eventMatch;
            const parsed = parseEventParams(params);
            const dn = parsed.dn;

            if (dn && dn.endsWith('::')) {
                switchName = dn;
            } else if (dn && dn !== 'null' && dn !== '') {
                if (!dnSet.has(dn)) {
                    dnSet.set(dn, dnOrder++);
                }
            } else {
                hasNoDn = true;
            }

            if (parsed.connid) connidSet.add(parsed.connid);

            messages.push({
                type: 'event',
                timestamp: parseSipTimestamp(timestamp),
                timeStr: timestamp,
                eventType,
                dn: dn || '',
                isSwitch: dn && dn.endsWith('::'),
                connid: parsed.connid,
                refid: parsed.refid,
                raw: trimmed
            });
            continue;
        }

        const requestMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(Request\w+)\(([^)]*)\)/);
        if (requestMatch) {
            const [, timestamp, requestType, params] = requestMatch;
            const parsed = parseEventParams(params);
            const dn = parsed.dn;

            if (dn && dn.endsWith('::')) {
                switchName = dn;
            } else if (dn && dn !== 'null' && dn !== '') {
                if (!dnSet.has(dn)) {
                    dnSet.set(dn, dnOrder++);
                }
            } else {
                hasNoDn = true;
            }

            if (parsed.connid) connidSet.add(parsed.connid);

            messages.push({
                type: 'request',
                timestamp: parseSipTimestamp(timestamp),
                timeStr: timestamp,
                eventType: requestType,
                dn: dn || '',
                isSwitch: dn && dn.endsWith('::'),
                connid: parsed.connid,
                refid: parsed.refid,
                raw: trimmed
            });
        }
    }

    // Assign unique IDs for bookmark matching
    for (let i = 0; i < messages.length; i++) {
        messages[i]._id = 'dn_' + i;
    }

    let lastTime = null;
    const refidRequestTime = new Map();

    for (const msg of messages) {
        msg.deltaPrev = lastTime !== null ? msg.timestamp - lastTime : null;
        lastTime = msg.timestamp;

        msg.deltaRefid = null;
        if (msg.refid && msg.refid !== '' && msg.refid !== '4294967295') {
            if (msg.type === 'request') {
                if (!refidRequestTime.has(msg.refid)) {
                    refidRequestTime.set(msg.refid, msg.timestamp);
                }
            } else if (msg.type === 'event') {
                const reqTime = refidRequestTime.get(msg.refid);
                if (reqTime !== undefined) {
                    msg.deltaRefid = msg.timestamp - reqTime;
                }
            }
        }
    }

    const dnColumns = [...dnSet.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([dn]) => dn);

    eventsGridData = {
        messages,
        dnColumns,
        switchColumn: switchName,
        hasNoDnColumn: hasNoDn,
        connids: [...connidSet]
    };

    return eventsGridData;
}

// =====================================================
// Utility Functions
// =====================================================

function formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    return (ms / 60000).toFixed(1) + 'm';
}

function getDeltaClass(delta) {
    if (delta === null) return 'first';
    if (delta < 100) return 'fast';
    if (delta < 500) return 'medium';
    return 'slow';
}

function createSpeedDots(deltaClass) {
    if (deltaClass === 'first') return null;
    var container = document.createElement('span');
    container.className = 'speed-dots';
    var dotCount = deltaClass === 'fast' ? 1 : deltaClass === 'medium' ? 2 : 3;
    var color = deltaClass === 'fast' ? 'var(--success)' : deltaClass === 'medium' ? 'var(--warning)' : 'var(--danger)';
    for (var i = 0; i < dotCount; i++) {
        var dot = document.createElement('span');
        dot.className = 'speed-dot';
        dot.style.background = color;
        container.appendChild(dot);
    }
    return container;
}

function computeCrossCidDeltas(messages) {
    // Compute deltas across the already-filtered message list
    // Each message's crossDelta = time since previous message in this filtered set
    var lastTimestamp = null;
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        msg.crossDelta = lastTimestamp !== null ? msg.timestamp - lastTimestamp : null;
        lastTimestamp = msg.timestamp;
    }
}

function getMethodClass(method, isResponse) {
    if (isResponse) return 'method-response';
    const m = method.toLowerCase();
    if (m === 'invite') return 'method-invite';
    if (m === 'ack') return 'method-ack';
    if (m === 'bye') return 'method-bye';
    if (m === 'cancel') return 'method-cancel';
    if (m === 'info') return 'method-info';
    if (m === 'notify') return 'method-notify';
    return '';
}

function getTypeBadge(type) {
    if (type === 'sip') return '<span class="type-badge type-sip">SIP</span>';
    if (type === 'event') return '<span class="type-badge type-event">EVT</span>';
    if (type === 'request') return '<span class="type-badge type-request">REQ</span>';
    return '';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// =====================================================
// Theme Toggle
// =====================================================

function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById('theme-toggle-btn');
    if (body.classList.contains('dark-theme')) {
        body.classList.replace('dark-theme', 'light-theme');
        btn.textContent = '\u2600'; // sun
        localStorage.setItem('sip_parser_theme', 'light');
    } else {
        body.classList.replace('light-theme', 'dark-theme');
        btn.textContent = '\u263E'; // moon
        localStorage.setItem('sip_parser_theme', 'dark');
    }
}

function restoreTheme() {
    const saved = localStorage.getItem('sip_parser_theme');
    if (saved === 'light') {
        document.body.classList.replace('dark-theme', 'light-theme');
        document.getElementById('theme-toggle-btn').textContent = '\u2600';
    }
}

// =====================================================
// Collapsible Input
// =====================================================

function toggleInputSection() {
    const section = document.getElementById('input-section');
    const chevron = document.getElementById('input-chevron');
    isInputExpanded = !isInputExpanded;

    if (isInputExpanded) {
        section.classList.remove('collapsed');
        chevron.classList.add('open');
    } else {
        section.classList.add('collapsed');
        chevron.classList.remove('open');
    }
}

function collapseInput() {
    const section = document.getElementById('input-section');
    const chevron = document.getElementById('input-chevron');
    isInputExpanded = false;
    section.classList.add('collapsed');
    chevron.classList.remove('open');
}

function expandInput() {
    const section = document.getElementById('input-section');
    const chevron = document.getElementById('input-chevron');
    isInputExpanded = true;
    section.classList.remove('collapsed');
    chevron.classList.add('open');
}

// =====================================================
// Toast Notifications
// =====================================================

function showToast(message, type, duration) {
    if (type === undefined) type = 'info';
    if (duration === undefined) duration = 3000;
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = message;
    container.appendChild(toast);

    if (duration > 0) {
        setTimeout(function() {
            toast.classList.add('toast-exit');
            setTimeout(function() { toast.remove(); }, 200);
        }, duration);
    }

    return toast;
}

// =====================================================
// Saved Logs Modal
// =====================================================

function openSavedLogsModal() {
    renderSavedLogs();
    document.getElementById('saved-logs-modal').classList.remove('hidden');
}

function closeSavedLogsModal() {
    document.getElementById('saved-logs-modal').classList.add('hidden');
}

function openHelpModal() {
    document.getElementById('help-modal').classList.remove('hidden');
}

function closeHelpModal() {
    document.getElementById('help-modal').classList.add('hidden');
}

function getSavedLogs() {
    try {
        const data = localStorage.getItem(SIP_LOGS_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('Failed to load saved logs:', e);
        return [];
    }
}

function saveLogs(logs) {
    try {
        localStorage.setItem(SIP_LOGS_KEY, JSON.stringify(logs));
        return true;
    } catch (e) {
        console.error('Failed to save logs:', e);
        return false;
    }
}

function updateSavedBadge() {
    const logs = getSavedLogs();
    const badge = document.getElementById('saved-badge');
    badge.textContent = logs.length;
    badge.classList.toggle('empty', logs.length === 0);
    // Disable save button if storage is full
    var saveBtn = document.getElementById('save-log-btn');
    if (saveBtn && isParsed) {
        saveBtn.disabled = logs.length >= MAX_SAVED_LOGS;
        saveBtn.title = logs.length >= MAX_SAVED_LOGS
            ? 'Storage full (' + MAX_SAVED_LOGS + ' logs). Delete some logs first.'
            : 'Save current log as new entry';
    }
}

function renderSavedLogs() {
    const logs = getSavedLogs();
    const list = document.getElementById('saved-list');

    if (logs.length === 0) {
        list.textContent = '';
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'modal-empty';
        emptyDiv.textContent = 'No saved logs';
        list.appendChild(emptyDiv);
        updateSavedBadge();
        return;
    }

    // Build saved items using DOM methods
    list.textContent = '';
    logs.forEach(function(log) {
        const date = new Date(log.savedAt);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const cidPreview = log.cids ? log.cids.join(', ') : '';

        const item = document.createElement('div');
        item.className = 'saved-item';
        item.addEventListener('click', function() { loadSavedLog(log.id); });

        const info = document.createElement('div');
        info.className = 'saved-item-info';

        const title = document.createElement('div');
        title.className = 'saved-item-title';
        title.textContent = log.messageCount + ' messages \u00B7 ' + log.cidCount + ' CIDs';

        const meta = document.createElement('div');
        meta.className = 'saved-item-meta';
        meta.textContent = dateStr + (cidPreview ? ' \u00B7 ' + cidPreview : '');

        info.appendChild(title);
        info.appendChild(meta);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'saved-item-delete';
        deleteBtn.title = 'Delete';
        deleteBtn.textContent = '\u2715';
        deleteBtn.addEventListener('click', function(event) {
            deleteSavedLog(log.id, event);
        });

        item.appendChild(info);
        item.appendChild(deleteBtn);
        list.appendChild(item);
    });

    updateSavedBadge();
}

function saveCurrentLog() {
    const input = document.getElementById('sip-input').value.trim();
    if (!input || parsedMessages.length === 0) return;

    const logs = getSavedLogs();

    // Prevent duplicate save for unchanged content
    if (logs.some(function(l) { return l.content === input; })) {
        showToast('This log is already saved', 'info');
        return;
    }

    // Prevent save if storage is full
    if (logs.length >= MAX_SAVED_LOGS) {
        showToast('Storage full (' + MAX_SAVED_LOGS + ' logs). Delete some first.', 'error');
        return;
    }

    const cids = [...cidMap.keys()];

    var ids = getBookmarkIdsForSave();
    const newLog = {
        id: 'log_' + Date.now(),
        savedAt: Date.now(),
        messageCount: parsedMessages.length,
        cidCount: cids.length,
        cids: cids.slice(0, 5),
        content: input,
        sipBookmarks: ids.sipIds,
        kazimirBookmarks: ids.kazIds
    };

    logs.unshift(newLog);

    if (saveLogs(logs)) {
        updateSavedBadge();
        showToast('Log saved', 'success');
    }
}

function loadSavedLog(logId) {
    const logs = getSavedLogs();
    const log = logs.find(function(l) { return l.id === logId; });
    if (log) {
        document.getElementById('sip-input').value = log.content;
        // Clear current bookmarks before loading new file
        sipSpanBookmarks = [];
        kazimirBookmarks = [];
        pendingSipBookmarks = log.sipBookmarks || log.bookmarks || [];
        pendingKazimirBookmarks = log.kazimirBookmarks || [];
        closeSavedLogsModal();
        expandInput();
        handleParseAction();
    }
}

function deleteSavedLog(logId, event) {
    event.stopPropagation();
    const logs = getSavedLogs().filter(function(l) { return l.id !== logId; });
    saveLogs(logs);
    renderSavedLogs();
}

function clearAllSavedLogs() {
    if (!confirm('Delete all saved logs?')) return;
    saveLogs([]);
    renderSavedLogs();
}

// =====================================================
// Combined Info Bar
// =====================================================

function renderInfoBar() {
    const infoBar = document.getElementById('info-bar');

    // Gather stats from both parse paths
    const sipMessages = parsedMessages.filter(function(m) { return m.type === 'sip'; });
    const events = parsedMessages.filter(function(m) { return m.type === 'event'; });
    const requests = parsedMessages.filter(function(m) { return m.type === 'request'; });
    const cids = [...cidMap.keys()];
    const invites = sipMessages.filter(function(m) { return m.method === 'INVITE'; }).length;

    const connids = eventsGridData.connids.length > 0
        ? eventsGridData.connids
        : [...connidMap.keys()];

    const allEventsRequests = events.concat(requests);
    const errorCount = allEventsRequests.filter(function(m) {
        return m.eventType && m.eventType.toLowerCase().indexOf('error') !== -1;
    }).length;

    let duration = 0;
    if (parsedMessages.length > 1) {
        const times = parsedMessages.map(function(m) { return m.timestamp; });
        duration = Math.max.apply(null, times) - Math.min.apply(null, times);
    }

    // Build info bar using DOM methods
    infoBar.textContent = '';

    function addItem(label, value, valueClass) {
        const span = document.createElement('span');
        span.className = 'info-item';
        const labelEl = document.createElement('span');
        labelEl.className = 'label';
        labelEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.className = 'value' + (valueClass ? ' ' + valueClass : '');
        valueEl.textContent = value;
        span.appendChild(labelEl);
        span.appendChild(valueEl);
        infoBar.appendChild(span);
    }

    function addDivider() {
        const d = document.createElement('span');
        d.className = 'info-divider';
        infoBar.appendChild(d);
    }

    if (connids.length > 0) {
        const connidStr = connids.map(function(c) { return c.length > 16 ? c.slice(-8) : c; }).join(', ');
        const item = document.createElement('span');
        item.className = 'info-item';
        const labelEl = document.createElement('span');
        labelEl.className = 'label';
        labelEl.textContent = 'ConnID:';
        const valueEl = document.createElement('span');
        valueEl.className = 'value connid';
        valueEl.textContent = connidStr;
        valueEl.title = connids.join(', ');
        item.appendChild(labelEl);
        item.appendChild(valueEl);
        infoBar.appendChild(item);
        addDivider();
    }

    addItem('Total:', String(parsedMessages.length));

    if (sipMessages.length > 0) {
        addItem('SIP:', String(sipMessages.length));
    }

    addItem('Events:', String(events.length));
    addItem('Requests:', String(requests.length));
    addItem('Errors:', String(errorCount), errorCount > 0 ? 'error' : '');

    if (cids.length > 0) {
        addDivider();
        if (cids.length === 1) {
            addItem('CID:', cids[0]);
        } else {
            addItem('CIDs:', String(cids.length));
        }
    }

    if (invites > 0) {
        addItem('INVITEs:', String(invites));
    }

    if (duration > 0) {
        addItem('Span:', formatDuration(duration));
    }

    infoBar.classList.remove('hidden');
}

// =====================================================
// View Switching
// =====================================================

function switchToMessagesView() {
    currentView = 'messages';

    document.getElementById('tab-messages').classList.add('active');
    document.getElementById('tab-dn-grid').classList.remove('active');

    document.getElementById('messages-view').classList.remove('hidden');
    document.getElementById('dn-grid-view').classList.add('hidden');

    if (isParsed) {
        document.getElementById('filter-bar').classList.remove('hidden');
        document.getElementById('filter-bar-placeholder').classList.add('hidden');
    }

    // Restore SIP Span bookmarks (stale DOM elements, use pending)
    // Only overwrite pending if there are actual bookmarks to preserve
    if (sipSpanBookmarks.length > 0) {
        pendingSipBookmarks = sipSpanBookmarks.map(function(b) { return b.msgId; });
    }
    sipSpanBookmarks = [];

    renderFilteredGrid();
}

function switchToDnGridView() {
    currentView = 'dn-grid';

    document.getElementById('tab-dn-grid').classList.add('active');
    document.getElementById('tab-messages').classList.remove('active');

    document.getElementById('dn-grid-view').classList.remove('hidden');
    document.getElementById('messages-view').classList.add('hidden');

    // Show placeholder instead of real filter bar
    document.getElementById('filter-bar').classList.add('hidden');
    if (isParsed) {
        document.getElementById('filter-bar-placeholder').classList.remove('hidden');
    }

    // Restore Kazimir bookmarks (stale DOM elements, use pending)
    if (kazimirBookmarks.length > 0) {
        pendingKazimirBookmarks = kazimirBookmarks.map(function(b) { return b.msgId; });
    }
    kazimirBookmarks = [];

    renderEventsRequestsGrid();
}

// =====================================================
// Bookmarking / Row Selection
// =====================================================

function getActiveBookmarks() {
    return currentView === 'messages' ? sipSpanBookmarks : kazimirBookmarks;
}

function setActiveBookmarks(arr) {
    if (currentView === 'messages') { sipSpanBookmarks = arr; }
    else { kazimirBookmarks = arr; }
}

function toggleBookmark(msgId, timestamp, timeStr, rowElement) {
    var rows = getActiveBookmarks();
    var existingIdx = rows.findIndex(function(b) { return b.msgId === msgId; });
    if (existingIdx !== -1) {
        rowElement.classList.remove('bookmarked');
        rows.splice(existingIdx, 1);
    } else {
        rowElement.classList.add('bookmarked');
        rows.push({ msgId: msgId, timestamp: timestamp, timeStr: timeStr, element: rowElement });
    }
    // Sort by timestamp
    rows.sort(function(a, b) { return a.timestamp - b.timestamp; });
    setActiveBookmarks(rows);
    renderBookmarkBar();
    autoSaveBookmarks();
}

function clearBookmarks() {
    var rows = getActiveBookmarks();
    rows.forEach(function(b) {
        if (b.element) b.element.classList.remove('bookmarked');
    });
    setActiveBookmarks([]);
    renderBookmarkBar();
    autoSaveBookmarks();
}

function getBookmarkIdsForSave() {
    // Active view has DOM-bound bookmarks; inactive view has IDs in pending
    var sipIds = sipSpanBookmarks.length > 0
        ? sipSpanBookmarks.map(function(b) { return b.msgId; })
        : pendingSipBookmarks.slice();
    var kazIds = kazimirBookmarks.length > 0
        ? kazimirBookmarks.map(function(b) { return b.msgId; })
        : pendingKazimirBookmarks.slice();
    return { sipIds: sipIds, kazIds: kazIds };
}

function autoSaveBookmarks() {
    // Auto-update bookmarks on the saved log matching current content
    var input = document.getElementById('sip-input').value.trim();
    if (!input) return;
    var logs = getSavedLogs();
    var updated = false;
    var ids = getBookmarkIdsForSave();
    for (var i = 0; i < logs.length; i++) {
        if (logs[i].content === input) {
            logs[i].sipBookmarks = ids.sipIds;
            logs[i].kazimirBookmarks = ids.kazIds;
            updated = true;
            break;
        }
    }
    if (updated) saveLogs(logs);
}

function renderBookmarkBar() {
    // Clear both containers
    var msgContainer = document.getElementById('bookmark-container-messages');
    var dnContainer = document.getElementById('bookmark-container-dn');
    if (msgContainer) msgContainer.textContent = '';
    if (dnContainer) dnContainer.textContent = '';

    var rows = getActiveBookmarks();

    // Target the active view's container
    var bar = currentView === 'messages' ? msgContainer : dnContainer;
    if (!bar) return;

    if (rows.length === 0) {
        var hint = document.createElement('span');
        hint.className = 'bookmark-hint';
        hint.textContent = 'Select a row to calculate custom delta time.';
        bar.appendChild(hint);
        return;
    }

    // Clear button first (left side)
    var clearBtn = document.createElement('button');
    clearBtn.className = 'bookmark-clear';
    clearBtn.textContent = '\u2715';
    clearBtn.title = 'Clear bookmarks';
    clearBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        clearBookmarks();
    });
    bar.appendChild(clearBtn);

    var firstTs = rows[0].timestamp;

    for (var i = 0; i < rows.length; i++) {
        var bm = rows[i];

        if (i > 0) {
            var arrow = document.createElement('span');
            arrow.className = 'bookmark-arrow';
            var stepDelta = bm.timestamp - rows[i - 1].timestamp;
            arrow.textContent = '\u2192 +' + stepDelta + 'ms \u2192';
            bar.appendChild(arrow);
        }

        var item = document.createElement('span');
        item.className = 'bookmark-item';

        var timeSpan = document.createElement('span');
        timeSpan.className = 'bm-time';
        timeSpan.textContent = bm.timeStr;
        item.appendChild(timeSpan);

        if (i > 0) {
            var totalDelta = bm.timestamp - firstTs;
            var totalSpan = document.createElement('span');
            totalSpan.className = 'bm-total';
            totalSpan.textContent = '(\u03A3' + totalDelta + 'ms)';
            item.appendChild(totalSpan);
        }

        bar.appendChild(item);
    }
}

// =====================================================
// Message Grid Rendering (Modified - CID-colored deltas)
// =====================================================

function buildDeltaCell(delta, colorHex, deltaClass) {
    var td = document.createElement('td');
    td.className = 'col-delta';
    var badge = document.createElement('span');
    badge.className = 'delta-badge ' + deltaClass;
    if (delta !== null && colorHex) {
        badge.style.background = cidColorToRgba(colorHex, 0.12);
        badge.style.color = colorHex;
    }
    badge.textContent = delta === null ? '\u2014' : '+' + delta + 'ms';
    var dots = createSpeedDots(deltaClass);
    if (dots) badge.appendChild(dots);
    td.appendChild(badge);
    return td;
}

function buildCrossDeltaCell(crossDelta, colorHex) {
    var td = document.createElement('td');
    td.className = 'col-cross-delta';
    var crossClass = getDeltaClass(crossDelta);
    var badge = document.createElement('span');
    badge.className = 'cross-delta-badge ' + crossClass;
    if (crossDelta !== null && colorHex) {
        badge.style.background = cidColorToRgba(colorHex, 0.12);
        badge.style.color = colorHex;
    }
    badge.textContent = crossDelta === null ? '\u2014' : '+' + crossDelta + 'ms';
    var dots = createSpeedDots(crossClass);
    if (dots) badge.appendChild(dots);
    td.appendChild(badge);
    return td;
}

function renderSipRow(msg, firstTimestamp) {
    var cidIdx = cidMap.get(msg.cid);
    if (cidIdx === undefined) return null;
    var dirClass = msg.direction === '<-' ? 'incoming' : 'outgoing';
    var deltaClass = getDeltaClass(msg.delta);
    var methodClass = getMethodClass(msg.method, msg.isResponse);
    var cidColor = CID_COLORS[cidIdx];

    var tr = document.createElement('tr');
    tr.setAttribute('data-cid', String(cidIdx));
    tr.setAttribute('data-type', 'sip');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function() {
        toggleBookmark(msg._id, msg.timestamp, msg.timeStr, tr);
    });

    // Time
    var tdTime = document.createElement('td');
    tdTime.className = 'col-time';
    tdTime.textContent = msg.timeStr;
    tr.appendChild(tdTime);

    // Elapsed (conditional)
    if (showElapsed) {
        var tdElapsed = document.createElement('td');
        tdElapsed.className = 'col-elapsed';
        var elapsed = firstTimestamp !== undefined ? msg.timestamp - firstTimestamp : 0;
        tdElapsed.textContent = elapsed + 'ms';
        tdElapsed.style.color = cidColor;
        tr.appendChild(tdElapsed);
    }

    // Per-CID Delta (conditional)
    if (showPerCid) {
        tr.appendChild(buildDeltaCell(msg.delta, cidColor, deltaClass));
    }

    // Cross-CID Delta (conditional)
    if (showCrossCid) {
        tr.appendChild(buildCrossDeltaCell(msg.crossDelta, cidColor));
    }

    // Type
    var tdType = document.createElement('td');
    tdType.className = 'col-type';
    var typeBadge = document.createElement('span');
    typeBadge.className = 'type-badge type-sip';
    typeBadge.textContent = 'SIP';
    tdType.appendChild(typeBadge);
    tr.appendChild(tdType);

    // Message
    var tdMsg = document.createElement('td');
    tdMsg.className = 'col-message';
    var dirSpan = document.createElement('span');
    dirSpan.className = 'direction ' + dirClass;
    dirSpan.textContent = msg.direction;
    var methodSpan = document.createElement('span');
    methodSpan.className = 'method ' + methodClass;
    methodSpan.textContent = msg.method;
    tdMsg.appendChild(dirSpan);
    tdMsg.appendChild(methodSpan);
    tr.appendChild(tdMsg);

    // From
    var tdFrom = document.createElement('td');
    tdFrom.className = 'col-endpoint';
    tdFrom.title = msg.from || '';
    tdFrom.textContent = msg.from || '\u2014';
    tr.appendChild(tdFrom);

    // To
    var tdTo = document.createElement('td');
    tdTo.className = 'col-endpoint';
    tdTo.title = msg.to || '';
    tdTo.textContent = msg.to || '\u2014';
    tr.appendChild(tdTo);

    // CSeq
    var tdCseq = document.createElement('td');
    tdCseq.className = 'col-cseq';
    if (msg.cseq) {
        var cseqBadge = document.createElement('span');
        cseqBadge.className = 'cseq-badge';
        cseqBadge.textContent = msg.cseq + ' ' + msg.cseqMethod;
        tdCseq.appendChild(cseqBadge);
    } else {
        tdCseq.textContent = '\u2014';
    }
    tr.appendChild(tdCseq);

    // CID
    var tdCid = document.createElement('td');
    tdCid.className = 'col-cid';
    if (msg.cid) {
        var cidBadge = document.createElement('span');
        cidBadge.className = 'cid-badge';
        cidBadge.setAttribute('data-cid', String(cidIdx));
        cidBadge.textContent = msg.cid;
        tdCid.appendChild(cidBadge);
    } else {
        tdCid.textContent = '\u2014';
    }
    tr.appendChild(tdCid);

    return tr;
}

function renderEventRequestRow(msg, firstTimestamp) {
    var connidIdx = connidMap.get(msg.connid) ?? 0;
    var dirClass = msg.direction === '<-' ? 'incoming' : 'outgoing';
    var deltaClass = getDeltaClass(msg.delta);
    var typeClass = msg.type === 'event' ? 'type-event' : 'type-request';
    var shortConnid = msg.connid ? msg.connid.slice(-8) : '\u2014';
    var connidColor = CID_COLORS[connidIdx];

    var tr = document.createElement('tr');
    tr.setAttribute('data-connid', String(connidIdx));
    tr.setAttribute('data-type', msg.type);
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function() {
        toggleBookmark(msg._id, msg.timestamp, msg.timeStr, tr);
    });

    // Time
    var tdTime = document.createElement('td');
    tdTime.className = 'col-time';
    tdTime.textContent = msg.timeStr;
    tr.appendChild(tdTime);

    // Elapsed (conditional)
    if (showElapsed) {
        var tdElapsed = document.createElement('td');
        tdElapsed.className = 'col-elapsed';
        var elapsed = firstTimestamp !== undefined ? msg.timestamp - firstTimestamp : 0;
        tdElapsed.textContent = elapsed + 'ms';
        tdElapsed.style.color = connidColor;
        tr.appendChild(tdElapsed);
    }

    // Per-CID Delta (conditional)
    if (showPerCid) {
        tr.appendChild(buildDeltaCell(msg.delta, connidColor, deltaClass));
    }

    // Cross-CID Delta (conditional)
    if (showCrossCid) {
        tr.appendChild(buildCrossDeltaCell(msg.crossDelta, connidColor));
    }

    // Type
    var tdType = document.createElement('td');
    tdType.className = 'col-type';
    var typeBadge = document.createElement('span');
    typeBadge.className = 'type-badge ' + typeClass;
    typeBadge.textContent = msg.type === 'event' ? 'EVT' : 'REQ';
    tdType.appendChild(typeBadge);
    tr.appendChild(tdType);

    // Message
    var tdMsg = document.createElement('td');
    tdMsg.className = 'col-message';
    var dirSpan = document.createElement('span');
    dirSpan.className = 'direction ' + dirClass;
    dirSpan.textContent = msg.direction;
    var eventSpan = document.createElement('span');
    eventSpan.className = 'event-type ' + typeClass;
    eventSpan.textContent = msg.eventType;
    tdMsg.appendChild(dirSpan);
    tdMsg.appendChild(eventSpan);
    tr.appendChild(tdMsg);

    // DN
    var tdDn = document.createElement('td');
    tdDn.className = 'col-endpoint';
    tdDn.title = msg.dn || '';
    tdDn.textContent = msg.dn || '\u2014';
    tr.appendChild(tdDn);

    // ODN
    var tdOdn = document.createElement('td');
    tdOdn.className = 'col-endpoint';
    tdOdn.title = msg.odn || '';
    tdOdn.textContent = msg.odn || '\u2014';
    tr.appendChild(tdOdn);

    // RefID
    var tdRefid = document.createElement('td');
    tdRefid.className = 'col-cseq';
    if (msg.refid) {
        var refidBadge = document.createElement('span');
        refidBadge.className = 'refid-badge';
        refidBadge.textContent = msg.refid;
        tdRefid.appendChild(refidBadge);
    } else {
        tdRefid.textContent = '\u2014';
    }
    tr.appendChild(tdRefid);

    // ConnID
    var tdConnid = document.createElement('td');
    tdConnid.className = 'col-cid';
    var connidBadge = document.createElement('span');
    connidBadge.className = 'connid-badge';
    connidBadge.setAttribute('data-connid', String(connidIdx));
    connidBadge.title = msg.connid || '';
    connidBadge.textContent = shortConnid;
    tdConnid.appendChild(connidBadge);
    tr.appendChild(tdConnid);

    return tr;
}

function updateTableHeader() {
    var thead = document.getElementById('messages-thead');
    if (!thead) return;
    thead.textContent = '';
    var tr = document.createElement('tr');

    function addTh(text, tooltip) {
        var th = document.createElement('th');
        th.textContent = text;
        if (tooltip) th.title = tooltip;
        tr.appendChild(th);
    }

    addTh('Time', 'Absolute timestamp of the message');
    if (showElapsed) addTh('Elapsed', 'Milliseconds since the first message in the log');
    if (showPerCid) addTh('\u0394 Per-CID', 'Time since the previous message within the same CID/ConnID');
    if (showCrossCid) addTh('\u0394 Selected CIDs', 'Time since the previous visible message across all filtered CIDs');
    addTh('Type', 'Message type: SIP, Event, or Request');
    addTh('Message', 'Direction and method/event name');
    addTh('From / DN', 'Source endpoint or Device Number');
    addTh('To / ODN', 'Destination endpoint or Original Device Number');
    addTh('CSeq / RefID', 'Call sequence number or Reference ID');
    addTh('CID / ConnID', 'Call ID or Connection ID');

    thead.appendChild(tr);
}

function renderMessageGrid(messages) {
    var messageBody = document.getElementById('message-body');
    var messageCount = document.getElementById('message-count');

    messageCount.textContent = messages.length;

    // Clear SIP Span bookmarks (row elements become stale)
    sipSpanBookmarks = [];
    renderBookmarkBar();

    // Compute cross-CID deltas on filtered messages (chains only across visible rows)
    computeCrossCidDeltas(messages);

    // Update table header based on delta mode
    updateTableHeader();

    // Compute first timestamp for elapsed column
    var firstTimestamp = messages.length > 0 ? messages[0].timestamp : 0;

    // Build a set of pending SIP Span bookmark IDs for quick lookup
    var pendingSet = new Set(pendingSipBookmarks);

    // Clear and build using DOM
    messageBody.textContent = '';
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var row;
        if (msg.type === 'sip') {
            row = renderSipRow(msg, firstTimestamp);
        } else {
            row = renderEventRequestRow(msg, firstTimestamp);
        }
        if (row) {
            // Restore bookmarks from pending
            if (pendingSet.has(msg._id)) {
                row.classList.add('bookmarked');
                sipSpanBookmarks.push({ msgId: msg._id, timestamp: msg.timestamp, timeStr: msg.timeStr, element: row });
            }
            fragment.appendChild(row);
        }
    }
    messageBody.appendChild(fragment);

    // Sort restored bookmarks and render bar, then clear pending
    if (pendingSipBookmarks.length > 0) {
        sipSpanBookmarks.sort(function(a, b) { return a.timestamp - b.timestamp; });
        renderBookmarkBar();
        pendingSipBookmarks = [];
    }
}

// =====================================================
// Filter Logic
// =====================================================

function renderCidLegend() {
    const cids = [...cidMap.keys()];
    const legend = document.getElementById('cid-legend');
    const sipActive = filters.showSip;

    legend.textContent = '';
    cids.forEach(function(cid) {
        const idx = cidMap.get(cid);
        const isEnabled = filters.enabledCids.has(cid);
        const tag = document.createElement('div');
        var cls = 'cid-tag';
        if (!sipActive) cls += ' inactive';
        else if (!isEnabled) cls += ' disabled';
        tag.className = cls;
        tag.setAttribute('data-cid', cid);
        if (sipActive) {
            tag.addEventListener('click', function() { toggleCidFilter(cid); });
        }

        const dot = document.createElement('span');
        dot.className = 'cid-dot';
        dot.style.background = CID_COLORS[idx];

        tag.appendChild(dot);
        tag.appendChild(document.createTextNode(cid));
        legend.appendChild(tag);
    });

    // Also disable All/None buttons when SIP is off
    var cidAllBtn = document.getElementById('cid-all-btn');
    var cidNoneBtn = document.getElementById('cid-none-btn');
    if (cidAllBtn) {
        cidAllBtn.disabled = !sipActive;
        cidAllBtn.style.opacity = sipActive ? '' : '0.35';
    }
    if (cidNoneBtn) {
        cidNoneBtn.disabled = !sipActive;
        cidNoneBtn.style.opacity = sipActive ? '' : '0.35';
    }
}

function toggleCidFilter(cid) {
    if (filters.enabledCids.has(cid)) {
        filters.enabledCids.delete(cid);
    } else {
        filters.enabledCids.add(cid);
    }
    renderCidLegend();
    renderFilteredGrid();
}

function toggleAllCids(enable) {
    const cids = [...cidMap.keys()];
    if (enable) {
        filters.enabledCids = new Set(cids);
    } else {
        filters.enabledCids.clear();
    }
    renderCidLegend();
    renderFilteredGrid();
}

function toggleTypeFilter(type) {
    if (type === 'sip') {
        filters.showSip = !filters.showSip;
    } else if (type === 'events') {
        filters.showEvents = !filters.showEvents;
    } else if (type === 'requests') {
        filters.showRequests = !filters.showRequests;
    }
    updateFilterButtons();
    if (type === 'sip') renderCidLegend();
    renderFilteredGrid();
}

function updateFilterButtons() {
    var sipBtn = document.getElementById('filter-sip');
    var eventsBtn = document.getElementById('filter-events');
    var requestsBtn = document.getElementById('filter-requests');

    if (sipBtn) sipBtn.classList.toggle('active', filters.showSip);
    if (eventsBtn) eventsBtn.classList.toggle('active', filters.showEvents);
    if (requestsBtn) requestsBtn.classList.toggle('active', filters.showRequests);

    // Column toggle buttons
    var elapsedBtn = document.getElementById('toggle-elapsed');
    var percidBtn = document.getElementById('toggle-percid');
    var crosscidBtn = document.getElementById('toggle-crosscid');
    var compactBtn = document.getElementById('toggle-compact');
    if (elapsedBtn) elapsedBtn.classList.toggle('active', showElapsed);
    if (percidBtn) percidBtn.classList.toggle('active', showPerCid);
    if (crosscidBtn) crosscidBtn.classList.toggle('active', showCrossCid);
    if (compactBtn) compactBtn.classList.toggle('active', compactView);
}

function toggleColumnVisibility(col) {
    if (col === 'elapsed') showElapsed = !showElapsed;
    else if (col === 'percid') showPerCid = !showPerCid;
    else if (col === 'crosscid') showCrossCid = !showCrossCid;
    else if (col === 'compact') compactView = !compactView;
    document.getElementById('messages-view').classList.toggle('compact-mode', compactView);
    updateFilterButtons();
    renderFilteredGrid();
}

function getFilteredMessages() {
    return parsedMessages.filter(function(msg) {
        if (msg.type === 'sip' && !filters.showSip) return false;
        if (msg.type === 'event' && !filters.showEvents) return false;
        if (msg.type === 'request' && !filters.showRequests) return false;

        if (msg.type === 'sip' && msg.cid) {
            if (!filters.enabledCids.has(msg.cid)) return false;
        }

        return true;
    });
}

function renderFilteredGrid() {
    var filtered = getFilteredMessages();
    renderMessageGrid(filtered);
}

// =====================================================
// Events/Requests DN Grid Rendering
// =====================================================

function renderEventsRequestsGrid() {
    var data = eventsGridData;
    var messages = data.messages;
    var dnColumns = data.dnColumns;
    var switchColumn = data.switchColumn;
    var hasNoDnColumn = data.hasNoDnColumn;

    if (messages.length === 0) {
        showToast('No Events or Requests found', 'error');
        return;
    }

    // Update DN grid count badge
    var dnGridCount = document.getElementById('dn-grid-count');
    if (dnGridCount) dnGridCount.textContent = messages.length;

    var thead = document.getElementById('events-grid-head');
    var tbody = document.getElementById('events-grid-body');

    // Build header using DOM
    thead.textContent = '';
    var headerRow = document.createElement('tr');

    function addTh(text, tooltip) {
        var th = document.createElement('th');
        th.textContent = text;
        if (tooltip) th.title = tooltip;
        headerRow.appendChild(th);
    }

    addTh('#', 'Row number');
    addTh('Time', 'Absolute timestamp of the message');
    addTh('Elapsed', 'Milliseconds since the first message in the log');
    addTh('\u0394 Delta', 'Time since the previous message');

    if (hasNoDnColumn) {
        addTh('');
    }

    for (var i = 0; i < dnColumns.length; i++) {
        addTh("'" + dnColumns[i] + "'");
    }

    if (switchColumn) {
        addTh("'" + switchColumn + "'");
    }

    thead.appendChild(headerRow);

    // Compute first timestamp for elapsed column
    var firstTimestamp = messages.length > 0 ? messages[0].timestamp : 0;

    // Build a set of pending Kazimir bookmark IDs for quick lookup
    var pendingSet = new Set(pendingKazimirBookmarks);

    // Clear Kazimir bookmarks (row elements become stale)
    kazimirBookmarks = [];
    renderBookmarkBar();

    // Build body using DOM
    tbody.textContent = '';
    var fragment = document.createDocumentFragment();

    for (var idx = 0; idx < messages.length; idx++) {
        var msg = messages[idx];
        var tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        (function(m, row) {
            row.addEventListener('click', function() {
                toggleBookmark(m._id, m.timestamp, m.timeStr, row);
            });
        })(msg, tr);

        // Row number
        var tdNum = document.createElement('td');
        tdNum.className = 'col-num';
        tdNum.textContent = idx + 1;
        tr.appendChild(tdNum);

        // Time
        var tdTime = document.createElement('td');
        tdTime.className = 'col-time';
        tdTime.textContent = msg.timeStr;
        tr.appendChild(tdTime);

        // Elapsed
        var tdElapsed = document.createElement('td');
        tdElapsed.className = 'col-elapsed';
        tdElapsed.textContent = (msg.timestamp - firstTimestamp) + 'ms';
        tr.appendChild(tdElapsed);

        // Delta
        var tdDelta = document.createElement('td');
        tdDelta.className = 'col-delta';
        if (msg.deltaPrev !== null) {
            var prevSpan = document.createElement('span');
            prevSpan.className = 'delta-prev';
            prevSpan.textContent = '+' + msg.deltaPrev + 'ms';
            tdDelta.appendChild(prevSpan);
        }
        if (msg.deltaRefid !== null) {
            var refidSpan = document.createElement('span');
            refidSpan.className = 'delta-refid';
            refidSpan.textContent = '(' + msg.deltaRefid + 'ms)';
            tdDelta.appendChild(refidSpan);
        }
        tr.appendChild(tdDelta);

        // Determine cell class
        var cellClass = '';
        if (msg.eventType && msg.eventType.toLowerCase().indexOf('error') !== -1) {
            cellClass = 'cell-error';
        } else if (msg.type === 'request') {
            cellClass = 'cell-request';
        }

        // Build event label
        function buildEventLabel(m, parent) {
            parent.textContent = m.eventType;
            if (m.refid && m.refid !== '' && m.refid !== '4294967295') {
                var refSpan = document.createElement('span');
                refSpan.className = 'refid';
                refSpan.textContent = '(' + m.refid + ')';
                parent.appendChild(refSpan);
            }
        }

        // No-DN column
        if (hasNoDnColumn) {
            var tdNoDn = document.createElement('td');
            if (!msg.dn || msg.dn === '' || msg.dn === 'null') {
                if (cellClass) tdNoDn.className = cellClass;
                buildEventLabel(msg, tdNoDn);
            }
            tr.appendChild(tdNoDn);
        }

        // DN columns
        for (var d = 0; d < dnColumns.length; d++) {
            var tdDn = document.createElement('td');
            if (msg.dn === dnColumns[d] && !msg.isSwitch) {
                if (cellClass) tdDn.className = cellClass;
                buildEventLabel(msg, tdDn);
            }
            tr.appendChild(tdDn);
        }

        // Switch column
        if (switchColumn) {
            var tdSwitch = document.createElement('td');
            if (msg.isSwitch) {
                if (cellClass) tdSwitch.className = cellClass;
                buildEventLabel(msg, tdSwitch);
            }
            tr.appendChild(tdSwitch);
        }

        // Restore bookmarks from pending
        if (pendingSet.has(msg._id)) {
            tr.classList.add('bookmarked');
            kazimirBookmarks.push({ msgId: msg._id, timestamp: msg.timestamp, timeStr: msg.timeStr, element: tr });
        }

        fragment.appendChild(tr);
    }

    tbody.appendChild(fragment);

    // Sort restored bookmarks and render bar, then clear pending
    if (pendingKazimirBookmarks.length > 0) {
        kazimirBookmarks.sort(function(a, b) { return a.timestamp - b.timestamp; });
        renderBookmarkBar();
        pendingKazimirBookmarks = [];
    }
}

// =====================================================
// Timeline Diagram Export
// =====================================================

function generateDiagramId() {
    return 'diag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getAllDiagrams() {
    try {
        var data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function saveDiagramsList(diagrams) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(diagrams));
        return true;
    } catch (e) {
        return false;
    }
}

function generateSipDiagram() {
    var enabledCids = filters.enabledCids;
    var pendingInvites = new Map();
    var callSetups = [];
    var cidFromTo = new Map();

    for (var i = 0; i < parsedMessages.length; i++) {
        var msg = parsedMessages[i];
        if (msg.type !== 'sip') continue;
        if (!msg.cid || msg.cseq === null) continue;
        if (enabledCids.size > 0 && !enabledCids.has(msg.cid)) continue;

        var key = msg.cid + '-' + msg.cseq;

        if (msg.method === 'INVITE' && !cidFromTo.has(msg.cid)) {
            cidFromTo.set(msg.cid, { from: msg.from, to: msg.to });
        }

        if (msg.method === 'INVITE') {
            if (!pendingInvites.has(key)) {
                pendingInvites.set(key, msg);
            }
        } else if (msg.method === 'ACK') {
            var invite = pendingInvites.get(key);
            if (invite) {
                callSetups.push({
                    cid: msg.cid,
                    cseq: msg.cseq,
                    inviteTime: invite.timestamp,
                    ackTime: msg.timestamp,
                    duration: msg.timestamp - invite.timestamp,
                    from: invite.from,
                    to: invite.to
                });
                pendingInvites.delete(key);
            }
        }
    }

    if (callSetups.length === 0) return null;

    var allInviteTimes = callSetups.map(function(s) { return s.inviteTime; });
    var minTime = Math.min.apply(null, allInviteTimes);
    var cidSet = new Set(callSetups.map(function(s) { return s.cid; }));
    var cids = [...cidSet].sort();

    var lanes = cids.map(function(cid, index) {
        var ft = cidFromTo.get(cid) || { from: '', to: '' };
        var fromStr = (ft.from || '?').replace(/^:/, '');
        var toStr = (ft.to || '?').replace(/^:/, '');
        var laneName = cid + '\nf:' + fromStr + '\nt:' + toStr;
        return {
            id: index + 1,
            name: laneName,
            color: CID_COLORS[index % CID_COLORS.length]
        };
    });

    var boxId = 1;
    var boxes = [];

    for (var j = 0; j < callSetups.length; j++) {
        var setup = callSetups[j];
        var laneId = cids.indexOf(setup.cid) + 1;
        boxes.push({
            id: 'box-' + boxId++,
            laneId: laneId,
            startOffset: setup.inviteTime - minTime,
            duration: Math.max(setup.duration, 1),
            color: CID_COLORS[(laneId - 1) % CID_COLORS.length],
            label: 'CSeq ' + setup.cseq + ' (' + setup.duration + 'ms)'
        });
    }

    var startHours = Math.floor(minTime / 3600000);
    var startMinutes = Math.floor((minTime % 3600000) / 60000);
    var startSeconds = Math.floor((minTime % 60000) / 1000);
    var startMs = minTime % 1000;
    var startTimeStr = String(startHours).padStart(2, '0') + ':' + String(startMinutes).padStart(2, '0') + ':' + String(startSeconds).padStart(2, '0') + ' ' + String(startMs).padStart(3, '0');

    return {
        title: 'SIP Call Setup (INVITE \u2192 ACK)',
        startTime: startTimeStr,
        lanes: lanes,
        boxes: boxes,
        config: {
            timeFormatThreshold: 1000,
            showAlignmentLines: true,
            showBoxLabels: true
        }
    };
}

function handleImport() {
    var diagramData = generateSipDiagram();

    if (!diagramData) {
        showToast('No INVITE \u2192 ACK pairs found to import', 'error');
        return;
    }

    var diagrams = getAllDiagrams();
    diagrams.unshift({
        id: generateDiagramId(),
        title: diagramData.title,
        updatedAt: Date.now(),
        data: diagramData
    });

    if (saveDiagramsList(diagrams.slice(0, MAX_DIAGRAMS))) {
        showToast('Diagram created! <a href="index.html">Open Timeline Editor \u2192</a>', 'success', 5000);
    } else {
        showToast('Failed to save diagram', 'error');
    }
}

// =====================================================
// Main Parse Action
// =====================================================

function handleParseAction() {
    var input = document.getElementById('sip-input').value.trim();

    if (!input) {
        showToast('Please paste SIP logs first', 'error');
        return;
    }

    // Run both parsers on the same input
    parsedMessages = parseSipLog(input);
    parseEventsRequestsOnly(input);

    if (parsedMessages.length === 0 && eventsGridData.messages.length === 0) {
        showToast('No SIP messages, Events, or Requests found', 'error');
        return;
    }

    isParsed = true;

    // Initialize filter state
    var cids = [...cidMap.keys()];
    filters.enabledCids = new Set(cids);
    filters.showSip = true;
    filters.showEvents = true;
    filters.showRequests = true;
    updateFilterButtons();
    renderCidLegend();

    // Render combined info bar
    renderInfoBar();

    // Show view tabs
    document.getElementById('view-tabs').classList.remove('hidden');

    // Enable toolbar buttons
    document.getElementById('import-btn').disabled = false;
    // Save button state depends on storage capacity
    updateSavedBadge();

    // Auto-collapse input
    collapseInput();

    // Default to messages view
    switchToMessagesView();
}

// =====================================================
// Clear
// =====================================================

function handleClear() {
    document.getElementById('sip-input').value = '';
    document.getElementById('info-bar').classList.add('hidden');
    document.getElementById('view-tabs').classList.add('hidden');
    document.getElementById('filter-bar').classList.add('hidden');
    document.getElementById('filter-bar-placeholder').classList.add('hidden');
    document.getElementById('messages-view').classList.add('hidden');
    document.getElementById('dn-grid-view').classList.add('hidden');

    document.getElementById('save-log-btn').disabled = true;
    document.getElementById('import-btn').disabled = true;

    parsedMessages = [];
    cidMap.clear();
    connidMap.clear();
    refidMap.clear();
    filters.enabledCids.clear();
    filters.showSip = true;
    filters.showEvents = true;
    filters.showRequests = true;
    eventsGridData = { messages: [], dnColumns: [], switchColumn: null, hasNoDnColumn: false, connids: [] };
    isParsed = false;
    currentView = 'messages';
    showElapsed = true;
    showPerCid = true;
    showCrossCid = false;
    compactView = false;
    document.getElementById('messages-view').classList.remove('compact-mode');
    sipSpanBookmarks = [];
    kazimirBookmarks = [];
    pendingSipBookmarks = [];
    pendingKazimirBookmarks = [];
    renderBookmarkBar();
}

// =====================================================
// Initialize
// =====================================================

document.addEventListener('DOMContentLoaded', function() {
    // Theme
    restoreTheme();
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

    // Input toggle
    document.getElementById('toggle-input-btn').addEventListener('click', toggleInputSection);

    // Parse
    document.getElementById('parse-btn').addEventListener('click', handleParseAction);

    // Toolbar actions
    document.getElementById('save-log-btn').addEventListener('click', saveCurrentLog);
    document.getElementById('clear-btn').addEventListener('click', handleClear);
    document.getElementById('import-btn').addEventListener('click', handleImport);

    // View tabs
    document.getElementById('tab-messages').addEventListener('click', switchToMessagesView);
    document.getElementById('tab-dn-grid').addEventListener('click', switchToDnGridView);

    // Filters
    document.getElementById('filter-sip').addEventListener('click', function() { toggleTypeFilter('sip'); });
    document.getElementById('filter-events').addEventListener('click', function() { toggleTypeFilter('events'); });
    document.getElementById('filter-requests').addEventListener('click', function() { toggleTypeFilter('requests'); });
    document.getElementById('cid-all-btn').addEventListener('click', function() { toggleAllCids(true); });
    document.getElementById('cid-none-btn').addEventListener('click', function() { toggleAllCids(false); });

    // Column toggles
    document.getElementById('toggle-elapsed').addEventListener('click', function() { toggleColumnVisibility('elapsed'); });
    document.getElementById('toggle-percid').addEventListener('click', function() { toggleColumnVisibility('percid'); });
    document.getElementById('toggle-crosscid').addEventListener('click', function() { toggleColumnVisibility('crosscid'); });
    document.getElementById('toggle-compact').addEventListener('click', function() { toggleColumnVisibility('compact'); });

    // Saved logs modal
    document.getElementById('saved-logs-btn').addEventListener('click', openSavedLogsModal);
    document.getElementById('close-saved-modal').addEventListener('click', closeSavedLogsModal);
    document.getElementById('clear-saved-btn').addEventListener('click', clearAllSavedLogs);

    // Help modal
    document.getElementById('help-btn').addEventListener('click', openHelpModal);
    document.getElementById('close-help-modal').addEventListener('click', closeHelpModal);

    // Close modals on overlay click
    document.getElementById('saved-logs-modal').addEventListener('click', function(e) {
        if (e.target === document.getElementById('saved-logs-modal')) {
            closeSavedLogsModal();
        }
    });
    document.getElementById('help-modal').addEventListener('click', function(e) {
        if (e.target === document.getElementById('help-modal')) {
            closeHelpModal();
        }
    });

    // Close modals on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeSavedLogsModal();
            closeHelpModal();
        }
    });

    // Initialize badge count
    updateSavedBadge();

    // Auto-load if exactly one saved log, otherwise open paste area
    var savedLogs = getSavedLogs();
    if (savedLogs.length === 1) {
        document.getElementById('sip-input').value = savedLogs[0].content;
        pendingSipBookmarks = savedLogs[0].sipBookmarks || savedLogs[0].bookmarks || [];
        pendingKazimirBookmarks = savedLogs[0].kazimirBookmarks || [];
        handleParseAction();
    } else {
        expandInput();
    }
});
