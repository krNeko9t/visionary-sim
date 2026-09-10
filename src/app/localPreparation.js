import { validatePreparationConfig } from './preparationConfig.js';

export const LOCAL_PREPARATION_KEY = 'softbody.preparation-config';

/**
 * Persists one lightweight, validated preparation configuration.
 * The validator is supplied by preparationConfig.js so this adapter never
 * owns or duplicates the configuration schema.
 */
export function createLocalPreparationStore({
    storage,
    validate = validatePreparationConfig,
    key = LOCAL_PREPARATION_KEY
} = {}) {
    if (typeof validate !== 'function') {
        throw new TypeError('a preparation configuration validator is required');
    }
    const resolveStorage = storage === undefined
        ? () => globalThis.localStorage
        : () => storage;

    return Object.freeze({
        save(config) {
            const canonical = validate(config);
            const serialized = JSON.stringify(canonical);
            try {
                const target = resolveStorage();
                target.setItem(key, serialized);
                if (target.getItem(key) !== serialized) {
                    throw new Error('saved value could not be read back');
                }
                return {
                    status: 'saved',
                    message: '准备配置已保存到此浏览器。'
                };
            } catch (error) {
                return storageFailure('storage-write-failed', error,
                    '浏览器未能保存准备配置。当前编辑仍保留；请导出 JSON 作为恢复副本。');
            }
        },

        read() {
            let serialized;
            try {
                serialized = resolveStorage().getItem(key);
            } catch (error) {
                return {
                    ...storageFailure('storage-read-failed', error,
                        '浏览器未能读取准备配置。当前编辑未更改；可导入此前导出的 JSON。'),
                    canImport: true
                };
            }
            if (serialized === null) {
                return {
                    status: 'empty',
                    message: '此浏览器没有已保存的准备配置；可导入此前导出的 JSON。',
                    canImport: true
                };
            }
            try {
                return {
                    status: 'loaded',
                    config: validate(JSON.parse(serialized)),
                    message: '已读取浏览器中的准备配置；请重新选择三个源文件。',
                    requiresSourceFiles: true,
                    autoStart: false
                };
            } catch (error) {
                return {
                    ...storageFailure('saved-configuration-invalid', error,
                        '浏览器中的准备配置已损坏或不受支持。当前编辑未更改；可导入此前导出的 JSON。'),
                    canImport: true
                };
            }
        }
    });
}

function storageFailure(code, error, message) {
    return {
        status: 'failed',
        code,
        message,
        canExport: true,
        detail: error instanceof Error ? error.message : String(error)
    };
}
