import { prepareBench } from './bench.prototype.js';
self.onmessage = async ({data}) => {
    try {
        const result = await prepareBench(data.ply, data.labels, data.physics, message => self.postMessage({message}));
        self.postMessage({result}, result.groups.flatMap(g=>Object.values(g.properties).map(a=>a.buffer)));
    } catch(error) { self.postMessage({error:error.message}); }
};
