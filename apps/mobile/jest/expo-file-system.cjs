// Node stand-in for expo-file-system's `File` under Jest: `bytes()` reads the file into a fresh Uint8Array.
const { readFileSync } = require('node:fs');

class File {
  constructor(uri) {
    this.uri = uri;
  }

  bytes() {
    return Promise.resolve(new Uint8Array(readFileSync(this.uri)));
  }
}

module.exports = { File };
