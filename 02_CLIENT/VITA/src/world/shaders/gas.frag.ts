/**
 * gas.frag.ts — Gas giant fragment shader reference.
 *
 * The gas giant rendering path is embedded inside WORLD_FRAG in solid.frag.ts,
 * branching on the uIsGas uniform. They are NOT separate shaders.
 *
 * This file re-exports WORLD_FRAG as GAS_FRAG for semantic clarity
 * when you know you're dealing with a gas giant.
 */

export { WORLD_FRAG as GAS_FRAG } from './solid.frag';
