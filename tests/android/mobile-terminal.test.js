'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function terminalToolbar() {
    class Element extends EventTarget {
        constructor() { super(); this.children = []; this.attributes = {}; this.classList = { add() {} }; }
        appendChild(child) { this.children.push(child); return child; }
        setAttribute(key, value) { this.attributes[key] = value; }
        setPointerCapture() {}
        remove() {}
    }
    const window = new EventTarget();
    window.TermixAndroid = { showKeyboard: async () => {} };
    const container = new Element();
    const textarea = new Element();
    textarea.classList = { add() {}, contains(c) { return c === 'xterm-helper-textarea'; } };
    const term = {
        element: new Element(),
        textarea,
        modes: { applicationCursorKeysMode: false },
        cols: 80,
        rows: 24,
        buffer: {
            active: {
                viewportY: 0,
                baseY: 10,
                length: 34,
                getLine(i) {
                    return {
                        translateToString() { return 'user@host:~$ ls -la /tmp'; }
                    };
                }
            }
        },
        selection: '',
        scrolledLines: 0,
        scrollLines(n) {
            this.scrolledLines += n;
            this.buffer.active.viewportY = Math.max(0, Math.min(this.buffer.active.baseY, this.buffer.active.viewportY + n));
        },
        select(col, row, len) {
            this.selection = `selected:${col}:${row}:${len}`;
        },
        getSelection() {
            return this.selection;
        },
        hasSelection() {
            return Boolean(this.selection);
        },
        clearSelection() {
            this.selection = '';
        },
        scrollToBottom() {},
        focus() { this.focused = true; }
    };
    term.element.querySelector = sel => sel === '.xterm-helper-textarea' ? textarea : null;
    const inputs = [];
    const context = vm.createContext({
        console,
        window,
        document: { createElement: () => new Element() },
        ResizeObserver: class { observe() {} disconnect() {} },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/android/mobile.js'), 'utf8'), context);
    const toolbar = window.TermixMobile.attachTerminal(container, term, data => inputs.push(data));
    const buttons = container.children[1].children;
    const button = name => buttons.find(b => b.textContent === name);
    const event = (target, type, properties = {}) => {
        const value = new Event(type, { cancelable: true });
        Object.assign(value, { pointerId: 1, detail: 1 }, properties);
        target.dispatchEvent(value);
    };
    const tap = name => { event(button(name), 'pointerdown'); event(button(name), 'pointerup'); event(button(name), 'click'); };
    return { toolbar, button, event, tap, inputs, term, window, container, textarea };
}

test('Ctrl tap/hold, Alt and cancellation preserve exact terminal bytes', () => {
    const h = terminalToolbar();
    h.tap('Ctrl');
    assert.equal(h.toolbar.filterInput('c'), '\x03');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.event(h.button('Ctrl'), 'pointerdown');
    assert.equal(h.toolbar.filterInput('c'), '\x03');
    assert.equal(h.toolbar.filterInput('d'), '\x04');
    h.event(h.button('Ctrl'), 'pointerup');
    h.event(h.button('Ctrl'), 'click');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.tap('Alt');
    assert.equal(h.toolbar.filterInput('x'), '\x1bx');
    h.event(h.button('Ctrl'), 'pointerdown');
    h.event(h.button('Ctrl'), 'pointercancel');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.tap('Ctrl');
    h.window.dispatchEvent(new Event('blur'));
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.toolbar.dispose();
});

test('delayed pointer click cannot relatch a consumed modifier', () => {
    const h = terminalToolbar();
    h.event(h.button('Ctrl'), 'pointerdown');
    h.event(h.button('Ctrl'), 'pointerup');
    assert.equal(h.toolbar.filterInput('c'), '\x03');
    h.event(h.button('Ctrl'), 'click');
    assert.equal(h.toolbar.filterInput('c'), 'c');
    h.toolbar.dispose();
});

test('arrows follow cursor mode and modifiers without corrupting escape payloads', async () => {
    const h = terminalToolbar();
    for (const [name, code] of [['↑', 'A'], ['↓', 'B'], ['←', 'D'], ['→', 'C']]) {
        h.tap(name);
        await Promise.resolve();
        assert.equal(h.inputs.pop(), '\x1b[' + code);
    }
    h.term.modes.applicationCursorKeysMode = true;
    h.tap('↑');
    await Promise.resolve();
    assert.equal(h.inputs.pop(), '\x1bOA');
    h.tap('Ctrl');
    h.tap('↑');
    await Promise.resolve();
    assert.equal(h.inputs.pop(), '\x1b[1;5A');
    h.tap('Alt');
    assert.equal(h.toolbar.filterInput('\x1b[D'), '\x1b[1;3D');
    h.tap('Ctrl');
    assert.equal(h.toolbar.filterInput('\x1b[200~hello\x1b[201~'), '\x1b[200~hello\x1b[201~');
    h.toolbar.dispose();
});

test('fast typing via beforeinput intercepts keystrokes, prevents default, and dispatches immediately', () => {
    const h = terminalToolbar();
    const emitBeforeInput = (inputType, data) => {
        const ev = new Event('beforeinput', { cancelable: true });
        ev.inputType = inputType;
        ev.data = data;
        let defaultPrevented = false;
        ev.preventDefault = () => { defaultPrevented = true; };
        h.textarea.dispatchEvent(ev);
        return defaultPrevented;
    };

    // Fast sequence: 'h', 'e', 'l', 'l', 'o'
    for (const ch of ['h', 'e', 'l', 'l', 'o']) {
        const prevented = emitBeforeInput('insertText', ch);
        assert.equal(prevented, true, `beforeinput for '${ch}' should be prevented`);
        assert.equal(h.inputs.pop(), ch);
    }

    // Enter and Backspace
    assert.equal(emitBeforeInput('insertLineBreak', null), true);
    assert.equal(h.inputs.pop(), '\r');

    assert.equal(emitBeforeInput('deleteContentBackward', null), true);
    assert.equal(h.inputs.pop(), '\x7f');

    // Ctrl latch + beforeinput
    h.tap('Ctrl');
    assert.equal(emitBeforeInput('insertText', 'c'), true);
    assert.equal(h.inputs.pop(), '\x03'); // Ctrl+C byte!

    h.toolbar.dispose();
});

test('touch text selection and Copy button integration', async () => {
    const h = terminalToolbar();
    let clipboardContent = '';
    h.window.clipboard = {
        writeText: async (t) => { clipboardContent = t; }
    };

    // Body is container.children[0]
    const body = h.container.children[0];
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480 });

    // Simulate touchstart at col 0, row 0
    const touchStart = new Event('touchstart', { cancelable: true });
    touchStart.touches = [{ clientX: 10, clientY: 10 }];
    body.dispatchEvent(touchStart);

    // Wait for long-press timer (350ms)
    await new Promise(r => setTimeout(r, 380));

    // Selection should be activated for the first word 'user@host:~$' (12 characters)
    assert.ok(h.term.hasSelection(), 'Terminal should have selection after long press');
    assert.equal(h.term.getSelection(), 'selected:0:0:12');

    // Tap Copy button
    h.tap('Copy');
    await Promise.resolve();
    assert.equal(clipboardContent, 'selected:0:0:12', 'Copy should write selected text to clipboard');

    h.toolbar.dispose();
});

test('contextmenu event is defaultPrevented on body to stop accidental paste', () => {
    const h = terminalToolbar();
    const body = h.container.children[0];
    const cmEvent = new Event('contextmenu', { cancelable: true });
    body.dispatchEvent(cmEvent);
    assert.equal(cmEvent.defaultPrevented, true, 'contextmenu should be prevented on Android terminal body');
    h.toolbar.dispose();
});

test('swipe gestures scroll lines without triggering selection or keyboard focus', async () => {
    const h = terminalToolbar();
    const body = h.container.children[0];
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480 });

    const touchStart = new Event('touchstart', { cancelable: true });
    touchStart.touches = [{ clientX: 100, clientY: 200 }];
    body.dispatchEvent(touchStart);

    // Fast vertical drag (swipe up by 50px)
    const touchMove = new Event('touchmove', { cancelable: true });
    touchMove.touches = [{ clientX: 100, clientY: 150 }];
    body.dispatchEvent(touchMove);

    // Wait past 350ms to ensure long press timer was cancelled by swipe
    await new Promise(r => setTimeout(r, 380));

    assert.equal(h.term.hasSelection(), false, 'Swipe should cancel long press and not select');
    assert.ok(h.term.scrolledLines > 0, 'Swipe should have scrolled terminal lines upward');

    const touchEnd = new Event('touchend', { cancelable: true });
    body.dispatchEvent(touchEnd);

    assert.equal(h.term.focused, undefined, 'Swipe touch end should not trigger keyboard focus');
    h.toolbar.dispose();
});

test('touch drag expands selection across lines and isolates clipboard', async () => {
    const h = terminalToolbar();
    let clipboardWrites = 0;
    h.window.clipboard = {
        writeText: async () => { clipboardWrites++; }
    };
    const body = h.container.children[0];
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480 });

    // Touchstart at col 0, row 0
    const touchStart = new Event('touchstart', { cancelable: true });
    touchStart.touches = [{ clientX: 10, clientY: 10 }];
    body.dispatchEvent(touchStart);

    // Long press
    await new Promise(r => setTimeout(r, 380));
    assert.ok(h.term.hasSelection());
    assert.equal(clipboardWrites, 0, 'Selection must not write to clipboard automatically');

    // Drag to col 20 on next row
    const touchMove = new Event('touchmove', { cancelable: true });
    touchMove.touches = [{ clientX: 200, clientY: 30 }];
    body.dispatchEvent(touchMove);

    assert.ok(h.term.getSelection().startsWith('selected:'), 'Selection should expand on move');
    assert.equal(clipboardWrites, 0, 'Moving selection must not pollute clipboard');

    const touchEnd = new Event('touchend', { cancelable: true });
    body.dispatchEvent(touchEnd);
    assert.equal(clipboardWrites, 0, 'Ending selection must still not touch clipboard');

    // Only tapping Copy button writes to clipboard
    h.tap('Copy');
    await Promise.resolve();
    assert.equal(clipboardWrites, 1, 'Copy button must explicitly write to clipboard');

    h.toolbar.dispose();
});

test('edge auto-scrolls terminal buffer lines when dragging near top or bottom boundary', async () => {
    const h = terminalToolbar();
    const body = h.container.children[0];
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480 });

    const touchStart = new Event('touchstart', { cancelable: true });
    touchStart.touches = [{ clientX: 100, clientY: 100 }];
    body.dispatchEvent(touchStart);

    // Long press to enter selection mode
    await new Promise(r => setTimeout(r, 380));
    assert.ok(h.term.hasSelection());

    const initialScrolled = h.term.scrolledLines;

    // Drag near bottom boundary (< 38px from 480px, e.g. clientY 465)
    const touchMove = new Event('touchmove', { cancelable: true });
    touchMove.touches = [{ clientX: 100, clientY: 465 }];
    body.dispatchEvent(touchMove);

    // Wait for at least one interval tick (90ms)
    await new Promise(r => setTimeout(r, 220));

    assert.ok(h.term.scrolledLines > initialScrolled, 'Edge auto-scroll should have scrolled buffer downward');

    const touchEnd = new Event('touchend', { cancelable: true });
    body.dispatchEvent(touchEnd);
    h.toolbar.dispose();
});

test('dragging in middle while selecting adjusts selection and does NOT scroll terminal lines', async () => {
    const h = terminalToolbar();
    const body = h.container.children[0];
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480 });

    const touchStart = new Event('touchstart', { cancelable: true });
    touchStart.touches = [{ clientX: 100, clientY: 100 }];
    body.dispatchEvent(touchStart);

    // Long press to enter selection mode
    await new Promise(r => setTimeout(r, 380));
    assert.ok(h.term.hasSelection());

    const initialScrolled = h.term.scrolledLines;

    // Drag in the middle of screen (Y=240, far from edges)
    const touchMove = new Event('touchmove', { cancelable: true });
    touchMove.touches = [{ clientX: 200, clientY: 240 }];
    body.dispatchEvent(touchMove);

    await new Promise(r => setTimeout(r, 100));

    assert.equal(h.term.scrolledLines, initialScrolled, 'Moving in middle must never scroll viewport');

    const touchEnd = new Event('touchend', { cancelable: true });
    body.dispatchEvent(touchEnd);
    assert.ok(h.term.hasSelection(), 'Selection should remain active after drag ends');

    // Tapping again when selection is active dismisses selection
    const tapStart = new Event('touchstart', { cancelable: true });
    tapStart.touches = [{ clientX: 200, clientY: 240 }];
    body.dispatchEvent(tapStart);

    const tapEnd = new Event('touchend', { cancelable: true });
    tapEnd.changedTouches = [{ clientX: 200, clientY: 240 }];
    body.dispatchEvent(tapEnd);

    assert.ok(!h.term.hasSelection(), 'Single tap with active selection must dismiss selection');

    h.toolbar.dispose();
});
