import './panel.css';

import { POISSON_RANGE } from '../body/material.js';
import { button, chips, element, section, slider, stat, toggle } from './widgets.js';

/**
 * The knobs this simulation has, and what it is currently costing to turn them.
 *
 * The panel shows the two limits rather than hiding them. Both are real and
 * neither is obvious from the outside: a stable fixed step can cost more work
 * than one render frame can carry, and a compressible material has a squash it
 * does not come back from. The former loses wall time rather than corrupting
 * physics; the latter is a constitutive barrier.
 *
 * What the panel deliberately does not do is decide anything. Every value it
 * writes goes through `Simulator`, and every value it reads comes from
 * `Simulator.stats()`, so there is no second opinion here about the state of
 * the simulation.
 */

/** Slider ranges are display choices; the material's own legal range is not. */
const MATERIAL_CONTROLS = [
    {
        key: 'youngsModulus',
        label: '刚度',
        min: 2e3,
        max: 1e5,
        step: 500,
        format: value => `${(value / 1000).toFixed(1)} kPa`
    },
    {
        key: 'poissonRatio',
        label: '泊松比',
        min: POISSON_RANGE.min,
        max: POISSON_RANGE.max,
        step: 0.005,
        format: value => value.toFixed(3)
    },
    {
        key: 'density',
        label: '密度',
        min: 200,
        max: 3000,
        step: 10,
        format: value => `${value.toFixed(0)} kg/m³`
    },
    {
        key: 'relaxation',
        label: '松弛',
        min: 0,
        max: 0.04,
        step: 0.001,
        format: value => (value > 0 ? `${(value * 1000).toFixed(0)} ms` : '弹性')
    },
    { key: 'damping', label: '阻力', min: 0, max: 8, step: 0.1, format: value => value.toFixed(1) },
    { key: 'friction', label: '摩擦', min: 0, max: 1, step: 0.02, format: value => value.toFixed(2) }
];

/** Above this the deviatoric constraint stops being compliance-damped. */
const CFL_LIMIT = 1;

/**
 * Squash a body past this fraction of its rest size and it will not come back.
 * Worth saying out loud once the barrier is within reach of an ordinary impact.
 */
const COLLAPSE_LIMIT = 0.4;

/** Seconds between readout refreshes: often enough to feel live, rarely enough not to thrash. */
const REFRESH = 1 / 6;

/**
 * @param {import('../sim/simulator.js').Simulator} sim - Simulation to drive.
 * @param {object} handlers - Things the panel cannot do itself.
 * @param {(visible: boolean) => void} handlers.onLatticeToggle - Show or hide the solver lattice.
 * @returns {{ element: HTMLElement, update: (dt: number) => void }} The panel.
 */
export function createPanel(sim, { onLatticeToggle }) {
    let selected = 0;
    let sinceRefresh = REFRESH;
    let fps = 60;

    // A scene can be all backdrop -- rendered captures that nothing steps. Then
    // there is no material to edit and no body to report on, and the honest
    // panel is the one without those controls rather than one showing zeroes.
    const hasBodies = sim.simBodies.length > 0;

    const selector = chips(sim.simBodies.map(({ body }) => body.name), index => select(index));
    const material = () => sim.simBodies[selected].body.material;

    const controls = !hasBodies ? [] : MATERIAL_CONTROLS.map(control => ({
        ...control,
        widget: slider({
            ...control,
            value: material()[control.key],
            onInput: (value) => {
                sim.setMaterial(selected, { [control.key]: value });
                refresh();
            }
        })
    }));

    const readouts = {
        cfl: stat('CFL'),
        steps: stat('物理步'),
        timing: stat('时序'),
        collapse: stat('塌陷'),
        size: stat('规模'),
        rate: stat('帧率')
    };

    const pause = button(sim.params.paused ? '继续' : '暂停', () => {
        sim.params.paused = !sim.params.paused;
        pause.set(sim.params.paused ? '继续' : '暂停');
    });

    const note = element('p', 'ui-note', '左键拖动抓住物体，右键拖动旋转视角，中键平移，滚轮缩放。');

    const panel = element('div', 'ui-panel');
    panel.append(
        section('物体', hasBodies
            ? [selector.element, ...controls.map(c => c.widget.element)]
            : [element('p', 'ui-note', '这个场景里没有被模拟的物体。')]),
        section('解算', [
            ...Object.values(readouts).map(readout => readout.element),
            buttonRow([
                pause,
                button('单步', () => sim.requestStep()),
                button('重置', () => sim.reset())
            ]),
            toggle({ label: '物体互碰', value: true, onChange: on => sim.setContact(on) }).element,
            toggle({
                label: '刚性抓取',
                value: true,
                onChange: on => sim.setDriveLaw(on ? 'hard' : 'compliant')
            }).element,
            toggle({ label: '显示点阵', value: false, onChange: onLatticeToggle }).element,
            note
        ])
    );
    if (hasBodies) {
        select(0);
    } else {
        refresh();
    }

    /**
     * @param {number} index - Body to show the sliders for.
     */
    function select(index) {
        selected = index;
        selector.set(index);
        for (const control of controls) {
            control.widget.set(material()[control.key]);
        }
        refresh();
    }

    /** Rewrites everything the panel reports. */
    function refresh() {
        const stats = sim.stats();
        const body = stats.perBody[selected];
        const timing = timingReadouts(stats);

        readouts.cfl.set(`${stats.cfl.toFixed(2)} · ${stats.limitedBy}`, cflTone(stats.cfl));
        readouts.steps.set(timing.steps.text, timing.steps.tone);
        readouts.timing.set(timing.clock.text, timing.clock.tone);
        readouts.collapse.set(
            body ? `压到 ${(body.collapseScale * 100).toFixed(0)}%` : '—',
            body && body.collapseScale > COLLAPSE_LIMIT ? 'warn' : ''
        );
        readouts.size.set(body
            ? `${body.cells} / ${stats.cells} 格 · ${stats.contactNodes} 触点`
            : '—');
        readouts.rate.set(`${fps.toFixed(0)} fps`);

        for (const control of controls) {
            control.widget.warn(warningFor(control.key, stats, body));
        }
    }

    return {
        element: panel,
        update(dt) {
            fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;
            sinceRefresh += dt;
            if (sinceRefresh >= REFRESH) {
                sinceRefresh = 0;
                refresh();
            }
        }
    };
}

/**
 * Presents the clock facts without forming a second opinion about them.
 *
 * Kept pure so overload reporting is tested without constructing a DOM. Lost
 * wall time remains visible until reset because a one-frame warning refreshed
 * at 6 Hz would usually never be seen.
 *
 * @param {ReturnType<import('../sim/simulator.js').Simulator['stats']>} stats - Timing report.
 * @returns {{ steps: { text: string, tone: string }, clock: { text: string, tone: string } }}
 */
export function timingReadouts(stats) {
    const backlog = `积 ${(stats.backlogTime * 1000).toFixed(1)} ms`;
    return {
        steps: {
            text: `${stats.steps} × ${(stats.stepDuration * 1000).toFixed(2)} ms`,
            tone: stats.overloaded ? 'bad' : ''
        },
        clock: {
            text: stats.droppedTime > 0
                ? `${backlog} · 丢 ${(stats.droppedTime * 1000).toFixed(0)} ms`
                : backlog,
            tone: stats.droppedTime > 0 ? 'bad' : ''
        }
    };
}

/**
 * @param {number} cfl - Current CFL number.
 * @returns {string} Tone for the readout.
 */
function cflTone(cfl) {
    if (cfl >= CFL_LIMIT) {
        return 'bad';
    }
    return cfl >= 0.9 ? 'warn' : '';
}

/**
 * Why a slider's current value is unwise, if it is. Only the two limits that
 * actually destroy a body get one; everything else is taste.
 *
 * @param {string} key - Material field the slider edits.
 * @param {object} stats - Report from `Simulator.stats()`.
 * @param {object} body - That report's entry for the selected body.
 * @returns {string|null} An explanation, or null when the value is fine.
 */
function warningFor(key, stats, body) {
    if ((key === 'youngsModulus' || key === 'density') && stats.cfl >= CFL_LIMIT) {
        return `CFL ${stats.cfl.toFixed(2)} ≥ 1：固定时序器的稳定性约束已失效。`;
    }
    if (key === 'poissonRatio' && body.collapseScale > COLLAPSE_LIMIT) {
        return `gamma ${body.gamma.toFixed(2)}：压到 ${(body.collapseScale * 100).toFixed(0)}% 以下能量就一路往零走，` +
            `物体塌成一点且不会回来。这是本构模型的势垒，加子步没有用。`;
    }
    return null;
}

/**
 * @param {{ element: HTMLElement }[]} buttons - Buttons to lay out in a row.
 * @returns {HTMLElement} The row.
 */
function buttonRow(buttons) {
    const row = element('div', 'ui-buttons');
    row.append(...buttons.map(item => item.element));
    return row;
}
