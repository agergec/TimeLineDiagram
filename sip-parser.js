// SIP Log Parser - Standalone page
// Parses SIP logs and saves to Timeline Diagram app storage

// Storage key must match the main app
const STORAGE_KEY = 'timeline_diagrams';
const MAX_DIAGRAMS = 10;

// Color palette for different Call-IDs
const SIP_COLORS = [
    '#4CAF50', // Green
    '#2196F3', // Blue
    '#FF9800', // Orange
    '#9C27B0', // Purple
    '#F44336', // Red
    '#00BCD4', // Cyan
    '#FFEB3B', // Yellow
    '#795548', // Brown
    '#E91E63', // Pink
    '#607D8B', // Blue Grey
];

// State
let parsedResult = null;

// Parse timestamp to milliseconds from start of day
function parseSipTimestamp(timeStr) {
    const [hours, minutes, secondsMs] = timeStr.split(':');
    const [seconds, ms] = secondsMs.split('.');
    return (parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)) * 1000 + parseInt(ms);
}

// Parse a single SIP log line
function parseSipLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Match SIP message lines - handle both formats
    // Call-ID pattern is flexible: Cid000, Call-001, or any identifier after the last pipe
    const sipMatch = trimmed.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+(<-|->)(\w+)\s+\[.*?\|\s*([A-Za-z][\w-]*\d+)\s*\]/);
    if (sipMatch) {
        const [, timestamp, direction, method, cid] = sipMatch;

        // Extract CSeq number for matching INVITE/ACK pairs
        const cseqMatch = trimmed.match(/cs:\s*(\d+)\s+(\w+)/);
        const cseq = cseqMatch ? parseInt(cseqMatch[1]) : null;

        return {
            type: 'sip',
            timestamp: parseSipTimestamp(timestamp),
            timeStr: timestamp,
            direction,
            method,
            cid,
            cseq
        };
    }

    return null;
}

// Parse the log and extract INVITE-ACK pairs
function parseSipLog(log) {
    const lines = log.split('\n');
    const events = lines.map(parseSipLine).filter(e => e !== null && e.type === 'sip');

    // Track pending INVITEs per Cid+CSeq
    const pendingInvites = new Map();
    const callSetups = [];

    for (const event of events) {
        const key = `${event.cid}-${event.cseq}`;

        if (event.method === 'INVITE') {
            // Store the INVITE (first one for this Cid+CSeq)
            if (!pendingInvites.has(key)) {
                pendingInvites.set(key, event);
            }
        } else if (event.method === 'ACK') {
            // Match with pending INVITE
            const invite = pendingInvites.get(key);
            if (invite) {
                callSetups.push({
                    cid: event.cid,
                    cseq: event.cseq,
                    inviteTime: invite.timestamp,
                    inviteTimeStr: invite.timeStr,
                    ackTime: event.timestamp,
                    ackTimeStr: event.timeStr,
                    duration: event.timestamp - invite.timestamp
                });
                pendingInvites.delete(key);
            }
        }
    }

    return { callSetups, totalLines: lines.length, sipEvents: events.length };
}

// Generate diagram data from parsed SIP log
function generateSipDiagram(callSetups) {
    if (callSetups.length === 0) return null;

    // Find the earliest timestamp to use as base
    const minTime = Math.min(...callSetups.map(s => s.inviteTime));

    // Group by Cid to create lanes
    const cidGroups = {};
    for (const setup of callSetups) {
        if (!cidGroups[setup.cid]) {
            cidGroups[setup.cid] = [];
        }
        cidGroups[setup.cid].push(setup);
    }

    const cids = Object.keys(cidGroups).sort();

    // Create lanes and boxes
    const lanes = cids.map((cid, index) => ({
        id: index + 1,
        name: cid,
        color: SIP_COLORS[index % SIP_COLORS.length]
    }));

    let boxId = 1;
    const boxes = [];

    for (const [cid, setups] of Object.entries(cidGroups)) {
        const laneId = cids.indexOf(cid) + 1;
        const laneColor = SIP_COLORS[(laneId - 1) % SIP_COLORS.length];

        for (const setup of setups) {
            boxes.push({
                id: `box-${boxId++}`,
                laneId,
                startOffset: setup.inviteTime - minTime,
                duration: Math.max(setup.duration, 1), // Minimum 1ms
                color: laneColor,
                label: `CSeq ${setup.cseq} (${setup.duration}ms)`
            });
        }
    }

    // Format start time from minTime
    const startHours = Math.floor(minTime / 3600000);
    const startMinutes = Math.floor((minTime % 3600000) / 60000);
    const startSeconds = Math.floor((minTime % 60000) / 1000);
    const startMs = minTime % 1000;
    const startTimeStr = `${String(startHours).padStart(2, '0')}:${String(startMinutes).padStart(2, '0')}:${String(startSeconds).padStart(2, '0')} ${String(startMs).padStart(3, '0')}`;

    return {
        title: 'SIP Call Setup Durations (INVITE → ACK)',
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

// Update stats display
function updateStats(result) {
    const stats = document.getElementById('stats');

    if (result.callSetups.length === 0) {
        stats.innerHTML = `
            <div class="stat-row">
                <span class="stat-warning">No INVITE → ACK pairs found</span>
            </div>
            <div class="stat-row">
                <span>Lines processed:</span>
                <span>${result.totalLines}</span>
            </div>
            <div class="stat-row">
                <span>SIP messages found:</span>
                <span>${result.sipEvents}</span>
            </div>
        `;
    } else {
        const cids = [...new Set(result.callSetups.map(s => s.cid))];
        stats.innerHTML = `
            <div class="stat-row">
                <span class="stat-success">Parsing successful!</span>
            </div>
            <div class="stat-row">
                <span>Call-IDs (lanes):</span>
                <span>${cids.length}</span>
            </div>
            <div class="stat-row">
                <span>INVITE → ACK pairs (boxes):</span>
                <span>${result.callSetups.length}</span>
            </div>
            <div class="stat-row">
                <span>SIP messages parsed:</span>
                <span>${result.sipEvents}</span>
            </div>
        `;
    }

    stats.classList.add('visible');
}

// Update preview table
function updatePreview(result) {
    const previewSection = document.getElementById('preview-section');
    const importSection = document.getElementById('import-section');
    const previewBody = document.getElementById('preview-body');

    if (result.callSetups.length === 0) {
        previewSection.classList.remove('visible');
        importSection.classList.remove('visible');
        return;
    }

    // Get unique CIDs and their colors
    const cids = [...new Set(result.callSetups.map(s => s.cid))].sort();
    const cidColors = {};
    cids.forEach((cid, index) => {
        cidColors[cid] = SIP_COLORS[index % SIP_COLORS.length];
    });

    // Build table rows
    previewBody.innerHTML = result.callSetups.map(setup => `
        <tr>
            <td><span class="color-dot" style="background: ${cidColors[setup.cid]}"></span>${setup.cid}</td>
            <td>${setup.cseq}</td>
            <td>${setup.inviteTimeStr}</td>
            <td>${setup.ackTimeStr}</td>
            <td>${setup.duration}ms</td>
        </tr>
    `).join('');

    previewSection.classList.add('visible');
    importSection.classList.add('visible');
    document.getElementById('success-message').classList.remove('visible');
}

// Storage functions (matching main app)
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
        return true;
    } catch (e) {
        console.error('Failed to save diagrams to storage:', e);
        return false;
    }
}

// Import diagram to storage
function importToStorage(diagramData) {
    const diagrams = getAllDiagrams();
    const newDiagram = {
        id: generateDiagramId(),
        title: diagramData.title,
        updatedAt: Date.now(),
        data: diagramData
    };

    // Add to beginning of list
    diagrams.unshift(newDiagram);

    // Limit to MAX_DIAGRAMS
    const trimmedDiagrams = diagrams.slice(0, MAX_DIAGRAMS);

    return saveDiagramsList(trimmedDiagrams);
}

// Event handlers
function handleParse() {
    const input = document.getElementById('sip-input').value.trim();

    if (!input) {
        alert('Please paste SIP logs first');
        return;
    }

    parsedResult = parseSipLog(input);
    updateStats(parsedResult);
    updatePreview(parsedResult);
}

function handleClear() {
    document.getElementById('sip-input').value = '';
    document.getElementById('stats').classList.remove('visible');
    document.getElementById('preview-section').classList.remove('visible');
    document.getElementById('import-section').classList.remove('visible');
    document.getElementById('success-message').classList.remove('visible');
    parsedResult = null;
}

function handleImport() {
    if (!parsedResult || parsedResult.callSetups.length === 0) {
        alert('No data to import. Please parse logs first.');
        return;
    }

    const diagramData = generateSipDiagram(parsedResult.callSetups);

    if (importToStorage(diagramData)) {
        document.getElementById('success-message').classList.add('visible');
        document.getElementById('import-btn').textContent = 'Import Another';
    } else {
        alert('Failed to save diagram. Storage may be full.');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('parse-btn').addEventListener('click', handleParse);
    document.getElementById('clear-btn').addEventListener('click', handleClear);
    document.getElementById('import-btn').addEventListener('click', handleImport);
});
