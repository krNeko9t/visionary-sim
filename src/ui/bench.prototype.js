import { attachGrabber } from './grab.js';
import { Color, Entity, Gizmo, TranslateGizmo, RotateGizmo, ScaleGizmo, Picker, Vec3, Quat } from 'playcanvas';

// Three scene-first layouts share the same real data and direct manipulation.
export async function mountBenchPrototype({ app, camera, grid, status, prepare, createViews, startSimulation }) {
    const $ = id => document.getElementById(id), canvas = app.graphicsDevice.canvas;
    const world = new Entity('scene-correction-prototype'); app.root.addChild(world);
    const container = new Entity('scene-container-prototype'); world.addChild(container);
    let scene = null, views = [], selected = null, target = null, tool = 'move', draggingGizmo = false;
    let orbitFocus = new Vec3(), down = null, picking = false;
    const orbitUp = new Vec3(0,1,0); // User-selected world +Y; source pose supplies viewing position, not up.
    let generation = 0, busy = false;
    let session = null, grabHandle = null;
    // 关 -> 叠加在高斯之上 -> 只留模拟体。The third state exists because the
    // cloud is what hides the cells: seeing the discretisation means being able
    // to take the surface away.
    const LATTICE_MODES = ['off', 'overlay', 'only'];
    const LATTICE_LABELS = { off: '模拟体：关', overlay: '模拟体：叠加', only: '模拟体：独显' };
    let latticeMode = 'off';
    function applyLatticeMode() {
        $('simLattice').textContent = LATTICE_LABELS[latticeMode];
        session?.setLatticeVisible(latticeMode !== 'off');
        refresh();
    }
    function enableGrab(){if(!session?.sim||grabHandle)return;grabHandle=attachGrabber(app,camera,session.grabber);$('simGrab').textContent='抓取：开';}
    function stopGrab(){grabHandle?.detach();grabHandle=null;$('simGrab').textContent='抓取：关';}
    function endSession(){stopGrab();session?.destroy();session=null;for(const id of ['simPlay','simGrab','simReset','simLattice'])$(id).hidden=true;latticeMode='off';$('simLattice').textContent=LATTICE_LABELS.off;}
    function returnToPreparation(){if(!session)return;endSession();refresh();status('已返回准备：全部实例恢复源形状与位置，保留物性和容器。');}
    async function joinSelected() {
        if (!selected || busy || session?.has(selected)) return;
        busy = true;
        const view = selected;
        const gpu = app.graphicsDevice.wgpu;
        let scope = false, pending = null;
        // The wall time spent preparing is not physical time: freeze first, so
        // nothing already running lurches forward at the moment of the swap.
        stopGrab();
        if (session?.sim) session.sim.params.paused = true;
        status('正在为 ' + view.name + ' 准备表面占据、填充与模拟资源…');
        try {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            target = null; bindGizmo(); $('transformTools').hidden = true;
            session ??= startSimulation(world, container);
            gpu.pushErrorScope('validation'); scope = true;
            // Builds and binds everything that can fail. Members already
            // running keep running, off the buffers they already hold.
            pending = await session.prepare(view);
            // Let the actual 2DGS work-buffer shader compile before switching.
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const error = await gpu.popErrorScope(); scope = false;
            if (error) throw new Error(error.message);
            pending.commit(); pending = null;
            session.updateMaterial(view);
            for (const id of ['simPlay', 'simGrab', 'simReset', 'simLattice']) $(id).hidden = false;
            session.sim.params.paused = false;
            $('simPlay').textContent = '暂停模拟';
            enableGrab();
            resetTimingSample();
            status(`已加入 ${view.name}，共 ${session.members.length} 个模拟体在共同模拟；已有物体保持原位置与速度。`);
        } catch (error) {
            pending?.cancel();
            if (!session?.members.length) endSession();
            else $('simPlay').textContent = '继续模拟';
            status('加入失败，保留原显示：' + error.message);
        } finally {
            if (scope) await gpu.popErrorScope();
            busy = false; refresh();
        }
    }
    const layer = Gizmo.createLayer(app);
    const gizmos = { move:new TranslateGizmo(camera.camera,layer), rotate:new RotateGizmo(camera.camera,layer), scale:new ScaleGizmo(camera.camera,layer) };
    for (const gizmo of Object.values(gizmos)) {
        gizmo.mouseButtons[1]=false;gizmo.mouseButtons[2]=false;
        gizmo.on('transform:start',()=>{draggingGizmo=true;});
        gizmo.on('transform:move',()=>{const scale=container.getLocalScale();container.setLocalScale(Math.max(.0001,Math.abs(scale.x)),Math.max(.0001,Math.abs(scale.y)),Math.max(.0001,Math.abs(scale.z)));numbers();});
        gizmo.on('transform:end',()=>{draggingGizmo=false;numbers();});
    }
    const picker = new Picker(app,canvas.width,canvas.height);
    function bindGizmo(){for(const g of Object.values(gizmos))g.detach();if(target){if(target===world&&tool==='scale')return;gizmos[tool].attach([target]);gizmos[tool].coordSpace=target===container?'local':'world';}}
    function select(view){stopGrab();selected=view;target=null;bindGizmo();$('transformTools').hidden=true;refresh();}
    function edit(entity){if(session||busy){status('模拟运行中冻结容器与全局校正；返回准备后可继续编辑。');return;}target=entity;selected=null;$('isolate').checked=false;views.forEach(v=>v.entity.enabled=true);$('transformTools').hidden=false;bindGizmo();refresh();numbers();}
    function numbers(){if(!target)return;const host=$('numbers');host.replaceChildren();
        const fields=[['位置（米）',target.getLocalPosition(),v=>target.setLocalPosition(...v)],['旋转（度）',target.getLocalEulerAngles(),v=>target.setLocalEulerAngles(...v)]];
        if(target===container)fields.push(['内部尺寸（米）',target.getLocalScale(),v=>target.setLocalScale(...v)]);
        for(const [label,current,set] of fields){const title=document.createElement('p');title.textContent=label;host.append(title);const row=document.createElement('div');row.className='triple';const values=[current.x,current.y,current.z];values.forEach((value,k)=>{const l=document.createElement('label');l.textContent=['X','Y','Z'][k];const input=document.createElement('input');input.type='number';input.step=label.startsWith('旋转')?'1':'.01';input.value=value.toFixed(4);input.onchange=()=>{const next=Number(input.value);if(!Number.isFinite(next)||(label.startsWith('内部')&&next<=0))return;values[k]=next;set(values);};l.append(input);row.append(l);});host.append(row);}
        if(target===world){const label=document.createElement('label');label.textContent='场景最长边（米）';const input=document.createElement('input');input.type='number';input.min='.001';input.step='.1';input.value=world.getLocalScale().x;input.onchange=()=>{const s=Number(input.value);if(Number.isFinite(s)&&s>0)world.setLocalScale(s,s,s);};label.append(input);host.append(label);}
    }
    function refresh(){
        $('list').replaceChildren();for(const view of views){const button=document.createElement('button');button.className=selected===view?'active':'';const name=document.createElement('span');name.textContent=view.name;const count=document.createElement('small');count.textContent=(session?.has(view)?'● ':'')+(view.count/1000).toFixed(1)+'k';button.append(name,count);button.onclick=()=>select(view);button.ondblclick=()=>focus(view);$('list').append(button);}
        $('kind').textContent=target?'TRANSFORM':'INSTANCE';$('name').textContent=target===container?'场景容器':target===world?'全局校正':selected?.name??'点击场景中的物体';
        const lattice=selected&&session?.latticeOf(selected);
        $('details').textContent=selected?`ID ${selected.id} · ${selected.count.toLocaleString()} 个高斯 · ${session?.has(selected)?'已加入模拟':'仅渲染'}`+(lattice?` · 模拟体 ${lattice.cells.toLocaleString()} 格 · 格距 ${(lattice.h*1000).toPrecision(3)} mm`:''):target===container?'六面封闭长方体 · 线框显示':target===world?'全场景围绕中心统一变换':'';
        $('physical').replaceChildren();if(selected){const row=selected.physics;if(row){for(const [key,label] of [['rho_si','密度 · kg/m³'],['E_si','杨氏模量 · Pa'],['nu_si','泊松比']]){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.step='any';input.value=row[key];input.onchange=()=>{const n=Number(input.value);if(Number.isFinite(n)&&((key==='nu_si'&&n>=0&&n<.5)||(key!=='nu_si'&&n>0))){row[key]=n;session?.updateMaterial(selected);status(session?.has(selected)?'物性已生效；位置与形变保留。':'覆盖值已保留在本次会话。');}else{input.value=row[key];status('请输入有效物性。');}};l.append(input);$('physical').append(l);}}const p=document.createElement('p');p.className='muted';p.textContent=selected.id===0?'未追踪内容保留显示。':session?.has(selected)?'真实物理模拟已接通。高刚度可能使模拟显著慢于现实时间；不会自动降低刚度。':'仅渲染物体不参与碰撞；加入后与已有模拟体相互接触。';$('physical').append(p);const button=document.createElement('button');button.textContent='聚焦此实例 · F';button.onclick=()=>focus(selected);$('physical').append(button);if(selected.id>0&&!session?.has(selected)){const join=document.createElement('button');join.textContent=session?'加入共同模拟':'加入模拟';join.disabled=busy||!row;join.onclick=joinSelected;$('physical').append(join);}}
        $('explanation').textContent=target===container?'拖动三色手柄。容器变换不改变内部实例；本版仅验证编辑，未接触求解。':target===world?'平移、旋转用手柄；尺度用统一米数。此原型采用容器随全局校正的待验证方案。':'点选高斯表面，右键环绕；遮挡物可从左侧实例列表选择并聚焦。';
        for(const v of views)v.entity.enabled=(!$('isolate').checked||!selected||v===selected)&&!(latticeMode==='only'&&session?.has(v));
        document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.disabled=target===world&&b.dataset.tool==='scale';});
    }
    function focus(view){if(!scene)return;const min=new Vec3(...(view?.min??scene.min)),max=new Vec3(...(view?.max??scene.max));const center=min.clone().add(max).mulScalar(.5);world.getWorldTransform().transformPoint(center,orbitFocus);const distance=Math.max(.005,max.clone().sub(min).length()*world.getLocalScale().x*1.4);const direction=camera.getPosition().clone().sub(orbitFocus).normalize();camera.setPosition(orbitFocus.clone().add(direction.mulScalar(distance)));camera.lookAt(orbitFocus,orbitUp);}
    async function pick(event){if(picking||!views.length)return;picking=true;const token=generation;try{picker.resize(canvas.width,canvas.height);picker.prepare(camera.camera,app.scene,[app.scene.layers.getLayerByName('World')]);const rect=canvas.getBoundingClientRect();const hits=await picker.getSelectionAsync(Math.floor((event.clientX-rect.left)*canvas.width/rect.width),Math.floor((event.clientY-rect.top)*canvas.height/rect.height),1,1);if(token!==generation)return;const view=views.find(v=>hits.includes(v.entity.gsplat));if(view)select(view);else status('此处没有命中可见高斯；可从实例列表选择被遮挡的物体。');}catch(error){status('拾取失败：'+error.message);}finally{picking=false;}}
    canvas.addEventListener('contextmenu',event=>event.preventDefault());
    canvas.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,button:event.button,gizmo:draggingGizmo};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{if(!down||draggingGizmo)return;const dx=event.clientX-down.lastX,dy=event.clientY-down.lastY;down.lastX=event.clientX;down.lastY=event.clientY;if(down.button===2){const offset=camera.getPosition().clone().sub(orbitFocus);new Quat().setFromAxisAngle(orbitUp,-dx*.25).transformVector(offset,offset);new Quat().setFromAxisAngle(camera.right,-dy*.25).transformVector(offset,offset);camera.setPosition(orbitFocus.clone().add(offset));camera.lookAt(orbitFocus,orbitUp);}else if(down.button===1){const distance=camera.getPosition().distance(orbitFocus);const shift=camera.right.clone().mulScalar(-dx*distance*.0015).add(camera.up.clone().mulScalar(dy*distance*.0015));orbitFocus.add(shift);camera.setPosition(camera.getPosition().clone().add(shift));}});
    canvas.addEventListener('pointerup',event=>{if(down&&down.button===0&&!down.gizmo&&!draggingGizmo&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<5)pick(event);down=null;});
    canvas.addEventListener('pointercancel',()=>{down=null;draggingGizmo=false;});
    canvas.addEventListener('wheel',event=>{event.preventDefault();const offset=camera.getPosition().clone().sub(orbitFocus),d=offset.length();offset.mulScalar(Math.max(.001,Math.min(20,d*Math.exp(event.deltaY*.001)))/d);camera.setPosition(orbitFocus.clone().add(offset));},{passive:false});
    $('gridToggle').onclick=()=>{grid.visible=!grid.visible;$('gridToggle').textContent=grid.visible?'网格：开':'网格：关';$('gridToggle').setAttribute('aria-pressed',String(grid.visible));};
    $('home').onclick=()=>focus(null);$('containerMode').onclick=()=>{if(scene)edit(container);};$('sceneMode').onclick=()=>{if(scene)edit(world);};$('isolate').onchange=refresh;
    document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;bindGizmo();refresh();});
    window.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select')||$('files').open)return;if(event.key.toLowerCase()==='f')focus(selected);if(target&&['w','e','r'].includes(event.key.toLowerCase())){tool={w:'move',e:'rotate',r:'scale'}[event.key.toLowerCase()];bindGizmo();refresh();}if(event.key==='Escape')select(null);});
    let frames = 0, sampleWallTime = performance.now(), sampleSimTime = 0;
    function resetTimingSample() {
        frames = 0;
        sampleWallTime = performance.now();
        sampleSimTime = session?.sim?.stats().simulatedTime ?? 0;
    }
    app.on('update', dt => {
        if (session?.sim) session.sim.step(dt);
        if (scene) {
            app.drawWireAlignedBox(new Vec3(-.5,-.5,-.5),new Vec3(.5,.5,.5),new Color(.42,.78,.73),true,undefined,container.getWorldTransform());
            if (selected && !session?.has(selected)) app.drawWireAlignedBox(new Vec3(...selected.min),new Vec3(...selected.max),new Color(.95,.8,.3),false,undefined,world.getWorldTransform());
        }
        frames++;
        const wallSeconds = (performance.now() - sampleWallTime) / 1000;
        if (wallSeconds < 1) return;
        $('metrics').textContent = `${Math.round(frames / wallSeconds)} FPS · ${grid.visible ? `Y=0 · 细格 ${Number(grid.spacing.toPrecision(2))} m` : '网格已隐藏'}`;
        if (session?.sim) {
            const timing = session.sim.stats();
            const ratio = Math.max(0, (timing.simulatedTime - sampleSimTime) / wallSeconds);
            const speed = session.sim.params.paused ? '已暂停' : `模拟速度 ${(ratio * 100).toFixed(1)}%`;
            $('metrics').textContent += ` · ${timing.bodyCount} 体 · ${speed} · g=${Math.hypot(...session.sim.params.gravity).toFixed(2)} m/s²`;
            $('metrics').title = `模拟速度 = 模拟秒 / 现实秒。累计模拟 ${timing.simulatedTime.toFixed(3)} s；步长 ${(timing.stepDuration * 1e6).toFixed(2)} μs；每帧最多 ${timing.maxStepsPerFrame} 步。${timing.overloaded ? '当前达到步数预算，未改变重力或刚度。' : ''}`;
        } else $('metrics').title = '';
        resetTimingSample();
    });
    app.start();
    async function install(ply,labels,physics,pose){
        busy=true;const oldViews=views;let candidates=[];try{const result=await prepare(ply,labels,physics);status('创建 2DGS 显示资源…');await new Promise(resolve=>requestAnimationFrame(resolve));candidates=createViews(result.groups);generation++;selected=null;target=null;bindGizmo();scene=result;views=candidates;world.setPosition(0,0,0);world.setEulerAngles(0,0,0);world.setLocalScale(1,1,1);for(const v of views)world.addChild(v.entity);container.setLocalPosition(...scene.min.map((v,k)=>(v+scene.max[k])/2));container.setLocalEulerAngles(0,0,0);container.setLocalScale(...scene.min.map((v,k)=>(scene.max[k]-v)*1.06));
            for(const old of oldViews){const resource=old.entity.gsplat.resource;old.entity.destroy();resource.destroy();}
            $('count').textContent=views.filter(v=>v.id>0).length;$('transformTools').hidden=true;$('isolate').checked=false;refresh();focus(null);
            if(pose){const v=new DataView(pose);if(Number(v.getBigUint64(0,true))>0){const q=new Quat(v.getFloat64(20,true),v.getFloat64(28,true),v.getFloat64(36,true),v.getFloat64(12,true)).invert();const t=new Vec3(v.getFloat64(44,true),v.getFloat64(52,true),v.getFloat64(60,true));const position=q.transformVector(t).mulScalar(-1).sub(new Vec3(...scene.center)).mulScalar(1/scene.span);const forward=q.transformVector(new Vec3(0,0,1));const objects=views.filter(g=>g.id>0&&g.id<8);const center=new Vec3();for(const g of objects)center.add(new Vec3(...g.min).add(new Vec3(...g.max)).mulScalar(.5));center.mulScalar(1/Math.max(objects.length,1));const distance=Math.max(.01,center.clone().sub(position).dot(forward));orbitFocus=position.clone().add(forward.mulScalar(distance));camera.setPosition(position);camera.lookAt(orbitFocus,orbitUp);}}
            camera.camera.nearClip=.0001;status(`${scene.count.toLocaleString()} 个真实高斯已载入 · 点击物体，或拖动容器手柄 · 仅交互原型，未运行物理`);
        }catch(error){for(const v of candidates){const r=v.entity.gsplat.resource;v.entity.destroy();r.destroy();}status('导入失败，保留已显示场景：'+error.message);throw error;}finally{busy=false;}
    }
    $('simPlay').onclick=()=>{if(!session?.sim)return;session.sim.params.paused=!session.sim.params.paused;$('simPlay').textContent=session.sim.params.paused?'继续模拟':'暂停模拟';resetTimingSample();};
    $('simGrab').onclick=()=>{if(!session?.sim)return;if(grabHandle)stopGrab();else{enableGrab();status('左键拖动模拟体；关闭抓取后可继续点选场景或加入下一个实例。');}};
    $('simLattice').onclick=()=>{if(!session?.sim)return;latticeMode=LATTICE_MODES[(LATTICE_MODES.indexOf(latticeMode)+1)%3];applyLatticeMode();status(latticeMode==='off'?'已隐藏模拟体。':latticeMode==='overlay'?'模拟体线框叠加在高斯之上；一个方框是一个求解格，颜色是并行求解的颜色分组。':'已隐去参与模拟实例的高斯，只留模拟体本身。');};
    $('simReset').onclick=returnToPreparation;
    $('open').onclick=()=>{if(session||busy){status('请先返回准备，再切换源文件。');return;}$('files').showModal();};$('closeFiles').onclick=()=>$('files').close();
    $('loadFiles').onclick=async()=>{if(busy)return;const files=[$('plyFile').files[0],$('labelsFile').files[0],$('physicsFile').files[0]];if(files.some(f=>!f)){ $('fileError').textContent='请选择三个文件。';return;}$('loadFiles').disabled=true;try{const [ply,labels,text]=await Promise.all([files[0].arrayBuffer(),files[1].arrayBuffer(),files[2].text()]);await install(ply,labels,JSON.parse(text));$('files').close();}catch(error){$('fileError').textContent=error.message;}finally{$('loadFiles').disabled=false;}};
    const layouts=['A','B','C'],names=['A · 双侧工作台','B · 底部实例带','C · 场景优先'];let variant=Math.max(0,layouts.indexOf(new URLSearchParams(location.search).get('variant')??'A'));
    function layout(){document.body.dataset.variant=layouts[variant];$('variantName').textContent=names[variant];const url=new URL(location.href);url.searchParams.set('variant',layouts[variant]);history.replaceState(null,'',url);}
    $('prevVariant').onclick=()=>{variant=(variant+2)%3;layout();};$('nextVariant').onclick=()=>{variant=(variant+1)%3;layout();};window.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select')||$('files').open)return;if(event.key==='ArrowLeft')$('prevVariant').click();if(event.key==='ArrowRight')$('nextVariant').click();});if(import.meta.env.PROD)$('variants').style.display='none';layout();
    status('读取 bench 原始 PLY（约 322 MB）与实例标签…');
    try{const responses=await Promise.all(['point_cloud.ply','labels.npz','instance_physics.json','images.bin'].map(n=>fetch('/__bench/'+n)));if(responses.some(r=>!r.ok))throw new Error('示例文件不可读，请使用“选择三件套”');const [ply,labels,physics,pose]=await Promise.all([responses[0].arrayBuffer(),responses[1].arrayBuffer(),responses[2].json(),responses[3].arrayBuffer()]);await install(ply,labels,physics,pose);}catch(error){status(error.message+'；可用右上角文件入口重试。');}
}
