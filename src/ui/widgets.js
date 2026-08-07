/**
 * The parts a panel is made of.
 *
 * Hand-built DOM rather than a widget library: there are five kinds of control
 * here and a library would be larger than all of them together. Each factory
 * returns its element plus the one or two ways the panel needs to talk back to
 * it, so the panel never reaches into the DOM it did not build.
 *
 * Nothing here knows what a body or a solver is. That separation is the reason
 * this file stays short while `panel.js` stays about the simulation.
 */

/**
 * @param {string} tag - Element tag.
 * @param {string} [className] - Class to set.
 * @param {string} [text] - Text content.
 * @returns {HTMLElement} The element.
 */
export function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

/**
 * @param {string} title - Heading.
 * @param {HTMLElement[]} children - Contents.
 * @returns {HTMLElement} A titled block.
 */
export function section(title, children) {
    const node = element('section', 'ui-section');
    node.append(element('h2', 'ui-title', title), ...children);
    return node;
}

/**
 * A labelled slider with its value spelled out beside it.
 *
 * @param {object} options - Slider options.
 * @param {string} options.label - What it controls.
 * @param {number} options.min - Lowest value.
 * @param {number} options.max - Highest value.
 * @param {number} options.step - Granularity.
 * @param {number} options.value - Starting value.
 * @param {(value: number) => string} options.format - How to spell the value out.
 * @param {(value: number) => void} options.onInput - Called while dragging.
 * @returns {{ element: HTMLElement, set: (value: number) => void,
 *   warn: (reason: string|null) => void }} The control.
 */
export function slider({ label, min, max, step, value, format, onInput }) {
    const row = element('div', 'ui-row');
    const name = element('label', 'ui-label', label);
    const input = element('input', 'ui-slider');
    const shown = element('span', 'ui-value', format(value));

    Object.assign(input, { type: 'range', min, max, step, value });
    input.addEventListener('input', () => {
        const next = parseFloat(input.value);
        shown.textContent = format(next);
        onInput(next);
    });

    row.append(name, input, shown);
    return {
        element: row,
        set(next) {
            input.value = String(next);
            shown.textContent = format(next);
        },
        // A slider whose current value is legal but unwise says so in place,
        // which is the only moment the reader is looking at it.
        warn(reason) {
            row.classList.toggle('ui-warn', reason !== null);
            name.title = reason ?? '';
        }
    };
}

/**
 * @param {object} options - Toggle options.
 * @param {string} options.label - What it turns on.
 * @param {boolean} options.value - Starting state.
 * @param {(value: boolean) => void} options.onChange - Called on change.
 * @returns {{ element: HTMLElement }} The control.
 */
export function toggle({ label, value, onChange }) {
    const row = element('label', 'ui-toggle');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));

    row.append(input, element('span', undefined, label));
    return { element: row };
}

/**
 * @param {string} label - Button text.
 * @param {() => void} onClick - Called on press.
 * @returns {{ element: HTMLElement, set: (text: string) => void }} The control.
 */
export function button(label, onClick) {
    const node = element('button', 'ui-button', label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return {
        element: node,
        set(text) {
            node.textContent = text;
        }
    };
}

/**
 * A one-of-many selector, as a row of buttons rather than a dropdown: the
 * choices are few and worth seeing all at once.
 *
 * @param {string[]} items - Labels, in order.
 * @param {(index: number) => void} onSelect - Called with the chosen index.
 * @returns {{ element: HTMLElement, set: (index: number) => void }} The control.
 */
export function chips(items, onSelect) {
    const row = element('div', 'ui-chips');
    const buttons = items.map((label, index) => {
        const chip = element('button', 'ui-chip', label);
        chip.type = 'button';
        chip.addEventListener('click', () => onSelect(index));
        row.append(chip);
        return chip;
    });

    return {
        element: row,
        set(index) {
            buttons.forEach((chip, at) => chip.classList.toggle('ui-on', at === index));
        }
    };
}

/**
 * A read-only number with a name, for things the simulation reports rather than
 * things it is told.
 *
 * @param {string} label - What is being reported.
 * @returns {{ element: HTMLElement, set: (text: string, tone?: string) => void }} The readout.
 */
export function stat(label) {
    const row = element('div', 'ui-stat');
    const value = element('span', 'ui-value', '-');
    row.append(element('span', 'ui-label', label), value);

    return {
        element: row,
        set(text, tone = '') {
            if (value.textContent !== text) {
                value.textContent = text;
            }
            if (value.dataset.tone !== tone) {
                value.dataset.tone = tone;
            }
        }
    };
}
