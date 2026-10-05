// Jest resolver: react-native-worklets must resolve its JS (non-`.native`) sources under Jest, so Reanimated and
// worklets run on the JS thread (what `react-native-worklets/jest/resolver.js` does). That upstream resolver matches
// "react-native-worklets" anywhere in the base directory, which under pnpm also matches every package whose
// virtual-store folder name carries worklets as a peer (e.g. `expo-modules-core@57_react-native-worklets@0.10.1_…`)
// and breaks their native resolution. This one only matches the worklets package itself.
const WORKLETS_DIR = /[\\/]node_modules[\\/]react-native-worklets[\\/]/;

/** @type {import('jest-resolve').SyncResolver} */
module.exports = (request, options) => {
  const isWorklets =
    request === 'react-native-worklets' ||
    request.startsWith('react-native-worklets/') ||
    WORKLETS_DIR.test(`${options.basedir}/`);
  if (!isWorklets) return options.defaultResolver(request, options);
  return options.defaultResolver(request, {
    ...options,
    extensions: options.extensions?.filter((ext) => !ext.includes('native')),
  });
};
