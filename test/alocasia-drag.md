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

## Isolating the fixes

The original before/after comparison changes region labels, grip law, damping,
and tensile limiting together. It cannot establish which change is necessary.
Run independent interventions with:

```sh
node test/alocasia-drag-run.mjs --ablation --output /tmp/alocasia-drag-ablation.json
```

| Case | Node labels | Grip | Damping (/s) | maxStretch |
| --- | --- | --- | --- | --- |
| before | Sample-distance complement | Hard | 0.6 | Disabled |
| labelsOnly | Nearest foreground label | Hard | 0.6 | Disabled |
| labelsAndSoftGrip | Nearest foreground label | Compliant, 3 ms | 0.6 | Disabled |
| noLimit | Nearest foreground label | Compliant, 3 ms | 2 | Disabled |
| after | Nearest foreground label | Compliant, 3 ms | 2 | 1.05 |
| limit102 | Nearest foreground label | Compliant, 3 ms | 2 | 1.02 |
| limit110 | Nearest foreground label | Compliant, 3 ms | 2 | 1.10 |

Each of the first five cases changes one factor from the preceding case. Compare
the last two against `after` to assess threshold sensitivity. This is a sequential
ablation, not a complete factorial experiment: it does not isolate every possible
interaction. `--cases labelsOnly,noLimit` selects a subset in ablation mode.
Results are saved after each completed case, including on a later assertion failure.
Ablation asserts finite positions and unchanged support, without assuming every
variant meets the existing visual regression thresholds. Those thresholds and
the tensile ratio are not calibrated biological material properties.
`noLimitLarge` and `noLimitSideways` additionally repeat the 10 cm and sideways
4 cm drags with the current settings except that tensile limiting is disabled.

`--compute-only` bypasses canvas presentation, submitting the same production
compute dispatch and waiting for the GPU queue directly. Use it when an isolated
headless browser supports WebGPU compute but cannot present a swap-chain texture.
It checks simulation behavior, not rendering or DOM pointer events. Record the
actual adapter/backend; software execution is not target-device performance
acceptance. The default runner continues to use application render frames.

## Recorded ablation, 2026-10-13

Production commit `641d9fd`, real prepared Alocasia assets, Chrome reporting
SwiftShader, compute-only dispatch. The baseline command passed the existing
four-case regression before the interventions. All cases use the same ray and
hit position, hold 12 nodes, and sample 1046 leaf points over the same simulated
duration. All captured node positions remain finite and fixed support stays still.
Raw snapshots, commands, asset hashes, backend and an assessment against the
existing visual gates are in
[drag-ablation-results.json](../.scratch/physdreamer-alocasia/drag-ablation-results.json).

For the 4 cm drag, tensile strain below is `(maximum stretch - 1) * 100`, reported
at the 95th percentile across the sampled leaf surface, not an absolute bound.

| Configuration | Petiole displacement (mm) | Leaf strain p95 (%) | First release-step displacement (mm) |
| --- | ---: | ---: | ---: |
| Original behavior | 0.058 | 76.74 | 0.814 |
| Region labels only | 18.187 | 7.04 | 0.089 |
| Labels + compliant grip | 15.460 | 4.98 | 0.044 |
| Current settings without tensile limit | 15.291 | 4.94 | 0.046 |
| Current settings, limit 1.05 | 13.729 | 5.37 | 0.082 |
| Limit 1.02, other current settings unchanged | 11.259 | 3.73 | 0.133 |
| Limit 1.10, other current settings unchanged | 14.936 | 4.72 | 0.047 |

The region-only intervention already passes all existing visual gates for this
4 cm drag. Therefore the original before/after result does not establish that
tensile limiting was needed to fix the reported local-only response.

For a 10 cm drag, current settings without the limit produce 16.68% p95 strain
versus 9.71% with 1.05; the former fails the existing 12% p95 visual gate, while
the other gates still pass. Leaf displacement is 89.947 mm without the limit
versus 70.166 mm with it. Sideways 4 cm p95 strain is about 1.92% either way.
The limiter does affect larger interactions, including how far the material
follows the pointer. Removing it would change a previously accepted behavior.

These measurements establish the effects of the interventions, not biological
accuracy. The tests contain no measured leaf force/displacement target. Neither
the 1.05 parameter nor the 12% visual gate gains physical calibration from passing
this regression. The 1.02/1.05/1.10 comparison also shows why the parameter must
not be read as a strict cap on surface strain. Production material/solver settings
were not changed in this investigation.
