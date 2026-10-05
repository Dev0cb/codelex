// Node stand-in for expo-crypto's `digest` and `getRandomBytes` under Jest (node:crypto instead of the native module).
const { createHash, randomBytes } = require('node:crypto');

const CryptoDigestAlgorithm = { SHA256: 'SHA-256' };

function digest(algorithm, data) {
  if (algorithm !== CryptoDigestAlgorithm.SHA256) {
    return Promise.reject(new Error(`unsupported digest ${algorithm}`));
  }
  const view = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
  return Promise.resolve(new Uint8Array(createHash('sha256').update(view).digest()).buffer);
}

function getRandomBytes(byteCount) {
  return new Uint8Array(randomBytes(byteCount));
}

module.exports = { CryptoDigestAlgorithm, digest, getRandomBytes };
