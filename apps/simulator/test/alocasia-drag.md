# Alocasia GPU drag regression

Start Vite on port 5188 and an isolated Chrome with WebGPU enabled and remote
debugging on port 9351. Use a separate temporary browser profile. Run:

```sh
node test/alocasia-drag-run.mjs --output /tmp/alocasia-drag-results.json
```

`--base` and `--cdp` override those endpoints. The runner creates and closes its
own tab; it does not attach to any existing page. Requires Node with WebSocket
(Node 24 is used for the offline asset tools too) and the real Alocasia assets.

This runs the production scene preparation, Simulator, picking, grip, and GPU
compute shaders. The control restores the former sample-distance node labels,
unlimited tensile strain and hard grip; it must still exhibit the reported bug.
Each run drags for 0.4 simulated seconds, holds for 0.2 seconds and samples release
over 2 seconds. The corrected path uses the scene's actual default settings.

The 4 cm, 10 cm and perpendicular drags must move the petiole, keep leaf strain
bounded, release continuously, decay, and preserve support. Strain is sampled at
over 500 foreground points on the selected leaf using the production deformation
sampler's CPU reference on GPU-read node positions. Its largest singular value
is estimated by power iteration. End-to-end chord length is reported separately:
unfolding a curved leaf can lengthen a chord without stretching the material.

These thresholds distinguish the reported rubber-like failure from useful plant
interaction; they are not measured biological material properties. This test
does not benchmark rendering or guarantee self-contact between leaves.
