// Jest stand-in for Metro's asset registry: importing a `.clxi` yields its absolute path, which the expo-asset
// stand-in (jest/expo-asset.cjs) returns as `localUri`. Tests then read the real generated asset from disk.
module.exports = {
  process(_source, filename) {
    return { code: `module.exports = ${JSON.stringify(filename)};` };
  },
};
