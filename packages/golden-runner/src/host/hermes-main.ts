/**
 * Entry module of the Hermes CLI bundle (`scripts/build-hermes.mjs`): runs {@link runHermesHost} with the VM's
 * globals on load. Not imported by anything else.
 */
import { runHermesHost, type HermesGlobals } from './hermes.js';

/** Globals of the bare `hermes` CLI (tests stub them). */
declare const print: HermesGlobals['print'];
declare const HermesInternal: NonNullable<HermesGlobals['HermesInternal']> | undefined;

runHermesHost(typeof HermesInternal === 'undefined' ? { print } : { print, HermesInternal }, () =>
  Date.now(),
);
