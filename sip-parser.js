// SIP Log Parser - Standalone page
// Parses SIP logs, Events, and Requests - saves to Timeline Diagram app storage

// Storage keys
const STORAGE_KEY = 'timeline_diagrams';
const SIP_LOGS_KEY = 'sip_saved_logs';
const MAX_DIAGRAMS = 10;
const MAX_SAVED_LOGS = 20;

// CID color palette (matches CSS)
const CID_COLORS = [
    '#ff6b6b', '#4ecdc4', '#ffe66d', '#a78bfa', '#22d3ee',
    '#f472b6', '#34d399', '#fb923c', '#60a5fa', '#c084fc'
];

// State
let parsedMessages = [];
let cidMap = new Map(); // Maps CID string to index for coloring
let connidMap = new Map(); // Maps ConnID string to index for coloring
let refidMap = new Map(); // Maps refid to array of messages for delta calculation

// Filter state
let filters = {
    showSip: true,
    showEvents: true,
    showRequests: true,
    enabledCids: new Set(), // Empty = show all, otherwise only show these CIDs
}

// =====================================================
// Parsing Functions
// =====================================================

function parseSipTimestamp(timeStr) {
    const [hours, minutes, secondsMs] = timeStr.split(':');
    const [seconds, ms] = secondsMs.split('.');
    return (parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)) * 1000 + parseInt(ms);
}

function parseSipLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Match SIP message lines with all fields
    // Format: timestamp direction method [f: from |t: to |cs: cseq method | cid ] content
    const sipMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(<-|->)(\d{3}|\w+)\s+\[([^\]]+)\](.*)$/);

    if (sipMatch) {
        const [, timestamp, direction, method, bracketed, rest] = sipMatch;

        // Parse bracketed content: f: from |t: to |cs: cseq method | cid
        const fromMatch = bracketed.match(/f:\s*([^|]*)/);
        const toMatch = bracketed.match(/t:\s*([^|]*)/);
        const cseqMatch = bracketed.match(/cs:\s*(\d+)\s+(\w+)/);
        const cidMatch = bracketed.match(/\|\s*([A-Za-z][\w-]*\d+)\s*$/);

        // Parse content type from rest of line
        const contentMatch = rest.trim().match(/^(application\/[\w.-]+|text\/[\w.-]+)/);

        const from = fromMatch ? fromMatch[1].trim() : '';
        const to = toMatch ? toMatch[1].trim() : '';
        const cseq = cseqMatch ? parseInt(cseqMatch[1]) : null;
        const cseqMethod = cseqMatch ? cseqMatch[2] : '';
        const cid = cidMatch ? cidMatch[1] : '';
        const content = contentMatch ? contentMatch[1] : '';

        // Determine if method is a response code (3 digits)
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

    // Match Event lines: EventCallCreated(dn=...|odn=...|connid=...|refid=...|msgid=...)
    const eventMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(Event\w+)\(([^)]*)\)/);
    if (eventMatch) {
        const [, timestamp, eventType, params] = eventMatch;
        const parsed = parseEventParams(params);
        return {
            type: 'event',
            timestamp: parseSipTimestamp(timestamp),
            timeStr: timestamp,
            direction: '->',  // Events are outgoing
            eventType,
            dn: parsed.dn,
            odn: parsed.odn,
            connid: parsed.connid,
            refid: parsed.refid,
            msgid: parsed.msgid,
            raw: trimmed
        };
    }

    // Match Request lines: RequestUpdateUserDa(dn=...|odn=...|connid=...|refid=...|msgid=...)
    const requestMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(Request\w+)\(([^)]*)\)/);
    if (requestMatch) {
        const [, timestamp, requestType, params] = requestMatch;
        const parsed = parseEventParams(params);
        return {
            type: 'request',
            timestamp: parseSipTimestamp(timestamp),
            timeStr: timestamp,
            direction: '<-',  // Requests are incoming
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

    // Parse dn='value' or dn=value patterns
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
            // Assign CID index for coloring (SIP messages)
            if (msg.type === 'sip' && msg.cid && !cidMap.has(msg.cid)) {
                cidMap.set(msg.cid, cidIndex % 10);
                cidIndex++;
            }
            // Assign ConnID index for coloring (Events/Requests)
            if ((msg.type === 'event' || msg.type === 'request') && msg.connid && !connidMap.has(msg.connid)) {
                connidMap.set(msg.connid, connidIndex % 10);
                connidIndex++;
            }
            // Track messages by refid for delta calculation
            if (msg.refid && msg.refid !== '' && msg.refid !== '4294967295') {
                if (!refidMap.has(msg.refid)) {
                    refidMap.set(msg.refid, []);
                }
                refidMap.get(msg.refid).push(msg);
            }
            messages.push(msg);
        }
    }

    // Calculate deltas
    const lastTimeByCid = new Map();
    const lastTimeByRefid = new Map();

    for (const msg of messages) {
        if (msg.type === 'sip') {
            // SIP messages: delta per CID
            if (msg.cid) {
                const lastTime = lastTimeByCid.get(msg.cid);
                msg.delta = lastTime !== undefined ? msg.timestamp - lastTime : null;
                lastTimeByCid.set(msg.cid, msg.timestamp);
            } else {
                msg.delta = null;
            }
        } else {
            // Events/Requests: delta per refid (to show Request→Event time)
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
// UI Rendering
// =====================================================

function renderStats(messages) {
    const statsBar = document.getElementById('stats-bar');
    const cids = [...cidMap.keys()];
    const sipMessages = messages.filter(m => m.type === 'sip');
    const events = messages.filter(m => m.type === 'event');
    const requests = messages.filter(m => m.type === 'request');
    const invites = sipMessages.filter(m => m.method === 'INVITE').length;

    let duration = 0;
    if (messages.length > 1) {
        const times = messages.map(m => m.timestamp);
        duration = Math.max(...times) - Math.min(...times);
    }

    document.getElementById('stat-messages').textContent = sipMessages.length;
    document.getElementById('stat-cids').textContent = cids.length;
    document.getElementById('stat-invites').textContent = invites;
    document.getElementById('stat-events').textContent = events.length;
    document.getElementById('stat-requests').textContent = requests.length;
    document.getElementById('stat-duration').textContent = formatDuration(duration);

    statsBar.classList.add('visible');

    // Initialize filter state - all CIDs enabled by default
    filters.enabledCids = new Set(cids);
    filters.showSip = true;
    filters.showEvents = true;
    filters.showRequests = true;

    // Show filter bar and update button states
    document.getElementById('filter-bar').classList.add('visible');
    updateFilterButtons();

    // Render CID legend with filter toggles
    renderCidLegend();
}

function renderCidLegend() {
    const cids = [...cidMap.keys()];
    const legend = document.getElementById('cid-legend');

    legend.innerHTML = cids.map(cid => {
        const idx = cidMap.get(cid);
        const isEnabled = filters.enabledCids.has(cid);
        return `<div class="cid-tag ${isEnabled ? '' : 'disabled'}" data-cid="${cid}" onclick="toggleCidFilter('${cid}')">
            <span class="cid-dot" style="background: ${CID_COLORS[idx]}"></span>
            ${cid}
        </div>`;
    }).join('');
    legend.classList.add('visible');
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
    renderFilteredGrid();
}

function updateFilterButtons() {
    const sipBtn = document.getElementById('filter-sip');
    const eventsBtn = document.getElementById('filter-events');
    const requestsBtn = document.getElementById('filter-requests');

    if (sipBtn) sipBtn.classList.toggle('active', filters.showSip);
    if (eventsBtn) eventsBtn.classList.toggle('active', filters.showEvents);
    if (requestsBtn) requestsBtn.classList.toggle('active', filters.showRequests);
}

function getFilteredMessages() {
    return parsedMessages.filter(msg => {
        // Type filter
        if (msg.type === 'sip' && !filters.showSip) return false;
        if (msg.type === 'event' && !filters.showEvents) return false;
        if (msg.type === 'request' && !filters.showRequests) return false;

        // CID filter (only applies to SIP messages)
        if (msg.type === 'sip' && msg.cid && filters.enabledCids.size > 0) {
            if (!filters.enabledCids.has(msg.cid)) return false;
        }

        return true;
    });
}

function renderFilteredGrid() {
    const filtered = getFilteredMessages();
    renderMessageGrid(filtered);
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function getDeltaClass(delta) {
    if (delta === null) return 'first';
    if (delta < 100) return 'fast';
    if (delta < 500) return 'medium';
    return 'slow';
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

function getTypeClass(type) {
    if (type === 'sip') return 'type-sip';
    if (type === 'event') return 'type-event';
    if (type === 'request') return 'type-request';
    return '';
}

function getTypeBadge(type) {
    if (type === 'sip') return '<span class="type-badge type-sip">SIP</span>';
    if (type === 'event') return '<span class="type-badge type-event">EVT</span>';
    if (type === 'request') return '<span class="type-badge type-request">REQ</span>';
    return '';
}

function renderMessageGrid(messages) {
    const gridSection = document.getElementById('grid-section');
    const messageBody = document.getElementById('message-body');
    const messageCount = document.getElementById('message-count');

    messageCount.textContent = messages.length;

    messageBody.innerHTML = messages.map(msg => {
        if (msg.type === 'sip') {
            return renderSipRow(msg);
        } else {
            return renderEventRequestRow(msg);
        }
    }).join('');

    gridSection.classList.add('visible');
    document.getElementById('import-section').classList.add('visible');
}

function renderSipRow(msg) {
    const cidIdx = cidMap.get(msg.cid) ?? 0;
    const dirClass = msg.direction === '<-' ? 'incoming' : 'outgoing';
    const deltaClass = getDeltaClass(msg.delta);
    const methodClass = getMethodClass(msg.method, msg.isResponse);
    const deltaText = msg.delta === null ? '—' : `+${msg.delta}ms`;

    return `<tr data-cid="${cidIdx}" data-type="sip">
        <td class="col-time">${msg.timeStr}</td>
        <td class="col-delta">
            <span class="delta-badge ${deltaClass}">${deltaText}</span>
        </td>
        <td class="col-type">${getTypeBadge('sip')}</td>
        <td class="col-message">
            <span class="direction ${dirClass}">${msg.direction}</span>
            <span class="method ${methodClass}">${msg.method}</span>
        </td>
        <td class="col-endpoint" title="${msg.from}">${msg.from || '—'}</td>
        <td class="col-endpoint" title="${msg.to}">${msg.to || '—'}</td>
        <td class="col-cseq">
            ${msg.cseq ? `<span class="cseq-badge">${msg.cseq} ${msg.cseqMethod}</span>` : '—'}
        </td>
        <td class="col-cid">
            ${msg.cid ? `<span class="cid-badge" data-cid="${cidIdx}">${msg.cid}</span>` : '—'}
        </td>
    </tr>`;
}

function renderEventRequestRow(msg) {
    const connidIdx = connidMap.get(msg.connid) ?? 0;
    const dirClass = msg.direction === '<-' ? 'incoming' : 'outgoing';
    const deltaClass = getDeltaClass(msg.delta);
    const deltaText = msg.delta === null ? '—' : `+${msg.delta}ms`;
    const typeClass = msg.type === 'event' ? 'type-event' : 'type-request';
    const shortConnid = msg.connid ? msg.connid.slice(-8) : '—';

    return `<tr data-connid="${connidIdx}" data-type="${msg.type}" class="row-${msg.type}">
        <td class="col-time">${msg.timeStr}</td>
        <td class="col-delta">
            <span class="delta-badge ${deltaClass}">${deltaText}</span>
        </td>
        <td class="col-type">${getTypeBadge(msg.type)}</td>
        <td class="col-message">
            <span class="direction ${dirClass}">${msg.direction}</span>
            <span class="event-type ${typeClass}">${msg.eventType}</span>
        </td>
        <td class="col-endpoint" title="${msg.dn}">${msg.dn || '—'}</td>
        <td class="col-endpoint" title="${msg.odn}">${msg.odn || '—'}</td>
        <td class="col-cseq">
            ${msg.refid ? `<span class="refid-badge">${msg.refid}</span>` : '—'}
        </td>
        <td class="col-cid">
            <span class="connid-badge" data-connid="${connidIdx}" title="${msg.connid}">${shortConnid}</span>
        </td>
    </tr>`;
}

// =====================================================
// Saved Logs Management
// =====================================================

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

function saveCurrentLog() {
    const input = document.getElementById('sip-input').value.trim();
    if (!input || parsedMessages.length === 0) return;

    const logs = getSavedLogs();
    const cids = [...cidMap.keys()];

    const newLog = {
        id: 'log_' + Date.now(),
        savedAt: Date.now(),
        messageCount: parsedMessages.length,
        cidCount: cids.length,
        cids: cids.slice(0, 5), // Store first 5 CIDs for preview
        content: input
    };

    logs.unshift(newLog);

    // Limit saved logs
    const trimmed = logs.slice(0, MAX_SAVED_LOGS);

    if (saveLogs(trimmed)) {
        renderSavedLogs();
        alert('Log saved successfully!');
    }
}

function loadSavedLog(logId) {
    const logs = getSavedLogs();
    const log = logs.find(l => l.id === logId);
    if (log) {
        document.getElementById('sip-input').value = log.content;
        handleParse();
    }
}

function deleteSavedLog(logId, event) {
    event.stopPropagation();
    if (!confirm('Delete this saved log?')) return;

    const logs = getSavedLogs().filter(l => l.id !== logId);
    saveLogs(logs);
    renderSavedLogs();
}

function clearAllSavedLogs() {
    if (!confirm('Delete all saved logs?')) return;
    saveLogs([]);
    renderSavedLogs();
}

function renderSavedLogs() {
    const logs = getSavedLogs();
    const section = document.getElementById('saved-section');
    const list = document.getElementById('saved-list');

    if (logs.length === 0) {
        section.classList.remove('visible');
        return;
    }

    section.classList.add('visible');

    list.innerHTML = logs.map(log => {
        const date = new Date(log.savedAt);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const cidPreview = log.cids ? log.cids.join(', ') : '';

        return `<div class="saved-item" onclick="loadSavedLog('${log.id}')">
            <div class="saved-item-info">
                <div class="saved-item-title">${log.messageCount} messages • ${log.cidCount} CIDs</div>
                <div class="saved-item-meta">${dateStr} ${cidPreview ? '• ' + cidPreview : ''}</div>
            </div>
            <div class="saved-item-actions">
                <button class="btn btn-secondary" onclick="deleteSavedLog('${log.id}', event)">Delete</button>
            </div>
        </div>`;
    }).join('');
}

// =====================================================
// Timeline Diagram Export
// =====================================================

function generateDiagramId() {
    return 'diag_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getAllDiagrams() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
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
    // Only use filtered CIDs for export
    const enabledCids = filters.enabledCids;

    // Extract INVITE-ACK pairs only for enabled CIDs
    const pendingInvites = new Map();
    const callSetups = [];

    // Track from/to headers per CID for lane naming
    const cidFromTo = new Map();

    for (const msg of parsedMessages) {
        if (msg.type !== 'sip') continue;
        if (!msg.cid || msg.cseq === null) continue;

        // Only include enabled CIDs
        if (enabledCids.size > 0 && !enabledCids.has(msg.cid)) continue;

        const key = `${msg.cid}-${msg.cseq}`;

        // Track from/to for lane naming (use the first INVITE's from/to)
        if (msg.method === 'INVITE' && !cidFromTo.has(msg.cid)) {
            cidFromTo.set(msg.cid, { from: msg.from, to: msg.to });
        }

        if (msg.method === 'INVITE') {
            if (!pendingInvites.has(key)) {
                pendingInvites.set(key, msg);
            }
        } else if (msg.method === 'ACK') {
            const invite = pendingInvites.get(key);
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

    const minTime = Math.min(...callSetups.map(s => s.inviteTime));
    const cids = [...new Set(callSetups.map(s => s.cid))].sort();

    // Generate lane names with CID, from, and to headers
    const lanes = cids.map((cid, index) => {
        const ft = cidFromTo.get(cid) || { from: '', to: '' };
        const fromStr = ft.from || '?';
        const toStr = ft.to || '?';
        const laneName = `${cid} | f:${fromStr} → t:${toStr}`;
        return {
            id: index + 1,
            name: laneName,
            color: CID_COLORS[index % CID_COLORS.length]
        };
    });

    let boxId = 1;
    const boxes = [];

    for (const setup of callSetups) {
        const laneId = cids.indexOf(setup.cid) + 1;
        boxes.push({
            id: `box-${boxId++}`,
            laneId,
            startOffset: setup.inviteTime - minTime,
            duration: Math.max(setup.duration, 1),
            color: CID_COLORS[(laneId - 1) % CID_COLORS.length],
            label: `CSeq ${setup.cseq} (${setup.duration}ms)`
        });
    }

    const startHours = Math.floor(minTime / 3600000);
    const startMinutes = Math.floor((minTime % 3600000) / 60000);
    const startSeconds = Math.floor((minTime % 60000) / 1000);
    const startMs = minTime % 1000;
    const startTimeStr = `${String(startHours).padStart(2, '0')}:${String(startMinutes).padStart(2, '0')}:${String(startSeconds).padStart(2, '0')} ${String(startMs).padStart(3, '0')}`;

    return {
        title: 'SIP Call Setup (INVITE → ACK)',
        startTime: startTimeStr,
        lanes,
        boxes,
        config: {
            timeFormatThreshold: 1000,
            showAlignmentLines: true,
            showBoxLabels: true
        }
    };
}

function handleImport() {
    const diagramData = generateSipDiagram();

    if (!diagramData) {
        alert('No INVITE → ACK pairs found to import.');
        return;
    }

    const diagrams = getAllDiagrams();
    diagrams.unshift({
        id: generateDiagramId(),
        title: diagramData.title,
        updatedAt: Date.now(),
        data: diagramData
    });

    if (saveDiagramsList(diagrams.slice(0, MAX_DIAGRAMS))) {
        document.getElementById('success-toast').classList.add('visible');
    } else {
        alert('Failed to save diagram.');
    }
}

// =====================================================
// Event Handlers
// =====================================================

function handleParse() {
    const input = document.getElementById('sip-input').value.trim();

    if (!input) {
        alert('Please paste SIP logs first');
        return;
    }

    parsedMessages = parseSipLog(input);

    if (parsedMessages.length === 0) {
        alert('No SIP messages, Events, or Requests found in the input');
        return;
    }

    renderStats(parsedMessages);
    renderMessageGrid(parsedMessages);

    // Enable save button
    document.getElementById('save-log-btn').disabled = false;
}

function handleClear() {
    document.getElementById('sip-input').value = '';
    document.getElementById('stats-bar').classList.remove('visible');
    document.getElementById('filter-bar').classList.remove('visible');
    document.getElementById('cid-legend').classList.remove('visible');
    document.getElementById('grid-section').classList.remove('visible');
    document.getElementById('import-section').classList.remove('visible');
    document.getElementById('success-toast').classList.remove('visible');
    document.getElementById('save-log-btn').disabled = true;
    parsedMessages = [];
    cidMap.clear();
    connidMap.clear();
    refidMap.clear();
    filters.enabledCids.clear();
    filters.showSip = true;
    filters.showEvents = true;
    filters.showRequests = true;
}

// =====================================================
// Initialize
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('parse-btn').addEventListener('click', handleParse);
    document.getElementById('clear-btn').addEventListener('click', handleClear);
    document.getElementById('save-log-btn').addEventListener('click', saveCurrentLog);
    document.getElementById('import-btn').addEventListener('click', handleImport);
    document.getElementById('clear-saved-btn').addEventListener('click', clearAllSavedLogs);

    // Load saved logs on page load
    renderSavedLogs();
});
