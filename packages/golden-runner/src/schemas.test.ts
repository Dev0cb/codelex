import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { diagnosticsReportSchema, runnerReportSchema } from './index.js';

/**
 * Frozen contracts: `runnerFormat` 1 and `diagnosticsFormat` 1. A change to either JSON Schema snapshot is a format
 * change: bump the format, add the new schema next to the old one, and never update these snapshots in place
 * (`vitest -u` on them is a review blocker). Refinements (sizes, counts, verdict, unique ids, JCS subset) are not
 * expressible in JSON Schema; their tests are in runner-report.test.ts and diagnostics-report.test.ts.
 */
describe('frozen schemas', () => {
  it('runner report, runnerFormat 1', async () => {
    const schema = z.toJSONSchema(runnerReportSchema, { io: 'input' });
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(
      '../test/schemas/runner-report.v1.schema.json',
    );
  });

  it('Diagnostics report, diagnosticsFormat 1', async () => {
    const schema = z.toJSONSchema(diagnosticsReportSchema, { io: 'input' });
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(
      '../test/schemas/diagnostics-report.v1.schema.json',
    );
  });
});
