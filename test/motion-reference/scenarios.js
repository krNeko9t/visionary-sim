/**
 * What the reference records: existing scenes, each run for a fixed number of
 * physical steps through the simulator's public methods, with every node's
 * position read at the `record` lines.
 *
 * Read by the browser page, which plays a script, and by the Node runner, which
 * names the scenarios. Changing a script changes what the reference means, so
 * it is re-recorded on the old implementation in the same change.
 *
 * Script lines, played in order:
 * - `['record']` reads every node's position.
 * - `['run', steps]` takes that many fixed physical steps.
 * - `['grab', { origin, toward }]` grabs whatever a ray from `origin` through
 *   `toward` hits (world space, metres); it must hit.
 * - `['drag', { by, steps }]` moves the grab target by `by` metres, evenly over
 *   that many steps.
 * - `['release']` lets go.
 *
 * Steps are taken in batches of at most {@link BATCH} per frame, the way the
 * application takes them. A grab target moved between batches gets its
 * velocity from the batch, so the batching is part of the script.
 */

/** Fixed physical steps per frame, at most. Matches `MAX_STEPS_PER_FRAME`. */
export const BATCH = 24;

/** @type {Record<string, { scene: string, script: Array<[string, any?]> }>} */
export const SCENARIOS = {
    // Two meshes and three analytic shapes fall under gravity into the tank
    // and onto each other: mesh and shape discretisation, elasticity, contact
    // between bodies with its atomic binning, and the walls.
    // At 0.72 ms a step: impact around 0.35 s, settling by 1 s.
    tank: {
        scene: 'tank',
        script: [['record'], ['run', 480], ['record'], ['run', 480], ['record'], ['run', 480], ['record']]
    },
    // Two Gaussian captures, the loaf falling onto the plush toy: the cloud's
    // volume and its contact. At 1.96 ms a step: 0.47, 0.94 and 1.88 s.
    'splats-contact': {
        scene: 'splats-contact',
        script: [['record'], ['run', 240], ['record'], ['run', 240], ['record'], ['run', 480], ['record']]
    },
    // A scanned plant on a static support with no gravity, its leaf pulled 4 cm
    // and let go -- the alocasia drag regression's corrected case: static
    // prescription, the tensile limit and the compliant drive. At 0.75 ms a
    // step: drag 0.4 s, hold 0.2 s, then 0.5 s after release.
    alocasia: {
        scene: 'alocasia',
        script: [
            ['record'],
            ['grab', { origin: [0.48, 0.32, 0.60], toward: [0.1145914420, 0.2637784481, 0.1104702875] }],
            ['drag', { by: [0.04, 0, 0], steps: 536 }],
            ['record'],
            ['run', 268],
            ['record'],
            ['release'],
            ['run', 668],
            ['record']
        ]
    }
};
