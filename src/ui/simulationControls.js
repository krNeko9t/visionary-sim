import './simulationControls.css';

/** Simulation controls consume only SceneApplication's public state and operations. */
export function mountSimulationControls({ host, application }) {
    const element = document.createElement('section');
    element.className = 'scene-simulation-controls';
    let disposed = false;
    const run = operation => Promise.resolve().then(operation).catch(() => {});
    const unsubscribe = application.subscribe(state => {
        if (disposed) return;
        const simulation = state.simulation;
        const selected = state.inspection?.selected;
        if (!state.scene || !simulation) {
            element.hidden = true;
            return;
        }
        element.hidden = false;
        const title = node('h3', '模拟');
        const summary = node('p', phaseText(simulation));
        if (simulation.phase === 'preparing' && simulation.progress?.message) {
            const instance = simulation.progress.instanceId == null
                ? '' : ` · ID ${simulation.progress.instanceId}`;
            summary.append(`${instance} · ${simulation.progress.message}`);
        }
        const metrics = node('p', metricsText(simulation.metrics));
        const timing = node('p', timingText(simulation.timing));
        const actions = document.createElement('div');
        actions.className = 'scene-simulation-actions';

        if (simulation.phase === 'preparation') {
            if (simulation.participantIds.length) {
                actions.append(button('按参与名单开始模拟', () => run(() => application.startSimulation())));
            }
            actions.append(addSelectedButton({ application, run, selected, simulation }));
        } else if (simulation.phase === 'preparing') {
            actions.append(button('取消准备', () => application.cancelSimulationPreparation()));
        } else if (simulation.phase === 'running' || simulation.phase === 'paused') {
            actions.append(button(simulation.phase === 'running' ? '暂停' : '继续', () =>
                run(() => simulation.phase === 'running' ? application.pauseSimulation() : application.resumeSimulation())));
            if (simulation.phase === 'running') {
                actions.append(button(simulation.grabbing ? '关闭抓取' : '开启抓取', () =>
                    run(() => application.setGrabbing(!simulation.grabbing))));
            }
            actions.append(addSelectedButton({ application, run, selected, simulation, append: true }));
            actions.append(button('返回准备阶段', () => run(() => application.returnToPreparation())));
        }
        if (simulation.error) summary.append(` · ${simulation.error}`);
        element.replaceChildren(title, summary, metrics, timing, actions);
    });
    host.append(element);
    return Object.freeze({
        element,
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            element.remove();
        }
    });
}

function addSelectedButton({ application, run, selected, simulation, append = false }) {
    const participating = selected != null && simulation.participantIds.includes(selected.id);
    let label;
    if (!selected) label = '请先选择实例';
    else if (participating) label = '所选实例已在模拟中';
    else if (!selected.eligible) label = '所选实例物性无效';
    else label = append ? '将所选实例追加到模拟' : '将所选实例加入模拟';

    const add = button(label, () => run(() => application.addSelectedToSimulation()));
    add.disabled = !selected?.eligible || participating;
    return add;
}

function phaseText(state) {
    const labels = { preparation: '准备阶段', preparing: '正在按需准备', running: '运行中', paused: '已暂停', returning: '正在返回准备阶段' };
    const participant = state.participantIds.length ? ` · ${state.participantIds.length} 个模拟实例` : '';
    return `${labels[state.phase] ?? state.phase}${participant}`;
}

function metricsText(metrics) {
    if (!metrics?.length) return '体积与质量来自体素占据近似；结果取决于离散分辨率。';
    return metrics.map(value =>
        `ID ${value.instanceId}：resolution ${value.resolution}，占据体积 ${format(value.volume)} m³，近似质量 ${format(value.mass)} kg`
    ).join('；');
}

function timingText(timing) {
    if (!timing) return '固定步长每帧最多 24 步；准备耗时不计入模拟积压。';
    const dropped = Number.isFinite(timing.droppedTime) ? timing.droppedTime : 0;
    const backlog = Number.isFinite(timing.backlogTime) ? timing.backlogTime : 0;
    return timing.overloaded || dropped > 0
        ? `模拟慢于现实时间 · 积压 ${backlog.toFixed(3)} s · 已丢时 ${dropped.toFixed(3)} s`
        : `固定步长运行 · 每帧上限 ${timing.maxStepsPerFrame ?? 24} 步 · 已丢时 ${dropped.toFixed(3)} s`;
}

function format(value) {
    return Number.isFinite(value) ? value.toPrecision(5) : '—';
}

function button(label, action) {
    const result = document.createElement('button');
    result.type = 'button';
    result.textContent = label;
    result.addEventListener('click', action);
    return result;
}

function node(tag, text) {
    const result = document.createElement(tag);
    result.textContent = text;
    return result;
}
