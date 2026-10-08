#!/usr/bin/env node
// Comparison CLI (ADR-0016 §D3.2): golden-compare <node-report.json> <hermes-report.json>.
// Exit 0 = equal and passing, 1 = any difference or failing case, 2 = usage or unreadable file.
import { readFileSync } from 'node:fs';

import { runCompareCli } from '../dist/host/node.js';

process.exitCode = runCompareCli(
  process.argv.slice(2),
  { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
  (path) => readFileSync(path, 'utf8'),
);
