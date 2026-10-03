// Expo Router native intent: every system URL (cold start and while running) passes through the deep-link guard
// before the router parses it (GHSA-vcc3-ghjq-m6fr, src/linking/deep-link.ts).
export { redirectSystemPath } from '../linking/deep-link';
