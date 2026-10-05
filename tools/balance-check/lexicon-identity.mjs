#!/usr/bin/env node
/**
 * Prints the lexicon identity of the checked-out tree as `key=value` lines, for the balance-check workflow
 * (docs/specs/E-1.6-balance/v2-balance-check.md §4.3 and §6): `lexicon_version` and `definition_hash` of the
 * `global-ranked` profile. The workflow passes them to the simulator and the readout (I-3 compares them), so
 * nobody types them by hand. Zero dependencies beyond the lexicon package scripts; reads files only.
 */
import {
  GLOBAL_PROFILE,
  profileDefinitionHash,
} from "../../packages/lexicon/scripts/canonical.mjs";
import { loadLexicon } from "../../packages/lexicon/scripts/validate.mjs";

const lexicon = loadLexicon();
console.log(`lexicon_version=${lexicon.version}`);
console.log(`definition_hash=${profileDefinitionHash(GLOBAL_PROFILE)}`);
