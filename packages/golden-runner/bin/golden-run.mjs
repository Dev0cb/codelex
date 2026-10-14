#!/usr/bin/env node
// Node host (ADR-0016 §D3 item 2): prints the runner report (canonical JSON) to stdout.
// Exit 0 = verdict pass, 1 = verdict fail, 2 = invalid report. Needs `pnpm --filter @codelex/golden-runner build`.
import { performance } from 'node:perf_hooks';

import { runNodeHost } from '../dist/host/node.js';

process.exitCode = runNodeHost(
  { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
  { version: process.version, clock: () => Math.floor(performance.now()) },
);
