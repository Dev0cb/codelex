import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseRunnerReportText } from '../runner-report.js';
import { hermesRuntime, runHermesHost } from './hermes.js';

describe('Hermes CLI host (ADR-0016 §D3 item 2)', { timeout: 120_000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reads the runtime block from HermesInternal properties', () => {
    expect(hermesRuntime({ 'OSS Release Version': '1.0.0', 'Bytecode Version': 98 })).toEqual({
      kind: 'hermes-cli',
      version: '1.0.0',
      bytecodeVersion: 98,
    });
    expect(hermesRuntime(undefined)).toEqual({
      kind: 'hermes-cli',
      version: 'unknown',
      bytecodeVersion: 0,
    });
    expect(hermesRuntime({ 'OSS Release Version': 'x\ny', 'Bytecode Version': -1 })).toEqual({
      kind: 'hermes-cli',
      version: 'unknown',
      bytecodeVersion: 0,
    });
  });

  it('prints one canonical report that parses, with injected timings', () => {
    const printed: string[] = [];
    runHermesHost(
      {
        print: (t) => printed.push(t),
        HermesInternal: {
          getRuntimeProperties: () => ({ 'OSS Release Version': '1.0.0', 'Bytecode Version': 98 }),
        },
      },
      () => 7,
    );
    expect(printed).toHaveLength(1);
    const parsed = parseRunnerReportText(printed[0] ?? '');
    expect(parsed.ok && parsed.value.verdict).toBe('pass');
    expect(parsed.ok && parsed.value.timings?.['rng']).toEqual({ totalMs: 0 });
  });

  it('hermes-main runs on load with the VM globals (print, HermesInternal)', async () => {
    const printed: string[] = [];
    vi.stubGlobal('print', (t: string) => printed.push(t));
    vi.stubGlobal('HermesInternal', { getRuntimeProperties: () => ({ 'Bytecode Version': 98 }) });
    await import('./hermes-main.js');
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('"kind":"hermes-cli"');
  });
});
