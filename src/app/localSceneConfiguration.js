import { createLocalPreparationStore } from './localPreparation.js';

/** Browser persistence operations over the portable configuration controller. */
export function createLocalSceneConfiguration(configuration, { storage } = {}) {
    const store = createLocalPreparationStore({ storage });
    let state = Object.freeze({ status: 'idle', busy: false, message: '准备配置仅在点击保存时写入浏览器。' });
    let disposed = false;
    const listeners = new Set();
    const publish = next => {
        if (disposed) return;
        state = Object.freeze({ busy: false, ...next });
        for (const listener of listeners) {
            try { listener(state); } catch (error) { console.error('[local-configuration] subscriber failed', error); }
        }
    };
    const run = async (operation, action) => {
        if (disposed) return { status: 'failed', code: 'disposed', message: '本地配置控制器已关闭。' };
        if (state.busy) return { status: 'failed', code: 'busy', message: '请等待当前本地配置操作完成。' };
        publish({ status: operation, busy: true, message: operation === 'saving' ? '正在保存准备配置…' : '正在读取本地准备配置…' });
        let result;
        try { result = await action(); } catch (error) {
            result = {
                status: 'failed', code: `${operation}-failed`, canExport: true, canImport: true,
                message: '本地配置操作失败；当前编辑仍保留，可使用 JSON 导出或导入恢复副本。',
                detail: error instanceof Error ? error.message : String(error)
            };
        }
        publish(result);
        return result;
    };
    return Object.freeze({
        getState: () => state,
        subscribe(listener) {
            if (disposed) return () => {};
            listeners.add(listener);
            try { listener(state); } catch (error) { console.error('[local-configuration] subscriber failed', error); }
            return () => listeners.delete(listener);
        },
        saveLocal: () => run('saving', async () => {
            const config = await configuration.exportConfiguration();
            if (disposed) throw new Error('本地配置控制器已关闭');
            return store.save(config);
        }),
        loadLocal: () => run('loading', async () => {
            const result = store.read();
            if (result.status !== 'loaded') return result;
            await configuration.importConfiguration(result.config);
            return result;
        }),
        dispose() { disposed = true; listeners.clear(); }
    });
}
