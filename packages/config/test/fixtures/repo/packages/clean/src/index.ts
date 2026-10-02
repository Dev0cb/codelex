import { OTHER } from "../../other/src/index.js";

export const PKG_VALUE = OTHER + 1;

export async function load(): Promise<number> {
  await Promise.resolve();
  return PKG_VALUE;
}

export async function useLoad(): Promise<number> {
  return await load();
}
