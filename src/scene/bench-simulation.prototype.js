import { Mat4, Vec3 } from 'playcanvas';
import { benchBody } from '../body/bench.prototype.js';
import { Simulator } from '../sim/simulator.js';

/** One real body in a fixed, rotated container. No state-losing hot-add fallback. */
export function createBenchSimulation(app, view, world, container) {
    const frame = new Mat4().setTRS(container.getPosition(), container.getRotation(), Vec3.ONE);
    const inverse = frame.clone().invert();
    const transform = new Mat4().mul2(inverse, world.getWorldTransform());
    const rotation = container.getRotation().clone().invert().mul(world.getRotation());
    const body = benchBody(view, transform.data, [rotation.x,rotation.y,rotation.z,rotation.w], world.getLocalScale().x);
    const size = container.getLocalScale().clone().mulScalar(world.getLocalScale().x);
    const half = [size.x/2,size.y/2,size.z/2];
    const bounds = {min:half.map(v=>-v),max:half,closedTop:true};
    const sim = new Simulator(app.graphicsDevice,[body],bounds);
    const gravity = inverse.transformVector(new Vec3(0,-9.81,0));
    sim.params.gravity=[gravity.x,gravity.y,gravity.z];
    sim.params.paused=true;
    sim.grip.radius=Math.max(sim.finestCell()*1.5,0.0001);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<8;i++){const p=frame.transformPoint(new Vec3(...half.map((v,k)=>i&(1<<k)?v:-v)));[p.x,p.y,p.z].forEach((v,k)=>{min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);});}
    let epoch=0,alive=true;
    const array=v=>[v.x,v.y,v.z];
    const grabber={tank:{min,max},
        async grab(origin,direction){const attempt=++epoch;try{const hit=await sim.grab(array(inverse.transformPoint(new Vec3(...origin))),array(inverse.transformVector(new Vec3(...direction))));if(!alive||attempt!==epoch){if(alive)sim.releaseGrab();return null;}return hit?{...hit,position:array(frame.transformPoint(new Vec3(...hit.position)))}:null;}catch(error){if(alive)throw error;return null;}},
        moveGrab(position){const p=array(inverse.transformPoint(new Vec3(...position)));sim.moveGrab(p.map((v,k)=>Math.max(bounds.min[k],Math.min(bounds.max[k],v))));},
        releaseGrab(){epoch++;if(alive)sim.releaseGrab();}
    };
    const m=frame.data;
    return {view,sim,grabber,field:sim.deformationOf(0),
        origin:[m[12],m[13],m[14]],rotation:[m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]],
        updateMaterial(){sim.setMaterial(0,{density:view.physics.rho_si,youngsModulus:view.physics.E_si,poissonRatio:view.physics.nu_si});},
        destroy(){grabber.releaseGrab();alive=false;sim.destroy();}
    };
}
