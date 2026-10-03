// Metro configuration (CommonJS: Metro loads it with require). Expo's defaults already handle the pnpm
// workspace (watch folders, symlinked packages).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The lexicon index ships as a bundled binary asset (docs/architecture/notes/mobile-app-foundation.md §3,
// lexicon-index note §3.5).
config.resolver.assetExts.push('clxi');

module.exports = config;
