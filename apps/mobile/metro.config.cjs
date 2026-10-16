// Metro configuration (CommonJS: Metro loads it with require). Expo's defaults already handle the pnpm
// workspace (watch folders, symlinked packages).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The lexicon index ships as a bundled binary asset (docs/architecture/notes/mobile-app-foundation.md §3,
// lexicon-index note §3.5).
config.resolver.assetExts.push('clxi');

// The Diagnostics gate (DG1, docs/architecture/notes/diagnostics-screen.md §3) is folded at transform time from
// EXPO_PUBLIC_CODELEX_DIAGNOSTICS, which Metro's transform cache key does not include: without this, a production
// export could reuse a diagnostics transform (or the positive control a production one). Keying the cache on the
// value keeps the two exports apart.
config.cacheVersion = `${config.cacheVersion ?? ''}|diagnostics=${process.env.EXPO_PUBLIC_CODELEX_DIAGNOSTICS ?? ''}`;

module.exports = config;
