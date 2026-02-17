const STORAGE_KEY = 'timeline_diagrams';
const ACTIVE_DIAGRAM_KEY = 'timeline_active_diagram';
const SESSION_STATE_KEY = 'timeline_session_state';
const MAX_DIAGRAMS = 10;

const LANE_COLORS = [
    '#60a5fa', '#a78bfa', '#22d3ee', '#4ade80', '#f59e0b', '#f472b6', '#818cf8', '#2dd4bf'
];

const SAMPLE_LIBRARY = {
    Telecom: [
        {
            id: 'sip_call_setup',
            title: 'Telecom - SIP Call Setup',
            startTime: '08:04:26 512',
            lanes: ['SBC', 'App Server', 'Media Gateway', 'Carrier'],
            boxes: [
                { lane: 0, start: 0, dur: 820, label: 'INVITE (Rx)' },
                { lane: 1, start: 860, dur: 560, label: 'Policy Check' },
                { lane: 2, start: 1490, dur: 1030, label: 'Media Allocate' },
                { lane: 3, start: 2630, dur: 470, label: '180 Ringing' },
                { lane: 0, start: 3170, dur: 290, label: '200 OK' },
                { lane: 0, start: 3520, dur: 320, label: 'ACK' }
            ]
        },
        {
            id: 'lte_attach',
            title: 'Telecom - LTE Attach Flow',
            startTime: '10:12:04 080',
            lanes: ['UE', 'eNodeB', 'MME', 'HSS'],
            boxes: [
                { lane: 0, start: 0, dur: 380, label: 'Attach Request' },
                { lane: 1, start: 420, dur: 350, label: 'S1AP Forward' },
                { lane: 2, start: 850, dur: 1280, label: 'Auth + Security' },
                { lane: 3, start: 980, dur: 650, label: 'Update Location' },
                { lane: 2, start: 2260, dur: 600, label: 'Attach Accept' },
                { lane: 0, start: 2930, dur: 340, label: 'Attach Complete' }
            ]
        }
    ],
    'Distributed Systems': [
        {
            id: 'microservice_trace',
            title: 'Distributed Systems - Checkout Request Trace',
            startTime: '11:08:10 120',
            lanes: ['API Gateway', 'Auth Service', 'Catalog Service', 'Payment Service', 'PostgreSQL'],
            boxes: [
                { lane: 0, start: 0, dur: 140, label: 'Request In' },
                { lane: 1, start: 170, dur: 420, label: 'JWT Verify' },
                { lane: 2, start: 650, dur: 660, label: 'Item Resolve' },
                { lane: 4, start: 790, dur: 420, label: 'SQL Read' },
                { lane: 3, start: 1390, dur: 920, label: 'Charge Call' },
                { lane: 0, start: 2370, dur: 180, label: 'Response Out' }
            ]
        },
        {
            id: 'retry_backoff',
            title: 'Distributed Systems - Retry Backoff Window',
            startTime: '11:12:44 900',
            lanes: ['Client', 'Edge', 'Order Service', 'Inventory Service', 'Queue'],
            boxes: [
                { lane: 0, start: 0, dur: 120, label: 'POST /order' },
                { lane: 1, start: 150, dur: 190, label: 'Route' },
                { lane: 2, start: 390, dur: 360, label: 'Try #1' },
                { lane: 2, start: 4050, dur: 360, label: 'Try #2' },
                { lane: 3, start: 4470, dur: 420, label: 'Reserve Stock' },
                { lane: 4, start: 4540, dur: 300, label: 'Ack Event' },
                { lane: 0, start: 4930, dur: 150, label: '201 Created' }
            ]
        }
    ],
    Cybersecurity: [
        {
            id: 'incident_timeline',
            title: 'Cybersecurity - Incident Reconstruction',
            startTime: '02:15:00 000',
            lanes: ['Email Gateway', 'Endpoint EDR', 'Active Directory', 'File Server', 'SOC'],
            boxes: [
                { lane: 0, start: 0, dur: 280, label: 'Phish Delivered' },
                { lane: 1, start: 530, dur: 460, label: 'Payload Executed' },
                { lane: 2, start: 1120, dur: 780, label: 'Privilege Escalation' },
                { lane: 3, start: 2010, dur: 1160, label: 'Data Staging' },
                { lane: 3, start: 3460, dur: 1380, label: 'Exfiltration' },
                { lane: 4, start: 5120, dur: 520, label: 'Containment Triggered' }
            ]
        },
        {
            id: 'siem_correlation',
            title: 'Cybersecurity - SIEM Correlation Flow',
            startTime: '02:42:10 350',
            lanes: ['Firewall', 'VPN', 'DLP', 'SIEM', 'IR Team'],
            boxes: [
                { lane: 0, start: 0, dur: 260, label: 'Outbound Spike' },
                { lane: 1, start: 120, dur: 420, label: 'Session Anomaly' },
                { lane: 2, start: 690, dur: 530, label: 'Policy Violation' },
                { lane: 3, start: 1260, dur: 600, label: 'Rule Correlation' },
                { lane: 4, start: 1940, dur: 760, label: 'Escalation + Triage' }
            ]
        }
    ],
    Manufacturing: [
        {
            id: 'assembly_cycle',
            title: 'Manufacturing - Assembly Line Cycle',
            startTime: '06:00:00 000',
            lanes: ['Station A (Mold)', 'Station B (Cooling)', 'Station C (QC)', 'Packaging'],
            boxes: [
                { lane: 0, start: 0, dur: 4200, label: 'Injection Mold' },
                { lane: 1, start: 4320, dur: 8100, label: 'Cooling' },
                { lane: 2, start: 12600, dur: 1600, label: 'Quality Check' },
                { lane: 3, start: 14320, dur: 2200, label: 'Pack + Label' }
            ]
        },
        {
            id: 'bottleneck_shift',
            title: 'Manufacturing - Shift Bottleneck Analysis',
            startTime: '14:00:00 000',
            lanes: ['Cutting', 'Welding', 'Painting', 'Inspection'],
            boxes: [
                { lane: 0, start: 0, dur: 1600, label: 'Batch 1 Cut' },
                { lane: 1, start: 1700, dur: 2300, label: 'Batch 1 Weld' },
                { lane: 2, start: 4200, dur: 2800, label: 'Batch 1 Paint' },
                { lane: 1, start: 7600, dur: 2500, label: 'Batch 2 Weld' },
                { lane: 3, start: 10200, dur: 1100, label: 'Final Inspection' }
            ]
        }
    ],
    Healthcare: [
        {
            id: 'triage_flow',
            title: 'Healthcare - ER Triage to Admission',
            startTime: '07:45:00 000',
            lanes: ['Reception', 'Triage Nurse', 'Lab', 'Physician', 'Ward'],
            boxes: [
                { lane: 0, start: 0, dur: 420, label: 'Registration' },
                { lane: 1, start: 450, dur: 930, label: 'Vitals + Priority' },
                { lane: 2, start: 1470, dur: 1780, label: 'Blood Work' },
                { lane: 3, start: 1840, dur: 1260, label: 'Assessment' },
                { lane: 4, start: 3320, dur: 640, label: 'Bed Assignment' }
            ]
        },
        {
            id: 'stroke_pathway',
            title: 'Healthcare - Stroke Door-to-Needle',
            startTime: '12:10:00 000',
            lanes: ['ED Intake', 'Radiology', 'Neurology', 'Pharmacy'],
            boxes: [
                { lane: 0, start: 0, dur: 300, label: 'Arrival + Triage' },
                { lane: 1, start: 340, dur: 1240, label: 'CT Scan' },
                { lane: 2, start: 1660, dur: 880, label: 'Clinical Decision' },
                { lane: 3, start: 2600, dur: 640, label: 'tPA Prep' },
                { lane: 0, start: 3300, dur: 210, label: 'Treatment Start' }
            ]
        }
    ],
    'Media & Post-Production': [
        {
            id: 'promo_cut_plan',
            title: 'Media - Promo Edit Structure',
            startTime: '00:00:00 000',
            lanes: ['Main Video', 'B-Roll', 'Dialogue', 'Music', 'Titles'],
            boxes: [
                { lane: 0, start: 0, dur: 4200, label: 'Main Take A' },
                { lane: 1, start: 900, dur: 1200, label: 'Factory B-Roll' },
                { lane: 1, start: 2700, dur: 900, label: 'Close-ups' },
                { lane: 2, start: 130, dur: 3800, label: 'Voice Track' },
                { lane: 3, start: 0, dur: 4300, label: 'Music Bed' },
                { lane: 4, start: 350, dur: 600, label: 'Opening Title' },
                { lane: 4, start: 3550, dur: 520, label: 'Call-to-Action' }
            ]
        },
        {
            id: 'music_sync_map',
            title: 'Media - Beat Sync Timing Map',
            startTime: '00:01:12 000',
            lanes: ['Kick', 'Snare', 'Vocal', 'FX'],
            boxes: [
                { lane: 0, start: 0, dur: 180, label: 'Beat Window 1' },
                { lane: 1, start: 520, dur: 180, label: 'Beat Window 2' },
                { lane: 2, start: 980, dur: 700, label: 'Vocal Phrase' },
                { lane: 3, start: 1710, dur: 360, label: 'Impact FX' },
                { lane: 2, start: 2190, dur: 560, label: 'Vocal Tail' }
            ]
        }
    ],
    Construction: [
        {
            id: 'build_phase',
            title: 'Construction - Trade Sequencing',
            startTime: '07:00:00 000',
            lanes: ['Excavation', 'Foundation', 'Framing', 'Electrical', 'Inspection'],
            boxes: [
                { lane: 0, start: 0, dur: 2600, label: 'Site Prep' },
                { lane: 1, start: 2700, dur: 4100, label: 'Pour + Cure' },
                { lane: 2, start: 6900, dur: 3500, label: 'Framing' },
                { lane: 3, start: 10500, dur: 2400, label: 'Rough-in' },
                { lane: 4, start: 13050, dur: 1200, label: 'Compliance Check' }
            ]
        },
        {
            id: 'permit_hold',
            title: 'Construction - Permit Delay Impact',
            startTime: '08:20:00 000',
            lanes: ['Architect', 'Municipality', 'General Contractor', 'Subcontractor'],
            boxes: [
                { lane: 0, start: 0, dur: 900, label: 'Issue Drawings' },
                { lane: 1, start: 980, dur: 2700, label: 'Permit Review' },
                { lane: 2, start: 3900, dur: 720, label: 'Schedule Replan' },
                { lane: 3, start: 4720, dur: 1500, label: 'Mobilization' }
            ]
        }
    ],
    Logistics: [
        {
            id: 'global_shipment',
            title: 'Logistics - International Shipment',
            startTime: '03:00:00 000',
            lanes: ['Supplier', 'Port', 'Customs', 'Regional DC', 'Last Mile'],
            boxes: [
                { lane: 0, start: 0, dur: 1300, label: 'Pick + Pack' },
                { lane: 1, start: 1650, dur: 2800, label: 'Ocean Handling' },
                { lane: 2, start: 5100, dur: 2200, label: 'Clearance' },
                { lane: 3, start: 7600, dur: 1600, label: 'Sort + Dispatch' },
                { lane: 4, start: 9500, dur: 1300, label: 'Final Delivery' }
            ]
        },
        {
            id: 'cold_chain',
            title: 'Logistics - Cold Chain Monitoring',
            startTime: '04:14:20 500',
            lanes: ['Producer', 'Cold Storage', 'Truck Fleet', 'Clinic'],
            boxes: [
                { lane: 0, start: 0, dur: 700, label: 'Pre-cool Prep' },
                { lane: 1, start: 820, dur: 2400, label: 'Storage Hold' },
                { lane: 2, start: 3400, dur: 3100, label: 'Refrigerated Transit' },
                { lane: 3, start: 6650, dur: 920, label: 'Receive + Verify' }
            ]
        }
    ],
    'Performance Testing': [
        {
            id: 'load_test_timeline',
            title: 'Performance Testing - Load Test Phases',
            startTime: '16:00:00 000',
            lanes: ['Scenario A', 'Scenario B', 'API Cluster', 'DB Cluster', 'Error Monitor'],
            boxes: [
                { lane: 0, start: 0, dur: 3000, label: 'Ramp-up' },
                { lane: 1, start: 500, dur: 7000, label: 'Steady Traffic' },
                { lane: 2, start: 900, dur: 6200, label: 'API Saturation' },
                { lane: 3, start: 1600, dur: 5200, label: 'DB Load' },
                { lane: 0, start: 7600, dur: 1400, label: 'Spike Phase' },
                { lane: 4, start: 7900, dur: 950, label: '5xx Burst' }
            ]
        },
        {
            id: 'regression_window',
            title: 'Performance Testing - Regression Window',
            startTime: '16:42:10 000',
            lanes: ['Baseline Run', 'Candidate Run', 'Auth Endpoint', 'Checkout Endpoint'],
            boxes: [
                { lane: 0, start: 0, dur: 2600, label: 'Baseline Capture' },
                { lane: 1, start: 2900, dur: 2700, label: 'Candidate Capture' },
                { lane: 2, start: 3300, dur: 1400, label: 'Latency Drift' },
                { lane: 3, start: 3900, dur: 1800, label: 'Tail Amplification' }
            ]
        }
    ],
    Legal: [
        {
            id: 'litigation_timeline',
            title: 'Legal - Contract Dispute Chronology',
            startTime: '09:00:00 000',
            lanes: ['Plaintiff', 'Defendant', 'Counsel', 'Court'],
            boxes: [
                { lane: 0, start: 0, dur: 500, label: 'Notice Issued' },
                { lane: 1, start: 620, dur: 840, label: 'Response Filed' },
                { lane: 2, start: 1540, dur: 1300, label: 'Evidence Review' },
                { lane: 3, start: 3010, dur: 920, label: 'Hearing Window' },
                { lane: 2, start: 4050, dur: 740, label: 'Settlement Draft' }
            ]
        }
    ],
    'Network Protocols': [
        {
            id: 'tls_handshake',
            title: 'Network Protocols - TLS Handshake Timing',
            startTime: '00:00:15 000',
            lanes: ['Client', 'DNS Resolver', 'CDN Edge', 'Origin Server'],
            boxes: [
                { lane: 0, start: 0, dur: 80, label: 'SYN' },
                { lane: 1, start: 100, dur: 210, label: 'DNS Lookup' },
                { lane: 2, start: 360, dur: 420, label: 'TCP + TLS Handshake' },
                { lane: 3, start: 860, dur: 520, label: 'Origin Fetch' },
                { lane: 0, start: 1480, dur: 140, label: 'First Byte' }
            ]
        },
        {
            id: 'websocket_burst',
            title: 'Network Protocols - WebSocket Burst Analysis',
            startTime: '00:02:40 250',
            lanes: ['Browser', 'Gateway', 'Realtime Service'],
            boxes: [
                { lane: 0, start: 0, dur: 210, label: 'Upgrade Request' },
                { lane: 1, start: 260, dur: 170, label: '101 Switch' },
                { lane: 2, start: 700, dur: 640, label: 'Burst #1' },
                { lane: 2, start: 4680, dur: 690, label: 'Burst #2' },
                { lane: 0, start: 5480, dur: 260, label: 'Render Updates' }
            ]
        }
    ],
    Education: [
        {
            id: 'os_scheduler_demo',
            title: 'Education - OS Scheduling Demo',
            startTime: '00:00:00 000',
            lanes: ['Process A', 'Process B', 'Process C', 'I/O'],
            boxes: [
                { lane: 0, start: 0, dur: 320, label: 'CPU Slice A1' },
                { lane: 1, start: 340, dur: 320, label: 'CPU Slice B1' },
                { lane: 2, start: 680, dur: 320, label: 'CPU Slice C1' },
                { lane: 3, start: 1050, dur: 700, label: 'Disk Wait' },
                { lane: 0, start: 1810, dur: 320, label: 'CPU Slice A2' },
                { lane: 1, start: 2160, dur: 320, label: 'CPU Slice B2' }
            ]
        },
        {
            id: 'protocol_teaching',
            title: 'Education - Request/Response Teaching Flow',
            startTime: '00:00:05 000',
            lanes: ['Student Client', 'Demo Server', 'Database'],
            boxes: [
                { lane: 0, start: 0, dur: 180, label: 'Request Sent' },
                { lane: 1, start: 220, dur: 420, label: 'Validation' },
                { lane: 2, start: 700, dur: 350, label: 'Read Record' },
                { lane: 1, start: 1090, dur: 260, label: 'Compose Response' },
                { lane: 0, start: 1410, dur: 220, label: 'Display Result' }
            ]
        }
    ],
    Finance: [
        {
            id: 'card_auth',
            title: 'Finance - Card Authorization',
            startTime: '09:31:15 200',
            lanes: ['POS', 'Gateway', 'Issuer', 'Fraud Engine'],
            boxes: [
                { lane: 0, start: 0, dur: 260, label: 'Auth Request' },
                { lane: 1, start: 290, dur: 420, label: 'Normalize + Route' },
                { lane: 3, start: 760, dur: 890, label: 'Risk Scoring' },
                { lane: 2, start: 810, dur: 1280, label: 'Issuer Decision' },
                { lane: 1, start: 2160, dur: 260, label: 'Response Build' },
                { lane: 0, start: 2460, dur: 180, label: 'Approved' }
            ]
        },
        {
            id: 'wire_transfer',
            title: 'Finance - Wire Transfer Validation',
            startTime: '13:07:42 001',
            lanes: ['Client', 'API', 'Compliance', 'Core Banking'],
            boxes: [
                { lane: 0, start: 0, dur: 190, label: 'Transfer Request' },
                { lane: 1, start: 240, dur: 520, label: 'Schema + Limits' },
                { lane: 2, start: 820, dur: 1140, label: 'AML Screening' },
                { lane: 3, start: 960, dur: 820, label: 'Balance Hold' },
                { lane: 1, start: 2050, dur: 350, label: 'Final Validate' },
                { lane: 0, start: 2460, dur: 210, label: 'Accepted' }
            ]
        }
    ],
    ECommerce: [
        {
            id: 'checkout_flow',
            title: 'E-Commerce - Checkout Pipeline',
            startTime: '18:20:33 410',
            lanes: ['Web', 'Cart', 'Payment', 'Order Service', 'Inventory'],
            boxes: [
                { lane: 0, start: 0, dur: 210, label: 'Checkout Click' },
                { lane: 1, start: 260, dur: 500, label: 'Cart Freeze' },
                { lane: 2, start: 810, dur: 1370, label: 'Payment Auth' },
                { lane: 4, start: 860, dur: 620, label: 'Stock Reserve' },
                { lane: 3, start: 2250, dur: 760, label: 'Order Create' },
                { lane: 0, start: 3070, dur: 300, label: 'Confirmation UI' }
            ]
        }
    ]
};

function generateDiagramId() {
    return 'diag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function getAllDiagrams() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

function saveDiagrams(diagrams) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(diagrams));
        return true;
    } catch (_) {
        return false;
    }
}

function formatDuration(ms) {
    if (ms >= 1000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
    return `${ms}ms`;
}

function computeTotalDuration(sample) {
    return sample.boxes.reduce((max, b) => Math.max(max, b.start + b.dur), 0);
}

function sampleToDiagram(sample) {
    const lanes = sample.lanes.map((name, index) => ({
        id: index + 1,
        name,
        order: index,
        baseColor: LANE_COLORS[index % LANE_COLORS.length]
    }));

    const boxes = sample.boxes.map((b, index) => ({
        id: index + 1,
        laneId: b.lane + 1,
        startOffset: b.start,
        duration: Math.max(1, b.dur),
        color: b.color || LANE_COLORS[b.lane % LANE_COLORS.length],
        label: b.label
    }));

    const totalDuration = boxes.reduce((max, b) => Math.max(max, b.startOffset + b.duration), 0);
    const timelineDuration = Math.max(8000, Math.ceil((totalDuration + 1000) / 1000) * 1000);

    return {
        title: sample.title,
        startTime: sample.startTime || '00:00:00 000',
        lanes,
        boxes,
        nextLaneId: lanes.length + 1,
        nextBoxId: boxes.length + 1,
        locked: false,
        compressionEnabled: false,
        settings: {
            timeFormatThreshold: 1000,
            showAlignmentLines: true,
            showBoxLabels: true,
            autoOpenBoxProperties: false,
            trailingSpace: 1000,
            compressionThreshold: 500,
            compactView: true,
            timelineDuration
        },
        measurementState: null
    };
}

function showToast(message, kind = '') {
    const node = document.getElementById('toast');
    node.className = `toast show ${kind}`.trim();
    node.innerHTML = message;
}

function populateSectors() {
    const sectorSelect = document.getElementById('sector-select');
    const sectors = Object.keys(SAMPLE_LIBRARY);
    sectorSelect.innerHTML = sectors.map(s => `<option value="${s}">${s}</option>`).join('');
}

function populateTemplates() {
    const sector = document.getElementById('sector-select').value;
    const templateSelect = document.getElementById('template-select');
    const templates = SAMPLE_LIBRARY[sector] || [];
    templateSelect.innerHTML = templates.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
}

function getSelectedSample() {
    const sector = document.getElementById('sector-select').value;
    const sampleId = document.getElementById('template-select').value;
    const templates = SAMPLE_LIBRARY[sector] || [];
    return templates.find(t => t.id === sampleId) || null;
}

function renderPreview() {
    const sample = getSelectedSample();
    if (!sample) return;

    const totalDuration = computeTotalDuration(sample);
    const preview = document.getElementById('preview');
    const rows = [];

    for (let laneIndex = 0; laneIndex < sample.lanes.length; laneIndex += 1) {
        const laneName = sample.lanes[laneIndex];
        const laneBoxes = sample.boxes.filter(b => b.lane === laneIndex);
        const bars = laneBoxes.map((b) => {
            const left = (b.start / totalDuration) * 100;
            const width = (b.dur / totalDuration) * 100;
            const color = b.color || LANE_COLORS[laneIndex % LANE_COLORS.length];
            return `<div class="sample-box" style="left:${left}%;width:${Math.max(width, 2)}%;background:${color}">${b.label}</div>`;
        }).join('');

        rows.push(
            `<div class="row"><div class="lane-name">${laneName}</div><div class="track">${bars}</div></div>`
        );
    }

    preview.innerHTML = rows.join('');

    document.getElementById('meta-title').textContent = sample.title;
    document.getElementById('meta-lanes').textContent = String(sample.lanes.length);
    document.getElementById('meta-boxes').textContent = String(sample.boxes.length);
    document.getElementById('meta-duration').textContent = formatDuration(totalDuration);
}

function importToTimeline(openEditor = false) {
    const sample = getSelectedSample();
    if (!sample) return null;

    const diagrams = getAllDiagrams();
    const diagramId = generateDiagramId();
    const diagramData = sampleToDiagram(sample);

    diagrams.unshift({
        id: diagramId,
        title: diagramData.title,
        updatedAt: Date.now(),
        data: diagramData
    });

    if (!saveDiagrams(diagrams.slice(0, MAX_DIAGRAMS))) {
        showToast('Failed to save sample to browser storage.', 'warn');
        return null;
    }

    try {
        localStorage.setItem(ACTIVE_DIAGRAM_KEY, diagramId);
        const rawSession = localStorage.getItem(SESSION_STATE_KEY);
        const session = rawSession ? JSON.parse(rawSession) : {};
        const nextSession = (session && typeof session === 'object') ? session : {};
        nextSession.activeDiagramId = diagramId;
        localStorage.setItem(SESSION_STATE_KEY, JSON.stringify(nextSession));
    } catch (_) {}

    if (openEditor) {
        window.location.href = 'index.html';
        return diagramId;
    }

    showToast(`Sample imported. <a href="index.html">Open Timeline Editor</a>`, 'success');
    return diagramId;
}

function downloadJson() {
    const sample = getSelectedSample();
    if (!sample) return;
    const data = sampleToDiagram(sample);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sample.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
    populateSectors();
    populateTemplates();
    renderPreview();

    document.getElementById('sector-select').addEventListener('change', () => {
        populateTemplates();
        renderPreview();
    });
    document.getElementById('template-select').addEventListener('change', renderPreview);
    document.getElementById('import-btn').addEventListener('click', () => importToTimeline(false));
    document.getElementById('import-open-btn').addEventListener('click', () => importToTimeline(true));
    document.getElementById('download-btn').addEventListener('click', downloadJson);
});
