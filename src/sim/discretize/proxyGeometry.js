/**
 * What one body's discretisation hands to everything outside it.
 *
 * A body the author described becomes a set of nodes the solver can move, and
 * this is the whole of what the rest of the simulation is allowed to learn
 * about how that happened. It is written down as a type -- entries and the
 * invariants that go with them -- because an invariant is as much a part of an
 * interface as a field: a caller that relies on one is entitled to, and a
 * second implementation has to renegotiate every one of them, which it can only
 * do if they are written somewhere. `test/unit/proxyGeometry.test.js` checks
 * each implementation against this list; a new one gets in by passing it.
 *
 * What the seam buys is locality, not a second backend (ADR-0006): knowing how
 * the nodes were laid out lives in one directory, and nothing here names it.
 *
 * Invariants:
 *
 * - **I1** `dof.invMass[i] === 0` means only that slot holds no material -- an
 *   inactive node. `nodeCount` is the number of slots occupied, and the
 *   interface does not promise that every slot has mass. "Not solved for right
 *   now" is a reading that only exists once `Particles` has combined this with
 *   whatever is prescribed; it is not something this interface can know
 *   (ADR-0003).
 * - **I2** `contactSurface().radii` seal the surface: any two contact nodes
 *   joined directly by a segment of `wireframe()` are no further apart than the
 *   sum of their radii. This is the admission condition of the sphere contact
 *   model (ADR-0008), not a law of proxy geometry -- another body's nodes must
 *   not slip between two spheres -- and the shape of entry 2 is that model's
 *   too. Changing the contact model changes this invariant with it.
 * - **I3** `spacing.min` is a lower bound *measured* on the finished node set,
 *   not something a generator promises, and nothing's correctness rests on it:
 *   it only feeds warnings, and a crowded contact bucket is handled
 *   deterministically in `sim/constraints/wgsl/sort.wgsl` whatever it says.
 * - **I4** `wireframe().positions` are node rest positions: every one of them
 *   coincides with some node of `dof.restPositions`. The conformance test reads
 *   I2 off the wireframe's segments, so the wireframe is part of the contract,
 *   not a debugging by-product that may be left out.
 * - **I5** What `field()` hands back is opaque: its `parameters` are forwarded,
 *   never read, and the only promise is the WGSL function
 *   `deformationAt(rest) -> Deformation`. Reading a node's position by its
 *   index is not part of it -- that presumes node indices form one dense range
 *   of integers, which is exactly the kind of assumption that must stay inside
 *   an implementation.
 * - **I6** Every body owns a disjoint range of nodes (`Particles.offsetOf`).
 *   Each implementation's part of that is to index only its own `nodeCount`
 *   slots, body-local from zero, in everything it hands out.
 *
 * @typedef {object} ProxyGeometry
 * @property {ProxyDof} dof - The degrees of freedom, as `Particles` takes them.
 * @property {() => ContactSurface} contactSurface - The nodes another body can
 *   touch, and how far out each one reaches. See I2.
 * @property {(nodePositions: object, nodeOffset: number) =>
 *   import('../../deformation/bind.js').DeformationField} field - This body's
 *   deformation, read from the live node buffer at `nodeOffset`.
 * @property {() => Wireframe} wireframe - Line segments between nodes, for
 *   looking at the discretisation. See I2, I4.
 * @property {() => Scale} scale - How finely the body is cut.
 * @property {{ min: number, max: number }} spacing - Distance from a node with
 *   material to its nearest such neighbour, smallest and largest over the body,
 *   in metres. See I3.
 * @property {number} cflLength - The length an elastic wave has to cross within
 *   one substep for the solve to stay stable, in metres. Not `spacing`: the two
 *   agree on some discretisations and not on others.
 * @property {(previous: number, density: number) => void} setDensity - Rescales
 *   `dof.invMass` in place after a density change. Zeros stay zero (I1).
 */

/**
 * @typedef {object} ProxyDof
 * @property {Float32Array} restPositions - Rest positions, 3 floats per node.
 * @property {Float32Array} invMass - Inverse mass per node; see I1.
 * @property {number} nodeCount - Slots occupied; see I1.
 */

/**
 * @typedef {object} ContactSurface
 * @property {Uint32Array} nodes - Body-local indices of the nodes that can touch
 *   another body, ascending.
 * @property {Float32Array} radii - Each one's contact radius, same order.
 */

/**
 * @typedef {object} Wireframe
 * @property {Float32Array} positions - Vertex rest positions, 3 floats each;
 *   every one is a node's (I4).
 * @property {Float32Array} offsets - Per vertex, a rest-space vector pointing
 *   inwards, 3 floats each. How far along it to pull the vertex is up to whoever
 *   draws it: a fraction of 1 keeps the pulled point inside the body.
 * @property {Uint32Array} indices - Segments, two vertex indices each.
 * @property {{ start: number, count: number }[]} groups - Ranges of `indices`
 *   worth telling apart. What a group means is the implementation's; whoever
 *   draws them only needs them distinct.
 */

/**
 * How finely something is cut, as a person reads it: a count and the word for
 * what was counted. Only counts with the same word add up.
 *
 * @typedef {object} Scale
 * @property {string} label - What was counted.
 * @property {number} value - How many.
 */

export {};
