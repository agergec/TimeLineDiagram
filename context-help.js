(function () {
    function getAppState() {
        return (typeof app !== 'undefined') ? app : null;
    }

    function getV2State() {
        return (typeof V2 !== 'undefined') ? V2 : null;
    }

    const TOPIC_BY_ID = {
        'diagrams-toggle': 'diagrams',
        'save-json': 'saveJson',
        'load-json': 'loadJson',
        'undo-btn': 'undoLane',
        'redo-btn': 'redoLane',
        'share-url': 'shareLink',
        'export-png': 'exportPng',
        'export-svg': 'exportSvg',
        'zoom-out': 'zoomOut',
        'zoom-in': 'zoomIn',
        'zoom-fit': 'fitToView',
        'compress-toggle': 'compress',
        'measure-tool-btn': 'measure',
        'measure-bar-pin': 'measurePin',
        'threshold-toggle-btn': 'threshold',
        'config-show-alignment': 'alignment',
        'config-show-labels': 'persistentLabels',
        'config-compact-view': 'compactView',
        'config-auto-open-properties': 'autoOpenProps',
        'config-lock-diagram': 'lockDiagram',
        'settings-btn': 'settings',
        'theme-toggle-btn': 'themeToggle'
    };

    const TOPIC_BY_HREF_FILE = {
        'sip-parser.html': 'sipParser',
        'sector-samples.html': 'sectorSamples',
        'help.html': 'openHelpPage'
    };

    const HELP_TOPICS = {
        diagrams: {
            title: 'My Diagrams',
            summary: 'Manage all saved diagrams in one place.',
            points: [
                'Open, lock, rename, delete, or purge diagrams.',
                'Add a fresh diagram without losing the current one.',
                'The badge shows the number of stored diagrams.'
            ],
            anchor: 'auto-save'
        },
        saveJson: {
            title: 'Download JSON',
            summary: 'Export the active diagram as a JSON file.',
            points: [
                'Includes lanes, boxes, timing settings, and view state.',
                'Useful for backups or sharing through files.',
                'Downloaded file can be re-imported later.'
            ],
            anchor: 'sharing-export'
        },
        loadJson: {
            title: 'Load JSON',
            summary: 'Import a JSON diagram into the editor.',
            points: [
                'Supports saved exports and parser-generated files.',
                'Imported diagrams appear in My Diagrams list.',
                'Keeps diagram-specific base unit and options.'
            ],
            anchor: 'json-format'
        },
        undoLane: {
            title: 'Undo Lane Delete',
            summary: 'Restore the most recently deleted lane.',
            points: [
                'Works with toolbar click or Ctrl/Cmd+Z.',
                'Undo stack is lane-deletion specific.',
                'Disabled when no undo step exists.'
            ],
            anchor: 'lanes',
            shortcut: 'Ctrl/Cmd + Z'
        },
        redoLane: {
            title: 'Redo Lane Delete',
            summary: 'Re-apply the last undone lane deletion.',
            points: [
                'Works with toolbar click or Ctrl/Cmd+Shift+Z.',
                'Enabled only after an undo action.',
                'Helps test lane deletion flows quickly.'
            ],
            anchor: 'lanes',
            shortcut: 'Ctrl/Cmd + Shift + Z'
        },
        shareLink: {
            title: 'Share Link',
            summary: 'Copy a shareable URL of the active diagram.',
            points: [
                'Encodes diagram data into the URL.',
                'Great for quick collaboration without files.',
                'Visual active indicator confirms copy flow.'
            ],
            anchor: 'sharing-export'
        },
        exportPng: {
            title: 'Export PNG',
            summary: 'Export the canvas as a bitmap image.',
            points: [
                'Captures timeline, lanes, markers, and measurements.',
                'Good for slides, docs, or chat sharing.',
                'Uses current theme and current viewport state.'
            ],
            anchor: 'sharing-export'
        },
        exportSvg: {
            title: 'Export SVG',
            summary: 'Export a scalable vector version of the timeline.',
            points: [
                'Best for print-quality and editing in design tools.',
                'Keeps crisp visuals at any zoom level.',
                'Includes timeline marks and lane layout.'
            ],
            anchor: 'sharing-export'
        },
        sipParser: {
            title: 'SIP Parser',
            summary: 'Open SIP parser and import call-flow diagrams.',
            points: [
                'Paste logs and convert SIP messages into timeline boxes.',
                'Toggle event types before import.',
                'Imports using base unit compatible JSON.'
            ],
            anchor: 'sip-parser'
        },
        sectorSamples: {
            title: 'Sector Samples',
            summary: 'Open sample diagrams by domain and import quickly.',
            points: [
                'Includes realistic templates across sectors.',
                'Each sample imports directly into Timeline Editor.',
                'Useful starting point for demos and testing.'
            ],
            anchor: 'tools-pages'
        },
        zoomOut: {
            title: 'Zoom Out',
            summary: 'Decrease timeline zoom to view more range.',
            points: [
                'Reduces scale while preserving data positions.',
                'Helpful before fit-to-view or compression checks.',
                'Zoom label shows current percentage.'
            ],
            anchor: 'zoom-navigation'
        },
        zoomIn: {
            title: 'Zoom In',
            summary: 'Increase timeline zoom for finer timing edits.',
            points: [
                'Useful for short-duration boxes and precise drag.',
                'Works with box edge snapping and measurements.',
                'Zoom label updates live.'
            ],
            anchor: 'zoom-navigation'
        },
        fitToView: {
            title: 'Fit To View',
            summary: 'Auto-fit the active diagram in the visible area.',
            points: [
                'State is stored per diagram.',
                'Toggle restores previous manual zoom state.',
                'Indicator dot shows active fit mode.'
            ],
            anchor: 'zoom-navigation'
        },
        compress: {
            title: 'Compress Empty Spaces',
            summary: 'Collapse long empty gaps to focus on activity.',
            points: [
                'Large idle gaps are visually compressed.',
                'Real timing is still preserved in values and tools.',
                'Pairs with threshold and fit controls.'
            ],
            anchor: 'compression'
        },
        measure: {
            title: 'Measurement Tool',
            summary: 'Draw one or more measurements on the timeline.',
            points: [
                'Click-drag while tool is active to create arrows.',
                'Each new measure gets a distinct saturated color.',
                'Data appears in toolbar and in the floating measures panel.'
            ],
            anchor: 'measurement',
            shortcut: 'Ctrl/Cmd + click-drag'
        },
        measurePin: {
            title: 'Pin Measurements',
            summary: 'Keep current measurements visible and persistent.',
            points: [
                'Pinned measurements stay after pointer release.',
                'Included in exports and saved diagram state.',
                'Unpin to return to transient behavior.'
            ],
            anchor: 'measurement'
        },
        threshold: {
            title: 'Threshold Rules',
            summary: 'Configure how ruler/time values switch units.',
            points: [
                'Select a base unit and threshold display mode.',
                'Controls when sub-unit labels appear.',
                'Applies per diagram and persists in storage.'
            ],
            anchor: 'settings'
        },
        alignment: {
            title: 'Alignment Lines',
            summary: 'Show dashed guides at box start and end edges.',
            points: [
                'Helps align related events across lanes.',
                'Guides are useful with drag, resize, and measure.',
                'Toggle is stored per diagram.'
            ],
            anchor: 'alignment'
        },
        persistentLabels: {
            title: 'Persistent Labels',
            summary: 'Keep labels visible above very narrow boxes.',
            points: [
                'Improves readability when box width hits minimum.',
                'Labels remain visible while timeline stays compact.',
                'Works in both normal and compressed views.'
            ],
            anchor: 'settings'
        },
        compactView: {
            title: 'Hide Lane Headers',
            summary: 'Toggle lane header column visibility for more space.',
            points: [
                'Useful when focusing on timeline content only.',
                'Exports keep lane headers for readability.',
                'Great with fit-to-view on wide diagrams.'
            ],
            anchor: 'zoom-navigation'
        },
        autoOpenProps: {
            title: 'Auto-Open Properties',
            summary: 'Open properties panel automatically for new boxes.',
            points: [
                'When enabled, newly created boxes open Box Properties.',
                'When disabled, panel stays closed after creation.',
                'Selection behavior for existing boxes is unchanged.'
            ],
            anchor: 'settings'
        },
        lockDiagram: {
            title: 'Lock Diagram',
            summary: 'Prevent accidental edits to lanes and boxes.',
            points: [
                'Disables editing actions and protects current layout.',
                'Lock state is visible in title bar and diagrams list.',
                'Unlock any time to continue editing.'
            ],
            anchor: 'settings'
        },
        settings: {
            title: 'Diagram Settings',
            summary: 'Open right-sidebar settings for current diagram.',
            points: [
                'Set title, start time, base unit, and timeline duration.',
                'Adjust trailing space, threshold, scaling, and danger actions.',
                'Most settings are persisted per diagram.'
            ],
            anchor: 'settings'
        },
        themeToggle: {
            title: 'Theme Toggle',
            summary: 'Switch between dark and light theme.',
            points: [
                'Theme preference is saved in browser storage.',
                'Applies globally across editor and helper pages.',
                'Tooltips and controls adapt for accessibility.'
            ],
            anchor: 'theme'
        },
        openHelpPage: {
            title: 'Open Help Page',
            summary: 'Launch the full documentation page.',
            points: [
                'Contains complete feature explanations and examples.',
                'Includes keyboard shortcuts and JSON format docs.',
                'Use this compact pane for quick contextual guidance.'
            ],
            anchor: 'quick-start'
        }
    };

    function getHelpElements() {
        return {
            sidebar: document.getElementById('right-sidebar'),
            title: document.getElementById('right-sidebar-title'),
            helpSection: document.getElementById('help-props'),
            step: document.getElementById('context-help-step'),
            topicTitle: document.getElementById('context-help-title'),
            summary: document.getElementById('context-help-summary'),
            points: document.getElementById('context-help-points'),
            shortcut: document.getElementById('context-help-shortcut'),
            link: document.getElementById('context-help-link')
        };
    }

    function getToolbarControl(node) {
        if (!(node instanceof Element)) return null;
        const control = node.closest('.toolbar-btn, .toolbar-toggle-btn');
        if (!control) return null;
        if (!control.closest('.toolbar')) return null;
        return control;
    }

    function getControlHintText(control) {
        if (!control) return '';
        const raw = control.getAttribute('data-hint')
            || control.getAttribute('data-tooltip')
            || control.getAttribute('title')
            || control.getAttribute('aria-label')
            || control.textContent
            || '';
        return raw.replace(/\s+/g, ' ').trim();
    }

    function getHrefFilename(control) {
        if (!(control instanceof HTMLAnchorElement)) return '';
        try {
            const parsed = new URL(control.getAttribute('href') || '', window.location.href);
            const parts = parsed.pathname.split('/').filter(Boolean);
            return parts.length ? parts[parts.length - 1] : '';
        } catch (_) {
            return '';
        }
    }

    function resolveTopicKey(control) {
        if (!control) return null;

        if (control.id && TOPIC_BY_ID[control.id]) {
            return TOPIC_BY_ID[control.id];
        }

        const embeddedInput = control.querySelector('input[id]');
        if (embeddedInput && TOPIC_BY_ID[embeddedInput.id]) {
            return TOPIC_BY_ID[embeddedInput.id];
        }

        const hrefFile = getHrefFilename(control);
        if (hrefFile && TOPIC_BY_HREF_FILE[hrefFile]) {
            return TOPIC_BY_HREF_FILE[hrefFile];
        }

        return null;
    }

    function buildFallbackTopic(control) {
        const hint = getControlHintText(control) || 'Toolbar control';
        return {
            title: hint,
            summary: 'This control is available in helper mode preview.',
            points: [
                'Click again with help mode off to execute the action.',
                'Use left/right arrow keys to move between controls.',
                'Press H or Esc to exit helper mode.'
            ],
            anchor: 'quick-start'
        };
    }

    function setTopicPoints(pointsEl, items) {
        pointsEl.innerHTML = '';
        const safeItems = Array.isArray(items) && items.length ? items : ['No additional guidance available.'];
        safeItems.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = item;
            pointsEl.appendChild(li);
        });
    }

    function getHintProgress(control) {
        const appState = getAppState();
        if (!appState || !Array.isArray(appState.designerHintTargets)) return '';
        const total = appState.designerHintTargets.length;
        if (!total) return '';

        const idx = appState.designerHintTargets.findIndex((target) => target && target.node === control);
        if (idx >= 0) return `${idx + 1}/${total}`;

        if (Number.isFinite(appState.designerHintIndex) && appState.designerHintIndex >= 0 && appState.designerHintIndex < total) {
            return `${appState.designerHintIndex + 1}/${total}`;
        }

        return '';
    }

    function focusHintTarget(control) {
        const appState = getAppState();
        if (!appState || !Array.isArray(appState.designerHintTargets)) return;
        const index = appState.designerHintTargets.findIndex((target) => target && target.node === control);
        if (index >= 0 && typeof setActiveDesignerHintIndex === 'function') {
            setActiveDesignerHintIndex(index);
        }
    }

    function showHelpSidebar() {
        const els = getHelpElements();
        if (!els.sidebar || !els.helpSection) return false;

        ['settings-props', 'box-props', 'lane-props', 'help-props'].forEach((id) => {
            const section = document.getElementById(id);
            if (!section) return;
            if (id === 'help-props') {
                section.classList.remove('hidden');
            } else {
                section.classList.add('hidden');
            }
        });

        if (els.title) {
            els.title.textContent = 'Tool Help';
        }

        els.sidebar.classList.remove('hidden');
        els.sidebar.classList.add('visible');

        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.classList.remove('active');
        }

        const v2 = getV2State();
        if (v2 && v2.isV2) {
            v2.currentMode = 'help';
        }

        return true;
    }

    function patchV2SidebarModes() {
        const v2 = getV2State();
        if (!v2 || !v2.isV2 || typeof v2.showRightSidebar !== 'function') return false;
        if (v2.__contextHelpSidebarPatched) return true;

        const originalShowRightSidebar = v2.showRightSidebar;
        const originalHideRightSidebar = typeof v2.hideRightSidebar === 'function'
            ? v2.hideRightSidebar
            : null;

        v2.showRightSidebar = function (mode) {
            const helpSection = document.getElementById('help-props');
            if (helpSection && mode !== 'help') {
                helpSection.classList.add('hidden');
            }

            if (mode === 'help') {
                showHelpSidebar();
                return;
            }

            return originalShowRightSidebar.call(this, mode);
        };

        if (originalHideRightSidebar) {
            v2.hideRightSidebar = function () {
                const helpSection = document.getElementById('help-props');
                if (helpSection) helpSection.classList.add('hidden');
                return originalHideRightSidebar.call(this);
            };
        }

        v2.__contextHelpSidebarPatched = true;
        return true;
    }

    function waitForV2Ready(callback, attempts = 0) {
        const v2 = getV2State();
        if (v2 && v2.isV2) {
            callback();
            return;
        }
        if (attempts > 240) return;
        requestAnimationFrame(() => waitForV2Ready(callback, attempts + 1));
    }

    function openContextHelp(topicKey, control) {
        const els = getHelpElements();
        if (!els.helpSection || !els.topicTitle || !els.summary || !els.points || !els.link || !els.step || !els.shortcut) {
            return;
        }

        const topic = HELP_TOPICS[topicKey] || buildFallbackTopic(control);
        const progress = getHintProgress(control);

        els.step.textContent = progress || '•';
        els.topicTitle.textContent = topic.title;
        els.summary.textContent = topic.summary;
        setTopicPoints(els.points, topic.points);

        if (topic.shortcut) {
            els.shortcut.classList.remove('hidden');
            els.shortcut.textContent = topic.shortcut;
        } else {
            els.shortcut.classList.add('hidden');
            els.shortcut.textContent = '';
        }

        const anchor = topic.anchor ? `#${topic.anchor}` : '';
        els.link.href = `help.html${anchor}`;

        showHelpSidebar();
    }

    function handleToolbarClickInHelperMode(event) {
        const appState = getAppState();
        if (!appState || !appState.designerHintsVisible) return;

        const control = getToolbarControl(event.target);
        if (!control) return;

        const topicKey = resolveTopicKey(control);

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }

        if (typeof hideUiTooltip === 'function') {
            hideUiTooltip();
        }

        focusHintTarget(control);
        openContextHelp(topicKey, control);
    }

    function init() {
        if (!document.getElementById('help-props')) return;
        waitForV2Ready(() => patchV2SidebarModes());
        document.addEventListener('click', handleToolbarClickInHelperMode, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
