import { WORKBUFFER_UPDATE_ALWAYS, WORKBUFFER_UPDATE_AUTO, WORKBUFFER_UPDATE_ONCE } from 'playcanvas';

/** Stable source-ID colors; label zero always retains its source appearance. */
export function instanceColor(id) {
    const h = (id * 0.61803398875) % 1;
    return [0, 2 / 3, 1 / 3].map(offset =>
        0.25 + 0.65 * Math.max(0, Math.min(1, Math.abs(((h + offset) % 1) * 6 - 3) - 1)));
}

const installed = new WeakSet();
const probeUpdateModes = new WeakMap();

/** Marks a combined deformation/color modifier as the component's sole modifier. */
export function registerInstanceColorModifier(component) {
    installed.add(component);
}

/** Color-only modifier for static imported views. Does not replace a deformation binding. */
export function applyInstanceColors(groups, { colorMode, selectedId }) {
    for (const { id, entity } of groups) {
        const component = entity.gsplat;
        if (!installed.has(component)) {
            component.setWorkBufferModifier({
                wgsl: `uniform inspectionColor: vec3f;
uniform inspectionMix: f32;
uniform sourceDisplayProbe: f32;
fn modifySplatCenter(center: ptr<function, vec3f>) {}
fn modifySplatRotationScale(a: vec3f, b: vec3f, rotation: ptr<function, vec4f>, scale: ptr<function, vec3f>) {}
fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
    *color = vec4f(mix((*color).rgb, uniform.inspectionColor, uniform.inspectionMix), (*color).a * (1.0 - uniform.sourceDisplayProbe));
}`,
                glsl: `uniform vec3 inspectionColor;
uniform float inspectionMix;
uniform float sourceDisplayProbe;
void modifySplatCenter(inout vec3 center) {}
void modifySplatRotationScale(vec3 a, vec3 b, inout vec4 rotation, inout vec3 scale) {}
void modifySplatColor(vec3 center, inout vec4 color) { color.rgb = mix(color.rgb, inspectionColor, inspectionMix); color.a *= 1.0 - sourceDisplayProbe; }`
            });
            component.setParameter('sourceDisplayProbe', 0);
            installed.add(component);
        }
        component.setParameter('inspectionColor', new Float32Array(id === selectedId ? [1, 0.75, 0.2] : instanceColor(id)));
        component.setParameter('inspectionMix', id === 0 ? 0 : colorMode === 'instances' ? 1 : id === selectedId ? 0.35 : 0);
    }
}

/** Exercise the final static modifier without publishing duplicate source pixels. */
export function setSceneDisplayProbe(groups, enabled) {
    for (const group of groups) {
        if (!installed.has(group.entity.gsplat)) {
            applyInstanceColors([group], { colorMode: 'source', selectedId: null });
        }
        const component = group.entity.gsplat;
        if (enabled) {
            if (!probeUpdateModes.has(component)) probeUpdateModes.set(component, component.workBufferUpdate ?? WORKBUFFER_UPDATE_AUTO);
            component.workBufferUpdate = WORKBUFFER_UPDATE_ALWAYS;
        } else if (probeUpdateModes.has(component)) {
            component.workBufferUpdate = probeUpdateModes.get(component);
            component.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
            probeUpdateModes.delete(component);
        }
        component.setParameter('sourceDisplayProbe', enabled ? 1 : 0);
    }
}

/**
 * PlayCanvas creates these per-resource render infos only when the unified
 * workbuffer render pass visits that resource, after asynchronous initial sort.
 * A frameend alone is not evidence that a newly attached source was rendered.
 */
export function isSceneDisplayProbeReady(groups) {
    return groups.every(({ entity }) => {
        const infos = entity.gsplat.resource?.workBufferRenderInfos;
        if (!(infos instanceof Map)) throw new Error('source display cannot observe PlayCanvas workbuffer validation');
        if (!infos.size) return false;
        for (const info of infos.values()) {
            const shader = info.quadRender?.shader;
            if (shader?.failed) throw new Error('source display workbuffer shader failed');
            if (!shader?.ready) return false;
        }
        return true;
    });
}
