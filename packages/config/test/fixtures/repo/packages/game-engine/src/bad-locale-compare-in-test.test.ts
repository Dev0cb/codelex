import { expect, it } from "vitest";

it("determinism still applies to tests", () => {
  expect("a".localeCompare("b")).toBe(-1);
});
