/**
 * Marker string of the runner core (DG1 note §3.3): the app's production bundle check fails if it occurs in a
 * shipped Hermes bundle, and the preview-diagnostics positive control requires it. Hermes keeps ASCII string
 * literals verbatim in the bytecode string table, so a byte search finds it. Keep the value unique in the repository.
 */
export const GOLDEN_RUNNER_MARKER = 'CODELEX_GOLDEN_RUNNER_V1';
