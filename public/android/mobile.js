/* Touch affordances over the existing vanilla UI; never enabled by UA/viewport. */
(function () {
    'use strict';
    if (!window.TermixAndroid) return;
    const mobile = {
        initialized: false,
        toolbarCleanup: null,
        init() {
            if (this.initialized) return;
            this.initialized = true;
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                sidebar.id = sidebar.id || 'android-navigation';
                sidebar.setAttribute('aria-label', 'Main navigation');
                sidebar.classList.add('collapsed');
            }
            const toggle = document.getElementById('sidebar-toggle');
            if (toggle) {
                this.makeButton(toggle, 'Open navigation');
                toggle.setAttribute('aria-controls', sidebar.id);
                toggle.setAttribute('aria-expanded', 'false');
            }
            const backdrop = document.createElement('button');
            backdrop.id = 'android-nav-backdrop';
            backdrop.type = 'button';
            backdrop.setAttribute('aria-label', 'Close navigation');
            backdrop.addEventListener('click', () => this.closeNavigation());
            document.body.appendChild(backdrop);
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'android-nav-close';
            close.textContent = 'Close';
            close.addEventListener('click', () => this.closeNavigation());
            document.querySelector('.sidebar-header')?.appendChild(close);
            document.querySelectorAll('.sidebar-menu li').forEach(item => {
                this.makeButton(item, item.textContent.trim());
                item.addEventListener('click', () => this.closeNavigation());
            });
            document.getElementById('create-user-btn')?.addEventListener('click', () => this.closeNavigation());
            this.makeButton(document.getElementById('profile-btn'), 'Switch profile');
            this.makeButton(document.getElementById('create-user-btn'), 'Create local profile');
            this.makeButton(document.getElementById('close-drawer'), 'Close form');
            this.makeButton(document.getElementById('drawer-check'), 'Save form');
            this.applyCapabilities();
            this.updateViewport();
            window.addEventListener('resize', () => this.updateViewport());
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', () => this.updateViewport());
                window.visualViewport.addEventListener('scroll', () => this.updateViewport());
            }
            this.installTrustPrompt();
        },
        makeButton(element, label) {
            if (!element || element.tagName === 'BUTTON') return;
            element.setAttribute('role', 'button');
            element.setAttribute('tabindex', '0');
            element.setAttribute('aria-label', label);
            element.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    element.click();
                }
            });
        },
        setNavigation(open) {
            document.querySelector('.sidebar')?.classList.toggle('collapsed', !open);
            document.body.classList.toggle('android-nav-open', open);
            const toggle = document.getElementById('sidebar-toggle');
            toggle?.setAttribute('aria-expanded', String(open));
            toggle?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
            if (open) document.querySelector('.sidebar-menu li:not([hidden])')?.focus();
        },
        closeNavigation() { this.setNavigation(false); },
        updateViewport() {
            const viewport = window.visualViewport;
            document.documentElement.style.setProperty('--android-height', `${Math.round(viewport ? viewport.height : window.innerHeight)}px`);
            document.documentElement.style.setProperty('--android-top', `${Math.round(viewport ? viewport.offsetTop : 0)}px`);
            // ResizeObserver in ConnectionModule owns terminal fitting and backend resize.
        },
        applyCapabilities(root = document) {
            const has = name => window.TermixAndroid.hasCapability(name);
            const hide = selector => root.querySelectorAll(selector).forEach(element => {
                element.hidden = true;
                element.classList.add('android-unsupported');
            });
            const modules = { ai: 'ai', 'port-forwarding': 'portForwarding', sftp: 'sftp', keychain: 'keychain', 'known-hosts': 'knownHosts', snippets: 'snippets' };
            Object.entries(modules).forEach(([module, capability]) => {
                if (!has(capability)) hide(`[data-module="${module}"]`);
            });
            if (!has('cloud')) hide('#type-firebase-label, #type-qmm-label, #firebase-section, #qmm-section, #firebase-sync-options, #profile-sync-icon');
            if (!has('updater')) hide('.update-card');
            if (!has('ai') && !has('mcp')) {
                const card = root.querySelector('#ai-url')?.closest('.settings-card');
                if (card) { card.hidden = true; card.classList.add('android-unsupported'); }
            }
            hide('#btn-open-config-file, #btn-open-profile-folder');
            if (!has('local')) root.querySelector('button i.fa-terminal')?.closest('button')?.classList.add('android-unsupported');
            if (!has('serial')) root.querySelector('button i.fa-microchip')?.closest('button')?.classList.add('android-unsupported');
            const searchInput = root.querySelector('.search-bar input');
            if (searchInput) searchInput.placeholder = 'Search hosts or ssh...';
            root.querySelectorAll('input[type="text"], textarea').forEach(input => {
                if (input.classList.contains('xterm-helper-textarea')) return;
                input.setAttribute('autocapitalize', 'off');
                input.setAttribute('spellcheck', 'false');
                input.setAttribute('autocorrect', 'off');
                if (!input.hasAttribute('aria-label') && input.placeholder) input.setAttribute('aria-label', input.placeholder);
            });
        },
        installTrustPrompt() {
            window.electronAPI.on('android:host-key', async (_event, payload) => {
                if (!payload || !payload.requestId) return;
                try {
                    await window.TermixAndroid.invoke('android:trust-host-key', { requestId: payload.requestId, accept: true });
                } catch (_) {}
            });
        },
        attachTerminal(container, term, sendInput, resizeTerminal) {
            const bar = document.createElement('div');
            bar.className = 'android-terminal-toolbar';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', 'Terminal keys');

            const modifiers = ['Ctrl', 'Alt'].map(name => ({ name, held: false, latched: false, used: false, pointer: null, button: null }));
            const updateModifiers = () => modifiers.forEach(m => m.button.setAttribute('aria-pressed', String(m.held || m.latched)));
            const consumeModifiers = () => {
                const active = modifiers.map(m => m.held || m.latched);
                modifiers.forEach(m => { if (m.held) m.used = true; m.latched = false; });
                updateModifiers();
                return active;
            };
            const resetModifiers = () => {
                modifiers.forEach(m => { m.held = false; m.latched = false; m.pointer = null; });
                updateModifiers();
            };
            const stop = event => { event.preventDefault(); event.stopPropagation(); };
            const makeButton = (text, label) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = text;
                button.setAttribute('aria-label', label);
                bar.appendChild(button);
                return button;
            };
            // Keep the IME's textarea focused; don't let legacy touch/mouse handlers
            // on the terminal container interfere with a held modifier.
            bar.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
            bar.addEventListener('mousedown', stop);
            bar.addEventListener('contextmenu', stop);
            modifiers.forEach(m => {
                const button = m.button = makeButton(m.name, `${m.name} modifier (hold or tap)`);
                button.addEventListener('pointerdown', event => {
                    stop(event);
                    if (m.pointer !== null) return;
                    m.pointer = event.pointerId;
                    m.held = true;
                    m.used = false;
                    try { button.setPointerCapture(event.pointerId); } catch (_) {}
                    updateModifiers();
                });
                button.addEventListener('pointerup', event => {
                    stop(event);
                    if (m.pointer !== event.pointerId) return;
                    m.pointer = null;
                    m.held = false;
                    m.latched = m.used ? false : !m.latched;
                    updateModifiers();
                });
                const cancel = () => {
                    if (m.pointer === null) return;
                    m.pointer = null;
                    m.held = false;
                    m.latched = false;
                    updateModifiers();
                };
                button.addEventListener('pointercancel', cancel);
                button.addEventListener('lostpointercapture', cancel);
                button.addEventListener('click', event => {
                    stop(event);
                    // Pointer clicks have already been handled, regardless of delay.
                    if (event.detail !== 0) return;
                    m.latched = !m.latched;
                    updateModifiers();
                });
            });
            updateModifiers();
            window.addEventListener('blur', resetModifiers);

            const add = (text, label, action) => {
                const button = makeButton(text, label);
                const run = () => Promise.resolve().then(action).catch(error => window.notifyUser?.(error.message, 'error'));
                button.addEventListener('pointerdown', event => { stop(event); run(); });
                button.addEventListener('click', event => { stop(event); if (event.detail === 0) run(); });
                return button;
            };
            const arrow = (code, ctrl, alt) => {
                const modifier = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
                if (modifier !== 1) return `\x1b[1;${modifier}${code}`;
                return `\x1b${term.modes?.applicationCursorKeysMode ? 'O' : '['}${code}`;
            };
            let isBeforeInputHandling = false;
            let lastHandledInput = { text: '', time: 0 };
            const filterInput = data => {
                if (!data) return data;
                // Deduplicate if this exact data was already processed within 60ms by beforeinput
                if (!isBeforeInputHandling && lastHandledInput.text && data === lastHandledInput.text && (Date.now() - lastHandledInput.time) < 60) {
                    return '';
                }
                const [ctrl, alt] = consumeModifiers();
                const cursor = /^\x1b(?:\[|O)([ABCD])$/.exec(data);
                if (cursor) return arrow(cursor[1], ctrl, alt);
                // Never mutate escape sequences or bracketed paste payloads.
                if (data.startsWith('\x1b')) return data;
                let result = data;
                if (ctrl && data.length === 1) {
                    const code = data.toUpperCase().charCodeAt(0);
                    if (code >= 64 && code <= 95) result = String.fromCharCode(code - 64);
                    else if (data === ' ') result = '\x00';
                    else if (data === '?') result = '\x7f';
                }
                return alt ? '\x1b' + result : result;
            };
            [['Esc', 'Escape', '\x1b'], ['Tab', 'Tab', '\t']].forEach(([text, label, data]) => {
                add(text, label, () => sendInput(filterInput(data)));
            });
            [['↑', 'Arrow up', 'A'], ['↓', 'Arrow down', 'B'], ['←', 'Arrow left', 'D'], ['→', 'Arrow right', 'C']].forEach(([text, label, code]) => {
                add(text, label, () => {
                    const [ctrl, alt] = consumeModifiers();
                    sendInput(arrow(code, ctrl, alt));
                });
            });

            add('Copy', 'Copy terminal text', async () => {
                let text = '';
                const domSel = typeof window.getSelection === 'function' ? window.getSelection() : null;
                if (domSel && !domSel.isCollapsed) {
                    text = domSel.toString();
                }
                if (!text && typeof term.getSelection === 'function') {
                    text = term.getSelection();
                }
                if (!text && term.buffer && term.buffer.active) {
                    const buffer = term.buffer.active;
                    const lines = [];
                    const start = Math.max(0, buffer.viewportY);
                    const end = Math.min(buffer.length, start + term.rows);
                    for (let i = start; i < end; i++) {
                        const line = buffer.getLine(i);
                        if (line) lines.push(line.translateToString(true));
                    }
                    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
                        lines.pop();
                    }
                    text = lines.join('\n');
                }
                if (!text) {
                    return;
                }
                if (window.clipboard && typeof window.clipboard.writeText === 'function') {
                    await window.clipboard.writeText(text);
                }
            });

            add('Paste', 'Paste clipboard into terminal', async () => {
                if (window.clipboard && typeof window.clipboard.readText === 'function') {
                    const text = await window.clipboard.readText();
                    if (typeof text === 'string' && text) {
                        if (typeof term.paste === 'function') {
                            term.paste(text);
                        } else {
                            sendInput(text);
                        }
                    }
                }
                term.focus();
                try { term.scrollToBottom(); } catch (_) {}
            });

            add('Clear', 'Clear terminal screen', () => sendInput('\x0c'));
            add('Kbd', 'Show terminal keyboard', async () => {
                term.focus();
                await window.TermixAndroid.showKeyboard();
            });

            const body = document.createElement('div');
            body.className = 'android-terminal-body';
            body.appendChild(term.element);
            container.classList.add('android-terminal');
            container.appendChild(body);
            container.appendChild(bar);

            const textarea = term.textarea || (term.element && term.element.querySelector ? term.element.querySelector('.xterm-helper-textarea') : null) || (container.querySelector ? container.querySelector('.xterm-helper-textarea') : null);

            // Fast typing input interception for Android software keyboards
            const handleBeforeInput = event => {
                const type = event.inputType;
                const data = event.data;
                if (type === 'insertText' || type === 'insertReplacementText') {
                    if (typeof data === 'string' && data.length > 0) {
                        event.preventDefault();
                        isBeforeInputHandling = true;
                        lastHandledInput = { text: data, time: Date.now() };
                        sendInput(filterInput(data));
                        isBeforeInputHandling = false;
                    }
                } else if (type === 'insertLineBreak' || type === 'insertParagraph') {
                    event.preventDefault();
                    isBeforeInputHandling = true;
                    lastHandledInput = { text: '\r', time: Date.now() };
                    sendInput('\r');
                    isBeforeInputHandling = false;
                } else if (type === 'deleteContentBackward') {
                    event.preventDefault();
                    isBeforeInputHandling = true;
                    lastHandledInput = { text: '\x7f', time: Date.now() };
                    sendInput('\x7f');
                    isBeforeInputHandling = false;
                } else if (type === 'deleteWordBackward') {
                    event.preventDefault();
                    isBeforeInputHandling = true;
                    lastHandledInput = { text: '\x17', time: Date.now() };
                    sendInput('\x17');
                    isBeforeInputHandling = false;
                }
            };

            const handleCompositionEnd = event => {
                if (event.data) {
                    isBeforeInputHandling = true;
                    lastHandledInput = { text: event.data, time: Date.now() };
                    sendInput(filterInput(event.data));
                    isBeforeInputHandling = false;
                }
                try { if (textarea) textarea.value = ''; } catch (_) {}
            };

            if (textarea && typeof textarea.addEventListener === 'function') {
                textarea.addEventListener('beforeinput', handleBeforeInput);
                textarea.addEventListener('compositionend', handleCompositionEnd);
            }

            // Touch text selection recognizer & gesture engine
            let longPressTimer = null;
            let autoScrollTimer = null;
            let currentScrollDirection = 0;
            let touchStartX = 0;
            let touchStartY = 0;
            let lastTouchY = 0;
            let scrollAccumulator = 0;
            let isSelecting = false;
            let isScrolling = false;
            let touchStartedWithSelection = false;
            let selectionAnchor = null;
            let currentTouchClientX = 0;
            let currentTouchClientY = 0;

            const getTouchCoords = (clientX, clientY) => {
                const screen = (container.querySelector ? container.querySelector('.xterm-screen') : null) || body;
                if (!screen || !screen.getBoundingClientRect) return null;
                const rect = screen.getBoundingClientRect();
                const cols = term.cols || 80;
                const rows = term.rows || 24;
                const cellW = rect.width / cols;
                const cellH = rect.height / rows;
                if (cellW <= 0 || cellH <= 0) return null;
                const col = Math.max(0, Math.min(cols - 1, Math.floor((clientX - rect.left) / cellW)));
                const row = Math.max(0, Math.min(rows - 1, Math.floor((clientY - rect.top) / cellH)));
                const buffer = term.buffer ? term.buffer.active : null;
                if (!buffer) return null;
                const lineIndex = buffer.viewportY + row;
                return { col, row, lineIndex, buffer, cellW, cellH, rect };
            };

            const cancelLongPress = () => {
                if (longPressTimer !== null) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            };

            const stopAutoScroll = () => {
                currentScrollDirection = 0;
                if (autoScrollTimer !== null) {
                    clearInterval(autoScrollTimer);
                    autoScrollTimer = null;
                }
            };

            const selectAt = (clientX, clientY) => {
                const pos = getTouchCoords(clientX, clientY);
                if (!pos) return;
                const line = pos.buffer.getLine ? pos.buffer.getLine(pos.lineIndex) : null;
                const lineStr = line && typeof line.translateToString === 'function' ? line.translateToString(true) : '';
                let startCol = pos.col;
                let endCol = pos.col;

                if (pos.col < lineStr.length && /\S/.test(lineStr[pos.col])) {
                    while (startCol > 0 && /\S/.test(lineStr[startCol - 1])) startCol--;
                    while (endCol < lineStr.length && /\S/.test(lineStr[endCol])) endCol++;
                } else {
                    endCol = Math.min(lineStr.length, pos.col + 1);
                }
                const len = Math.max(1, endCol - startCol);
                selectionAnchor = { col: startCol, lineIndex: pos.lineIndex, wordLen: len };
                if (typeof term.select === 'function') {
                    term.select(startCol, pos.lineIndex, len);
                }
            };

            const updateSelection = (clientX, clientY) => {
                if (!selectionAnchor) return;
                const pos = getTouchCoords(clientX, clientY);
                if (!pos) return;

                const anchorCol = selectionAnchor.col;
                const anchorLine = selectionAnchor.lineIndex;
                const currentLine = pos.lineIndex;
                const currentCol = pos.col;

                if (typeof term.select !== 'function') return;

                const cols = term.cols || 80;
                if (currentLine === anchorLine) {
                    const start = Math.min(anchorCol, currentCol);
                    const end = Math.max(anchorCol + selectionAnchor.wordLen, currentCol + 1);
                    term.select(start, anchorLine, Math.max(1, end - start));
                } else if (currentLine > anchorLine) {
                    const length = (currentLine - anchorLine) * cols + (currentCol - anchorCol) + 1;
                    term.select(anchorCol, anchorLine, Math.max(1, length));
                } else {
                    const length = (anchorLine - currentLine) * cols + (anchorCol + selectionAnchor.wordLen - currentCol);
                    term.select(currentCol, currentLine, Math.max(1, length));
                }
            };

            const checkEdgeAutoScroll = (clientX, clientY) => {
                if (!isSelecting) {
                    stopAutoScroll();
                    return;
                }
                currentTouchClientX = clientX;
                currentTouchClientY = clientY;

                const screen = (container.querySelector ? container.querySelector('.xterm-screen') : null) || body;
                if (!screen || !screen.getBoundingClientRect) return;
                const rect = screen.getBoundingClientRect();
                const rectTop = typeof rect.top === 'number' ? rect.top : 0;
                const rectBottom = typeof rect.bottom === 'number' ? rect.bottom : (rectTop + (rect.height || 0));
                const EDGE_THRESHOLD = 50;

                if (clientY < rectTop + EDGE_THRESHOLD) {
                    currentScrollDirection = -1;
                } else if (clientY > rectBottom - EDGE_THRESHOLD) {
                    currentScrollDirection = 1;
                } else {
                    currentScrollDirection = 0;
                }

                if (currentScrollDirection !== 0) {
                    if (!autoScrollTimer) {
                        autoScrollTimer = setInterval(() => {
                            if (!isSelecting || currentScrollDirection === 0) {
                                stopAutoScroll();
                                return;
                            }
                            const buffer = term.buffer ? term.buffer.active : null;
                            if (buffer) {
                                if (currentScrollDirection < 0 && buffer.viewportY <= 0) return;
                                if (currentScrollDirection > 0 && buffer.viewportY >= buffer.baseY) return;
                            }
                            if (typeof term.scrollLines === 'function') {
                                term.scrollLines(currentScrollDirection);
                            }
                            updateSelection(currentTouchClientX, currentTouchClientY);
                        }, 180);
                    }
                } else {
                    stopAutoScroll();
                }
            };

            const onTouchStart = event => {
                if (!event.touches || event.touches.length !== 1) {
                    cancelLongPress();
                    stopAutoScroll();
                    return;
                }
                const touch = event.touches[0];
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                lastTouchY = touch.clientY;
                scrollAccumulator = 0;

                const hasSelectionNow = Boolean(typeof term.hasSelection === 'function' && term.hasSelection());
                touchStartedWithSelection = hasSelectionNow;

                if (hasSelectionNow) {
                    isSelecting = true;
                    isScrolling = false;
                    cancelLongPress();
                    if (!selectionAnchor) {
                        const pos = getTouchCoords(touchStartX, touchStartY);
                        if (pos) {
                            selectionAnchor = { col: pos.col, lineIndex: pos.lineIndex, wordLen: 1 };
                        }
                    }
                } else {
                    isSelecting = false;
                    isScrolling = false;
                    selectionAnchor = null;
                    cancelLongPress();
                    longPressTimer = setTimeout(() => {
                        isSelecting = true;
                        isScrolling = false;
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                            try { navigator.vibrate(25); } catch (_) {}
                        }
                        selectAt(touchStartX, touchStartY);
                    }, 300);
                }
            };

            const onTouchMove = event => {
                if (!event.touches || event.touches.length !== 1) {
                    cancelLongPress();
                    stopAutoScroll();
                    return;
                }
                const touch = event.touches[0];

                if (isSelecting) {
                    if (event.cancelable) event.preventDefault();
                    updateSelection(touch.clientX, touch.clientY);
                    checkEdgeAutoScroll(touch.clientX, touch.clientY);
                    return;
                }

                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;

                if (!isScrolling && Math.hypot(dx, dy) > 14) {
                    cancelLongPress();
                    isScrolling = true;
                }

                if (isScrolling) {
                    if (event.cancelable) event.preventDefault();
                    const deltaY = touch.clientY - lastTouchY;
                    lastTouchY = touch.clientY;
                    scrollAccumulator += deltaY;

                    const screen = (container.querySelector ? container.querySelector('.xterm-screen') : null) || body;
                    const rect = screen && screen.getBoundingClientRect ? screen.getBoundingClientRect() : null;
                    const rows = term.rows || 24;
                    const cellH = rect && rows > 0 ? (rect.height / rows) : 20;

                    if (Math.abs(scrollAccumulator) >= cellH) {
                        const lines = Math.trunc(scrollAccumulator / cellH);
                        scrollAccumulator -= lines * cellH;
                        if (typeof term.scrollLines === 'function') {
                            term.scrollLines(-lines);
                        }
                    }
                }
            };

            const onTouchEnd = event => {
                cancelLongPress();
                stopAutoScroll();

                const touch = event.changedTouches && event.changedTouches[0];
                const endX = touch ? touch.clientX : touchStartX;
                const endY = touch ? touch.clientY : touchStartY;
                const isTap = Math.hypot(endX - touchStartX, endY - touchStartY) < 14;

                if (touchStartedWithSelection && isTap) {
                    if (typeof term.clearSelection === 'function') {
                        term.clearSelection();
                    }
                    selectionAnchor = null;
                    isSelecting = false;
                    isScrolling = false;
                    touchStartedWithSelection = false;
                    return;
                }

                if (isSelecting) {
                    if (event.cancelable) event.preventDefault();
                    isSelecting = false;
                    isScrolling = false;
                    return;
                }

                if (!isScrolling && isTap) {
                    const domSel = typeof window.getSelection === 'function' ? window.getSelection() : null;
                    if (domSel && !domSel.isCollapsed) {
                        return;
                    }
                    if (typeof term.hasSelection === 'function' && term.hasSelection()) {
                        term.clearSelection();
                        selectionAnchor = null;
                    } else {
                        term.focus();
                        if (window.TermixAndroid && typeof window.TermixAndroid.showKeyboard === 'function') {
                            window.TermixAndroid.showKeyboard().catch(() => {});
                        }
                    }
                }
                isScrolling = false;
            };

            const onTouchCancel = () => {
                cancelLongPress();
                stopAutoScroll();
                isSelecting = false;
                isScrolling = false;
            };

            const onContextMenu = event => {
                const domSel = typeof window.getSelection === 'function' ? window.getSelection() : null;
                const hasDomSelection = domSel && !domSel.isCollapsed;
                const hasTermSelection = typeof term.hasSelection === 'function' && term.hasSelection();
                if (!hasDomSelection && !hasTermSelection) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            };

            body.addEventListener('touchstart', onTouchStart, { passive: true });
            body.addEventListener('touchmove', onTouchMove, { passive: false });
            body.addEventListener('touchend', onTouchEnd, { passive: false });
            body.addEventListener('touchcancel', onTouchCancel, { passive: true });
            body.addEventListener('contextmenu', onContextMenu, true);

            let frame = null;
            const onViewportResize = () => {
                if (frame !== null) cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => {
                    frame = null;
                    if (!container.isConnected || !container.clientHeight) return;
                    resizeTerminal?.();
                    term.scrollToBottom();
                });
            };
            window.visualViewport?.addEventListener('resize', onViewportResize);
            const observer = new ResizeObserver(onViewportResize);
            observer.observe(body);
            onViewportResize();
            return {
                filterInput,
                dispose() {
                    cancelLongPress();
                    stopAutoScroll();
                    if (textarea && typeof textarea.removeEventListener === 'function') {
                        textarea.removeEventListener('beforeinput', handleBeforeInput);
                        textarea.removeEventListener('compositionend', handleCompositionEnd);
                    }
                    body.removeEventListener('touchstart', onTouchStart);
                    body.removeEventListener('touchmove', onTouchMove);
                    body.removeEventListener('touchend', onTouchEnd);
                    body.removeEventListener('touchcancel', onTouchCancel);
                    body.removeEventListener('contextmenu', onContextMenu, true);
                    observer.disconnect();
                    if (frame !== null) cancelAnimationFrame(frame);
                    window.removeEventListener('blur', resetModifiers);
                    window.visualViewport?.removeEventListener('resize', onViewportResize);
                    bar.remove();
                }
            };
        }
    };
    window.TermixMobile = mobile;
})();
