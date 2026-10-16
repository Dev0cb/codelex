// Dynamic app config on top of app.json (Expo passes app.json's `expo` object as `config`).
//
// Only for the preview-only Diagnostics build (DG1, docs/architecture/notes/diagnostics-screen.md OQ-DG-2, §13):
// when EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1, the build's commit goes into `extra.codelexDiagnostics.gitSha`, because the
// Diagnostics report (A2 `build.gitSha`) is compared with the Node report of the same commit. Every other build gets
// app.json unchanged. Fails closed:
// - SC-6: the constant is accepted only in a local export (EAS_BUILD_PROFILE unset) or in the `preview-diagnostics`
//   EAS profile, and that profile refuses to configure without it;
// - a diagnostics build is a separate app (`com.codelex.app.diagnostics`, "CODELEX Diagnostics"): no store listing
//   exists for that identifier, so it cannot be submitted, and it installs beside a normal build;
// - a commit that cannot be resolved does not configure; a local export from a dirty checkout gets `<sha>-dirty`,
//   which the screen does not accept as a commit, so no report can be shared from it (S-n2).
const { execFileSync } = require('node:child_process');

const GIT_SHA = /^[0-9a-f]{40}$/;
const DIAGNOSTICS_PROFILE = 'preview-diagnostics';
const DIAGNOSTICS_ID = 'com.codelex.app.diagnostics';
const DIAGNOSTICS_NAME = 'CODELEX Diagnostics';

const gitHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const gitStatus = () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });

/**
 * EAS sets EAS_BUILD_GIT_COMMIT_HASH on its workers; a local export reads the checkout and marks the commit
 * `-dirty` when `git status --porcelain` is not empty or cannot be read.
 */
function resolveGitSha(env = process.env, git = gitHead, status = gitStatus) {
  const fromEas = env.EAS_BUILD_GIT_COMMIT_HASH;
  const local = !(typeof fromEas === 'string' && fromEas !== '');
  let sha = local ? '' : fromEas;
  if (local) {
    try {
      sha = git();
    } catch {
      sha = '';
    }
  }
  sha = sha.trim().toLowerCase();
  if (!GIT_SHA.test(sha)) {
    throw new Error('preview-diagnostics build: the commit SHA cannot be resolved (DG1, OQ-DG-2)');
  }
  if (!local) return sha;
  let dirty = true;
  try {
    dirty = status().trim() !== '';
  } catch {
    dirty = true;
  }
  return dirty ? `${sha}-dirty` : sha;
}

function appConfig({ config }, env = process.env, git = undefined, status = undefined) {
  const enabled = env.EXPO_PUBLIC_CODELEX_DIAGNOSTICS === '1';
  const profile = env.EAS_BUILD_PROFILE;
  if (profile === DIAGNOSTICS_PROFILE && !enabled) {
    throw new Error(
      `${DIAGNOSTICS_PROFILE} build without EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1 (DG1, SC-6)`,
    );
  }
  if (!enabled) return config;
  if (profile !== undefined && profile !== DIAGNOSTICS_PROFILE) {
    throw new Error(
      `EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1 is only allowed in a local export or the ${DIAGNOSTICS_PROFILE} profile (DG1, SC-6)`,
    );
  }
  return {
    ...config,
    name: DIAGNOSTICS_NAME,
    ios: { ...config.ios, bundleIdentifier: DIAGNOSTICS_ID },
    android: { ...config.android, package: DIAGNOSTICS_ID },
    extra: {
      ...config.extra,
      codelexDiagnostics: { gitSha: resolveGitSha(env, git, status) },
    },
  };
}

module.exports = appConfig;
module.exports.resolveGitSha = resolveGitSha;
