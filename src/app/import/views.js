import { Entity } from 'playcanvas';

import { createSplatView, destroySplatView } from '../../render/splats.js';

/** Create all real 2DGS resources off-tree; attach publishes them as one scene. */
export function createSceneSplatCandidate(app, prepared) {
    const root = new Entity('imported-scene');
    const scale = prepared.reference.defaultMeters / prepared.reference.longestSide;
    root.setLocalScale(scale, scale, scale);
    root.setLocalPosition(...prepared.reference.center.map(value => -value * scale));
    const views = [];
    let disposed = false;
    try {
        for (const group of prepared.groups) {
            const entity = createSplatView(app, group.id === 0 ? 'untracked' : `instance-${group.id}`, group.cloud, null, {
                twoDimensional: true
            });
            views.push({ id: group.id, name: group.name, count: group.count, rawRows: group.rawRows, entity });
            root.addChild(entity);
        }
    } catch (error) {
        try {
            disposeCandidate(root, views);
        } catch (cleanupError) {
            console.error('[scene-import] failed to clean a rejected display candidate', cleanupError);
        }
        throw error;
    }
    return {
        views: { root, groups: views },
        root,
        attach() {
            if (disposed) throw new Error('cannot attach a disposed scene candidate');
            app.root.addChild(root);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            disposeCandidate(root, views);
        }
    };
}

function disposeCandidate(root, views) {
    let firstError = null;
    for (const view of views) {
        try {
            destroySplatView(view.entity);
        } catch (error) {
            firstError ??= error;
        }
    }
    try {
        root.destroy();
    } catch (error) {
        firstError ??= error;
    }
    if (firstError) throw firstError;
}
