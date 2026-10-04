// Node stand-in for expo-asset under Jest (no native module): a module that is a file path (see
// jest/clxi-transformer.cjs) resolves to that path; anything else has no local file, like an unresolvable asset.
module.exports = {
  Asset: {
    fromModule(assetModule) {
      const asset = { localUri: typeof assetModule === 'string' ? assetModule : null };
      return { downloadAsync: () => Promise.resolve(asset) };
    },
  },
};
