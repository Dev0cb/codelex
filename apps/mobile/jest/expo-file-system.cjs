// Node stand-in for expo-file-system's `File`, `Directory` and `Paths` under Jest, on the real file system:
// `bytes()` reads the bundled lexicon; the sync calls back the match persistence (src/persistence/device-fs.ts).
// `Paths.document` is a fresh temporary directory per test module, so test files never share saved matches.
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');

const pathOf = (parts) => join(...parts.map((p) => (typeof p === 'string' ? p : p.uri)));

class File {
  constructor(...parts) {
    this.uri = pathOf(parts);
  }

  get name() {
    return basename(this.uri);
  }

  get exists() {
    return existsSync(this.uri) && statSync(this.uri).isFile();
  }

  get size() {
    return statSync(this.uri).size;
  }

  bytes() {
    return Promise.resolve(new Uint8Array(readFileSync(this.uri)));
  }

  bytesSync() {
    return new Uint8Array(readFileSync(this.uri));
  }

  write(content, options = {}) {
    if (options.append) appendFileSync(this.uri, content);
    else writeFileSync(this.uri, content);
  }

  rename(newName) {
    const target = join(this.uri, '..', newName);
    if (existsSync(target)) throw new Error(`rename: ${newName} exists`);
    renameSync(this.uri, target);
    this.uri = target;
  }

  delete() {
    rmSync(this.uri);
  }
}

class Directory {
  constructor(...parts) {
    this.uri = pathOf(parts);
  }

  get exists() {
    return existsSync(this.uri) && statSync(this.uri).isDirectory();
  }

  create(options = {}) {
    if (options.idempotent && existsSync(this.uri)) return;
    mkdirSync(this.uri, { recursive: Boolean(options.intermediates) });
  }

  list() {
    return readdirSync(this.uri, { withFileTypes: true }).map((entry) =>
      entry.isDirectory() ? new Directory(this.uri, entry.name) : new File(this.uri, entry.name),
    );
  }
}

let documentDir;
const Paths = {
  get document() {
    documentDir ??= mkdtempSync(join(tmpdir(), 'codelex-jest-'));
    return new Directory(documentDir);
  },
};

module.exports = { Directory, File, Paths };
