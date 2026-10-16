#!/usr/bin/env node
/**
 * Exit-KPI readout CLI (sprint 4 KR).
 *
 *   node tools/readout/cli.mjs [--roster roster.csv] [--json out.json] [--text out.txt] [--allow-invalid] file...
 *
 * Prints the text readout to stdout (or writes it with --text). Exit codes: 0 ok, 1 a file was rejected (unless
 * --allow-invalid), 2 usage or roster error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { computeReadout } from "./exit-kpi.mjs";
import { renderText } from "./render.mjs";

export function parseArgs(argv) {
  const out = { files: [], roster: undefined, json: undefined, text: undefined, allowInvalid: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--roster" || a === "--json" || a === "--text") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
      i += 1;
    } else if (a === "--allow-invalid") out.allowInvalid = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else out.files.push(a);
  }
  if (out.files.length === 0) throw new Error("no export files given");
  return out;
}

export function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`${e.message}\nusage: cli.mjs [--roster roster.csv] [--json out.json] [--text out.txt] [--allow-invalid] export.json...`);
    return 2;
  }
  let readout;
  try {
    const files = args.files.map((p) => ({ text: readFileSync(p, "utf8") }));
    const rosterText = args.roster === undefined ? undefined : readFileSync(args.roster, "utf8");
    readout = computeReadout({ files, rosterText });
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }
  const text = renderText(readout);
  if (args.json !== undefined) writeFileSync(args.json, `${JSON.stringify(readout, null, 2)}\n`);
  if (args.text !== undefined) writeFileSync(args.text, text);
  else process.stdout.write(text);
  if (readout.dataQuality.filesInvalid.length > 0 && !args.allowInvalid) {
    console.error(
      `error: ${readout.dataQuality.filesInvalid.length} file(s) rejected (see Data quality); rerun with --allow-invalid to accept the readout without them`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
