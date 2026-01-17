// SIP Log Parser - Standalone page
// Parses SIP logs and saves to Timeline Diagram app storage

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

    return null;
}

function parseSipLog(log) {
    const lines = log.split('\n');
    const messages = [];
    cidMap.clear();
    let cidIndex = 0;

    for (const line of lines) {
        const msg = parseSipLine(line);
        if (msg) {
            // Assign CID index for coloring
            if (msg.cid && !cidMap.has(msg.cid)) {
                cidMap.set(msg.cid, cidIndex % 10);
                cidIndex++;
            }
            messages.push(msg);
        }
    }

    // Calculate deltas per CID
    const lastTimeByCid = new Map();
    for (const msg of messages) {
        if (msg.cid) {
            const lastTime = lastTimeByCid.get(msg.cid);
            msg.delta = lastTime !== undefined ? msg.timestamp - lastTime : null;
            lastTimeByCid.set(msg.cid, msg.timestamp);
        } else {
            msg.delta = null;
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
    const invites = messages.filter(m => m.method === 'INVITE').length;

    let duration = 0;
    if (messages.length > 1) {
        const times = messages.map(m => m.timestamp);
        duration = Math.max(...times) - Math.min(...times);
    }

    document.getElementById('stat-messages').textContent = messages.length;
    document.getElementById('stat-cids').textContent = cids.length;
    document.getElementById('stat-invites').textContent = invites;
    document.getElementById('stat-duration').textContent = formatDuration(duration);

    statsBar.classList.add('visible');

    // Render CID legend
    const legend = document.getElementById('cid-legend');
    legend.innerHTML = cids.map(cid => {
        const idx = cidMap.get(cid);
        return `<div class="cid-tag">
            <span class="cid-dot" style="background: ${CID_COLORS[idx]}"></span>
            ${cid}
        </div>`;
    }).join('');
    legend.classList.add('visible');
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

function renderMessageGrid(messages) {
    const gridSection = document.getElementById('grid-section');
    const messageBody = document.getElementById('message-body');
    const messageCount = document.getElementById('message-count');

    messageCount.textContent = messages.length;

    messageBody.innerHTML = messages.map(msg => {
        const cidIdx = cidMap.get(msg.cid) ?? 0;
        const dirClass = msg.direction === '<-' ? 'incoming' : 'outgoing';
        const deltaClass = getDeltaClass(msg.delta);
        const methodClass = getMethodClass(msg.method, msg.isResponse);
        const deltaText = msg.delta === null ? '—' : `+${msg.delta}ms`;

        return `<tr data-cid="${cidIdx}">
            <td class="col-time">${msg.timeStr}</td>
            <td class="col-delta">
                <span class="delta-badge ${deltaClass}">${deltaText}</span>
            </td>
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
            <td class="col-content">
                ${msg.content ? `<span class="content-badge">${msg.content}</span>` : ''}
            </td>
        </tr>`;
    }).join('');

    gridSection.classList.add('visible');
    document.getElementById('import-section').classList.add('visible');
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
    // Extract INVITE-ACK pairs
    const pendingInvites = new Map();
    const callSetups = [];

    for (const msg of parsedMessages) {
        if (!msg.cid || msg.cseq === null) continue;
        const key = `${msg.cid}-${msg.cseq}`;

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
                    duration: msg.timestamp - invite.timestamp
                });
                pendingInvites.delete(key);
            }
        }
    }

    if (callSetups.length === 0) return null;

    const minTime = Math.min(...callSetups.map(s => s.inviteTime));
    const cids = [...new Set(callSetups.map(s => s.cid))].sort();

    const lanes = cids.map((cid, index) => ({
        id: index + 1,
        name: cid,
        color: CID_COLORS[index % CID_COLORS.length]
    }));

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
        alert('No SIP messages found in the input');
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
    document.getElementById('cid-legend').classList.remove('visible');
    document.getElementById('grid-section').classList.remove('visible');
    document.getElementById('import-section').classList.remove('visible');
    document.getElementById('success-toast').classList.remove('visible');
    document.getElementById('save-log-btn').disabled = true;
    parsedMessages = [];
    cidMap.clear();
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
