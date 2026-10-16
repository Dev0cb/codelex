// Dynamic app config on top of app.json (Expo passes app.json's `expo` object as `config`).
//
// Only for the preview-only Diagnostics build (DG1, docs/architecture/notes/diagnostics-screen.md OQ-DG-2): when
// EXPO_PUBLIC_CODELEX_DIAGNOSTICS=1 (EAS profile `preview-diagnostics` only), the build's commit goes into
// `extra.codelexDiagnostics.gitSha`, because the Diagnostics report (A2 `build.gitSha`) is compared with the Node
// report of the same commit. Every other build gets app.json unchanged. Fails closed: a diagnostics build whose
// commit cannot be resolved does not configure.
const { execFileSync } = require('node:child_process');

const GIT_SHA = /^[0-9a-f]{40}$/;

/** EAS sets EAS_BUILD_GIT_COMMIT_HASH on its workers; a local export reads the checkout. */
function resolveGitSha(
  env = process.env,
  git = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }),
) {
  const fromEas = env.EAS_BUILD_GIT_COMMIT_HASH;
  let sha = typeof fromEas === 'string' && fromEas !== '' ? fromEas : '';
  if (sha === '') {
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
  return sha;
}

function appConfig({ config }, env = process.env, git = undefined) {
  if (env.EXPO_PUBLIC_CODELEX_DIAGNOSTICS !== '1') return config;
  return {
    ...config,
    extra: { ...config.extra, codelexDiagnostics: { gitSha: resolveGitSha(env, git) } },
  };
}

module.exports = appConfig;
module.exports.resolveGitSha = resolveGitSha;
