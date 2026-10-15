import { createPhysDreamerScene } from './physdreamer.js';
import { ALOCASIA } from './physdreamerDeclarations.js';

/** Compatibility entry: synthetic callers must still supply their own r. */
export function createAlocasiaScene({ r } = {}) {
    return createPhysDreamerScene({ ...ALOCASIA, r });
}
export const alocasiaScene = createPhysDreamerScene(ALOCASIA);
