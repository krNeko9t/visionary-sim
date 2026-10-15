import { describe, expect, it } from 'vitest';

import { scaleReadout, timingReadouts } from '../../src/ui/panel.js';

describe('the simulation timing readout', () => {
    it('shows the actual fixed work performed this frame', () => {
        const shown = timingReadouts({
            steps: 9,
            stepDuration: 0.001953125,
            backlogTime: 0.0007,
            droppedTime: 0,
            overloaded: false
        });

        expect(shown.steps).toEqual({ text: '9 × 1.95 ms', tone: '' });
        expect(shown.clock).toEqual({ text: '积 0.7 ms', tone: '' });
    });

    it('keeps discarded wall time visible after the overloaded frame', () => {
        const shown = timingReadouts({
            steps: 8,
            stepDuration: 0.002,
            backlogTime: 0.001,
            droppedTime: 0.152,
            overloaded: false
        });

        expect(shown.steps.tone).toBe('');
        expect(shown.clock).toEqual({ text: '积 1.0 ms · 丢 152 ms', tone: 'bad' });
    });
});

describe('the size readout', () => {
    it('shows the body against the scene total of the same thing', () => {
        const scene = [{ label: 'a', value: 900 }, { label: 'b', value: 40 }];
        expect(scaleReadout({ label: 'a', value: 300 }, scene)).toBe('300 / 900 a');
        expect(scaleReadout({ label: 'b', value: 40 }, scene)).toBe('40 / 40 b');
    });
});
