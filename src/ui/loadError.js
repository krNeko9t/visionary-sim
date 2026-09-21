/** Display a failed scene load without leaving a partial scene on screen. */
export function showLoadError(canvas, error) {
    canvas.style.display = 'none';
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = `Scene could not load: ${error.message}`;
    message.style.cssText = 'color: #eee; padding: 2rem; white-space: pre-wrap';
    document.body.append(message);
}
