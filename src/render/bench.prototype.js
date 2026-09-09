import { Entity, GSplatData, GSplatResource, WORKBUFFER_UPDATE_ONCE } from 'playcanvas';
import { rigidFrameField } from '../deformation/bind.js';
import { bindSplatDeformation } from './splats.js';

// Static 2DGS prototype only. No alternative deformation binding is introduced.
export function createBenchViews(app, groups) {
    app.scene.gsplat.twoDimensional = true;
    app.scene.gsplat.enableIds = true;
    const views = [];
    try {
        for (const group of groups) {
            const properties = Object.entries(group.properties).map(([name,storage])=>({name,storage,type:'float',byteSize:4}));
            const data = new GSplatData([{name:'vertex',count:group.count,properties}]);
            const entity = new Entity(group.name);
            const resource = new GSplatResource(app.graphicsDevice,data);
            try { entity.addComponent('gsplat', {resource,castShadows:false}); }
            catch(error) { entity.destroy(); resource.destroy(); throw error; }
            views.push({...group,entity});
        }
        return views;
    } catch(error) {
        for(const view of views) {const resource=view.entity.gsplat.resource;view.entity.destroy();resource.destroy();}
        throw error;
    }
}


export function bindBenchSimulation(session) {
    const entity = session.view.entity;
    bindSplatDeformation(entity, rigidFrameField(session.field, session.origin, session.rotation), { surface: true });
    return () => {
        entity.gsplat.setWorkBufferModifier(null);
        entity.gsplat.workBufferUpdate = WORKBUFFER_UPDATE_ONCE;
    };
}
