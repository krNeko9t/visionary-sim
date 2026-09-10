import './instanceInspector.css';

/**
 * Mounts the A-layout instance catalog and material inspector.
 *
 * The UI receives only observable application state and public operations. It
 * never owns source rows, render entities or simulation resources.
 *
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {{subscribe: Function, selectInstance: Function, setColorMode: Function,
 *   setMaterialOverride: Function, clearMaterialOverride: Function}} options.materials
 * @returns {{element: HTMLElement, dispose: () => void}}
 */
export function mountInstanceInspector({ root, materials }) {
    const element = node('div', 'instance-workbench');
    const catalog = node('aside', 'instance-catalog');
    const inspector = node('aside', 'instance-inspector');
    const inspectorDetails = node('div', 'instance-inspector-details');
    const simulationSlot = node('div', 'instance-simulation-slot');
    inspector.append(inspectorDetails, simulationSlot);
    const left = node('div', 'instance-left');
    const importSlot = node('div', 'instance-import-slot');
    left.append(importSlot, catalog);
    element.append(left, inspector);
    root.append(element);

    let disposed = false;
    const unsubscribe = materials.subscribe(render);

    function render(state) {
        if (disposed) return;
        state = 'inspection' in state ? state.inspection : state;
        if (!state) { catalog.hidden = true; inspector.hidden = true; return; }
        catalog.hidden = false; inspector.hidden = false;
        renderCatalog(catalog, state, materials);
        renderInspector(inspectorDetails, state, materials);
    }

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

function renderCatalog(host, state, materials) {
    const heading = node('div', 'instance-heading');
    heading.append(
        node('h2', undefined, '场景实例'),
        node('span', 'instance-count', `${state.instances.length} 个正 ID`)
    );
    const guidance = node('p', 'instance-note', '画面点选与列表选择共用同一选中项；遮挡物可直接从列表选择。');
    const list = node('div', 'instance-list');
    for (const instance of state.instances) {
        const button = node('button', 'instance-option');
        button.type = 'button';
        button.dataset.instanceId = String(instance.id);
        button.setAttribute('aria-pressed', String(state.selectedId === instance.id));
        if (state.selectedId === instance.id) button.classList.add('is-selected');
        const identity = node('span');
        identity.append(
            node('strong', undefined, instance.name),
            node('small', undefined, `ID ${instance.id}`)
        );
        const status = node('span', `instance-eligibility ${instance.eligible ? 'is-ready' : 'is-blocked'}`,
            instance.eligible ? '可加入' : '待补物性');
        button.append(identity, status);
        button.addEventListener('click', () => materials.selectInstance(instance.id));
        list.append(button);
    }

    const coloring = node('label', 'instance-coloring');
    const input = node('input');
    input.type = 'checkbox';
    input.checked = state.colorMode === 'instances';
    input.addEventListener('change', () => materials.setColorMode(input.checked ? 'instances' : 'source'));
    coloring.append(input, node('span', undefined, '按实例 ID 着色核查'));

    const untracked = state.untracked
        ? `标签 0 未追踪内容保留渲染${state.untracked.count === null ? '' : ` · ${state.untracked.count.toLocaleString()} 个高斯`}，不赋予模拟身份或物性。`
        : '没有标签 0 的未追踪内容。';
    const sourceWarning = node('p', 'instance-warning', '结构校验无法证明同规模三件套同源；着色发现错配时，请重新选择文件。');
    host.replaceChildren(heading, guidance, list, coloring, node('p', 'instance-note', untracked), sourceWarning);
}

function renderInspector(host, state, materials) {
    const selected = state.selected;
    if (!selected) {
        host.replaceChildren(
            node('small', 'instance-kicker', 'SELECTION'),
            node('h2', undefined, '选择一个实例'),
            node('p', 'instance-note', '在场景表面点选，或从左侧列表选择被遮挡的实例。选择不会生成模拟资源。')
        );
        return;
    }

    const identity = node('p', 'instance-identity', `源实例 ID ${selected.id}${selected.count === null ? '' : ` · ${selected.count.toLocaleString()} 个高斯`}`);
    const eligibility = node(
        'p',
        `instance-summary ${selected.eligible ? 'is-ready' : 'is-blocked'}`,
        selected.eligible ? '当前物性有效，具备加入条件。' : eligibilityText(selected, state.materialFields)
    );
    const table = node('div', 'instance-materials');
    table.append(materialHeader());
    for (const field of state.materialFields) {
        table.append(materialRow(selected, field, materials));
    }

    const assessment = assessmentSection(selected);
    host.replaceChildren(
        node('small', 'instance-kicker', 'INSTANCE'),
        node('h2', undefined, selected.name),
        identity,
        eligibility,
        table,
        assessment,
        node('p', 'instance-note', '选择不会启动模拟。物性保留原始 SI 单位，不自动降低刚度。')
    );
}

function materialHeader() {
    const row = node('div', 'instance-material-row is-header');
    row.append(
        node('span', undefined, '参数'),
        node('span', undefined, '上游原值'),
        node('span', undefined, '当前生效值')
    );
    return row;
}

function materialRow(instance, field, materials) {
    const row = node('div', 'instance-material-row');
    const label = node('span', 'instance-material-label');
    label.append(node('strong', undefined, field.label), node('small', undefined, field.unit));

    const source = node('output', 'instance-source-value', formatValue(instance.sourceMaterial[field.key]));
    const editor = node('div', 'instance-current-value');
    const input = node('input');
    input.type = 'number';
    input.step = 'any';
    input.inputMode = 'decimal';
    input.setAttribute('aria-label', `${field.label}（${field.unit}）当前生效值`);
    const effective = instance.effectiveMaterial[field.key];
    input.value = Number.isFinite(effective) ? String(effective) : '';
    input.placeholder = '待补';
    input.classList.toggle('is-invalid', Boolean(instance.errors[field.key]));
    input.addEventListener('change', () => {
        const value = input.value === '' ? undefined : Number(input.value);
        materials.setMaterialOverride(instance.id, { [field.key]: value });
    });
    editor.append(input);
    if (Object.prototype.hasOwnProperty.call(instance.overrides, field.key)) {
        const clear = node('button', 'instance-clear', '恢复原值');
        clear.type = 'button';
        clear.addEventListener('click', () => materials.clearMaterialOverride(instance.id, [field.key]));
        editor.append(clear);
    }
    const problem = instance.errors[field.key]
        ?? (instance.missingFields.includes(field.key) ? `缺少${field.label}` : null);
    if (problem) editor.append(node('small', 'instance-field-error', problem));
    row.append(label, source, editor);
    return row;
}

function assessmentSection(instance) {
    const section = node('section', 'instance-assessment');
    section.append(node('h3', undefined, '上游评估信息'));
    const entries = Object.entries(instance.upstreamAssessment);
    if (!entries.length) {
        section.append(node('p', 'instance-note', '上游未提供不确定性或 trust 信息。'));
        return section;
    }
    const values = node('dl', 'instance-assessment-values');
    for (const [key, value] of entries) {
        values.append(node('dt', undefined, key), node('dd', undefined, formatAssessment(value)));
    }
    section.append(
        values,
        node('p', 'instance-warning', '这些原值保持在上游推断空间，不是 SI 误差条；trust 也不是准确性证明。')
    );
    return section;
}

function eligibilityText(instance, fields) {
    const labels = new Map(fields.map(field => [field.key, field.label]));
    const missing = instance.missingFields.map(key => labels.get(key) ?? key);
    const invalid = Object.keys(instance.errors).map(key => labels.get(key) ?? key);
    const parts = [];
    if (missing.length) parts.push(`待补：${missing.join('、')}`);
    if (invalid.length) parts.push(`无效：${invalid.join('、')}`);
    return `${parts.join('；')}。此实例仍保持可见，其他实例不受影响。`;
}

function formatValue(value) {
    return value === undefined ? '缺失' : Number.isFinite(value) ? String(value) : `无效：${String(value)}`;
}

function formatAssessment(value) {
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}
