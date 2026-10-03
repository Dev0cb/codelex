/**
 * Seeded property tests (ADR-0013 §D4: determinism applies to tests too): every `fc.assert` in this package runs
 * the same cases on every machine. A failure prints its seed and path for replay.
 */
import fc from 'fast-check';

fc.configureGlobal({ seed: 20261003 });
