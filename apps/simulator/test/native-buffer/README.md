# PlayCanvas native-buffer smoke

From `apps/simulator`, with its Vite server and an isolated WebGPU Chrome running:

```sh
node test/native-buffer/run.mjs --base http://127.0.0.1:5188 --cdp http://127.0.0.1:9358 --output <results-directory>
```

Formal acceptance uses the editor's `scripts/browser-4090/run.mjs` desktop and
presentation gates. See `docs/browser-tests-on-4090.md` in the editor workspace.
The fixture is synthetic and needs no external assets. The runner closes only
its own tab and fails on wrong pixels, browser errors or WebGPU validation errors.

`src/render/playcanvasInterop.js` is the only module allowed to borrow
PlayCanvas's private native device or wrap a GPUBuffer as a host parameter.
`nativeDevice(app.graphicsDevice)` returns the existing device, without requesting
another. `attachNativeSplatModifier(component, wgsl, buffers)` occupies the work-buffer
hook, passes `{ impl: { buffer } }` to `setParameter`, and forces evaluation each
frame. Callers supply host WGSL declarations and buffers from that same device;
this intentionally does not define ticket 14's final deformation manifest.
The pinned PlayCanvas dependency is guarded by this real-browser smoke and
`test/unit/playcanvasInteropBoundary.test.js`, including browser fixture source.

The app writes its native input in `update`, before the host's work-buffer bake.
Shared-queue ordering makes those writes visible to the modifier and then the
GPU sorter/draw. No cross-device copies or readback of private host data are used.

The fixed 320×240 orthographic view has two overlapping red/green Gaussians at
x = −0.8, z = ±0.35. Two zero-opacity splats pad the input to four keys, the
minimum 16-byte binding required by the pinned NVIDIA OneSweep sorter.
After eight warmup frames, each assertion samples the first
frame after a native update, at pixels (112,120) and (208,120):

- Rest: red at the left, black at the right.
- Translation +1.6 in x: red at the right, black at the left.
- Reverse z: green at the right. A sorter still using rest centres fails this.
- Restore the input: red at the left again.
- Detach twice, verify the caller can still write/read `[7,8,9,10]`, then destroy
  the input: the host draws its unmodified rest cloud without accessing freed data.
- Destroy the cloud: both sample positions are black.

The front channel must exceed 100 and the other color by 80; the opposite sample
must have RGB below 12. Pixel values and PNGs for all six phases are saved.
This checks movement and depth compositing without a whole-image golden snapshot.
Cleanup detaches the hook before component/buffer release, drains the shared queue,
checks validation scopes, and only then asks the app to destroy its own device.
The interop module never destroys borrowed buffers or the host device.
