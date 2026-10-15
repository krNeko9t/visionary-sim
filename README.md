# visionary-sim workspace

`packages/visionary-sim/` contains the private `visionary-sim` kernel package.
`apps/simulator/` contains the private PlayCanvas experiment app, `simulator-app`.
The app imports the workspace source by package name; neither package is published.

From this repository's root (Node 24+):

```sh
npm ci
npm run dev -- --port 5188
npm run build
npm run preview -- --port 5188
npm run check
```

The application opens at `/`. Asset URLs stay `/models/...` and `/splats/...`;
files now live under `apps/simulator/public/`. Real PLY captures are supplied per
checkout and remain ignored by Git. Build output is `apps/simulator/dist/`.

Run one test file with `npm test -- packages/visionary-sim/test/unit/timestep.test.js`.
Kernel tests live with the kernel, application tests with the app; repository
structure and boundary checks live in `test/unit/`. The root Vitest config finds all three.

Offline tools live with the app. Run these from this repository's root, with the
same arguments and input files as before:

```sh
node apps/simulator/tools/prepare-physdreamer.js --scene alocasia --input <dataset> --output <asset-directory> --camera-convention opengl-c2w
node apps/simulator/tools/calibrate-physdreamer.js --scene alocasia --input <asset-directory> --output <report-directory> --input-kind real --r=0.016 --element-sizes 0.016,0.008
```

The `prepare-alocasia.js` and `calibrate-alocasia.js` compatibility commands also
remain in that directory; preparation without `--output` writes under the app's
`public/splats/` directory regardless of the current working directory.

Browser runners run with `apps/simulator/` as their working directory, against its
Vite server and an isolated Chrome with WebGPU. See
[test/motion-reference/README.md](apps/simulator/test/motion-reference/README.md)
and [test/alocasia-drag.md](apps/simulator/test/alocasia-drag.md). The editor's
`docs/browser-tests-on-4090.md` describes the mandatory desktop and presentation gates.
The synthetic [native-buffer smoke](apps/simulator/test/native-buffer/README.md)
guards native-buffer work-buffer modifiers, GPU sorting and resource ownership.

This is the mechanical workspace split. Mixed rest-geometry and asset-preparation
modules remain together in the app until ticket 10; the kernel temporarily reaches
those files. Temporary `visionary-sim/*` exports preserve existing module shapes
until the public-interface ticket. Existing PlayCanvas compute dependencies remain
until the compute-backend ticket. `test/sourceTree.js` preserves the S1 logical
source identities, including all mixed asset candidates, and scans all package
source without changing the immutable exemption baseline.
