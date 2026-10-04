// Metro resolves binary assets to a numeric module id (metro.config.cjs adds `clxi` to `assetExts`).
declare module '*.clxi' {
  const assetModule: number;
  export = assetModule;
}
