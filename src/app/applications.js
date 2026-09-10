import { DemoApplication } from './demo.js';
import { SceneApplication } from './scene.js';

export { WebGpuUnavailableError } from '../scene/app.js';

export const DEFAULT_APPLICATION = 'demo';

const APPLICATIONS = {
    demo: options => new DemoApplication(options),
    scene: options => new SceneApplication(options)
};

/** Selects an application without assembling or starting it. */
export function applicationNamed(name, options) {
    const key = name ?? DEFAULT_APPLICATION;
    const create = APPLICATIONS[key];
    if (!create) {
        throw new Error(`no application named "${key}"; known: ${Object.keys(APPLICATIONS).join(', ')}`);
    }
    return create(options);
}
