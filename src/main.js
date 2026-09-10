import { WebGpuUnavailableError, applicationNamed } from './app/applications.js';

const canvas = document.getElementById('app');
const unsupported = document.getElementById('unsupported');
const query = new URLSearchParams(window.location.search);

async function boot() {
    try {
        // The browser entry only selects and starts a concrete application.
        const application = applicationNamed(query.get('app'), {
            canvas,
            sceneName: query.get('scene')
        });
        await application.start();
        window.application = application;
    } catch (error) {
        canvas.style.display = 'none';
        unsupported.style.display = 'flex';
        const title = unsupported.querySelector('h1');
        const detail = unsupported.querySelector('p');
        if (error instanceof WebGpuUnavailableError) {
            title.textContent = 'WebGPU 初始化未完成';
            detail.textContent = error.message;
        } else {
            title.textContent = '应用启动失败';
            detail.textContent = error instanceof Error ? error.message : String(error);
        }
        console.error('[softbody] application startup failed', error);
    }
}

boot();
