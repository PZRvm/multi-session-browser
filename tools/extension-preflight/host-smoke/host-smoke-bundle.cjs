var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../../src/main/extensions/dev-entry.ts
var dev_entry_exports = {};
__export(dev_entry_exports, {
  createCaptureOperations: () => createCaptureOperations,
  createInstallService: () => createInstallService,
  createManifestStore: () => createManifestStore,
  createStoreInstall: () => createStoreInstall,
  extensionId: () => extensionId,
  extensionsPaths: () => extensionsPaths,
  extractCrx: () => extractCrx,
  getExtensionsHandle: () => getExtensionsHandle,
  mountDevExtensions: () => mountDevExtensions,
  registerBridgeTarget: () => registerBridgeTarget
});
module.exports = __toCommonJS(dev_entry_exports);
var import_node_path7 = require("node:path");
var import_node_crypto4 = require("node:crypto");
var import_electron3 = require("electron");

// ../../../src/main/extensions/install/manifest-store.ts
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var EMPTY_MANIFEST = { version: 1, generation: 1, installs: [] };
function demand(value, reason) {
  if (!value) throw new Error(`INVALID_MANIFEST: ${reason}`);
}
function classifyInstall(results) {
  if (!Array.isArray(results) || results.length === 0) return "not-loaded";
  const ok = results.filter((v) => v.ok === true).length;
  return ok === results.length ? "ready" : ok === 0 ? "failed" : "partial";
}
function validateInstallRecord(record) {
  demand(record && typeof record === "object", "\u5B89\u88C5\u8BB0\u5F55\u975E\u5BF9\u8C61");
  const r = record;
  demand(typeof r.id === "string" && /^[a-p]{32}$/.test(r.id), "\u6269\u5C55ID\u975E\u6CD5");
  demand(typeof r.version === "string" && /^\d+(\.\d+){0,3}$/.test(r.version), "\u7248\u672C\u975E\u6CD5");
  demand(typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256), "\u6458\u8981\u975E\u6CD5");
  const src = r.source ?? {};
  demand(
    typeof src.kind === "string" && ["crx", "store", "unpacked"].includes(src.kind),
    "\u6765\u6E90\u975E\u6CD5"
  );
  demand(Number.isSafeInteger(r.generation) && r.generation > 0, "\u4EE3\u6B21\u975E\u6CD5");
  demand(Array.isArray(r.partitions) && r.partitions.length <= 1024, "\u5206\u533A\u7ED3\u679C\u975E\u6CD5");
  const seen = /* @__PURE__ */ new Set();
  const partitions = [];
  for (const row of r.partitions) {
    demand(row && typeof row === "object", "\u5206\u533A\u7ED3\u679C\u975E\u5BF9\u8C61");
    const p = row;
    demand(
      typeof p.partition === "string" && p.partition.length > 0 && p.partition.length <= 256,
      "\u5206\u533A\u540D\u975E\u6CD5"
    );
    demand(!seen.has(p.partition), "\u5206\u533A\u7ED3\u679C\u91CD\u590D");
    seen.add(p.partition);
    demand(typeof p.ok === "boolean", "\u5206\u533Aok\u975E\u6CD5");
    demand(p.generation === r.generation, "\u5206\u533A\u4EE3\u6B21\u4E0D\u4E00\u81F4");
    partitions.push({
      partition: p.partition,
      ok: p.ok,
      generation: p.generation
    });
  }
  return {
    id: r.id,
    version: r.version,
    sha256: r.sha256,
    source: {
      kind: src.kind,
      ...typeof src.origin === "string" ? { origin: src.origin } : {}
    },
    generation: r.generation,
    partitions
  };
}
function validateManifest(value) {
  demand(value && typeof value === "object", "\u6E05\u5355\u975E\u5BF9\u8C61");
  const m = value;
  demand(m.version === 1, "\u6E05\u5355\u7248\u672C\u975E\u6CD5");
  demand(Number.isSafeInteger(m.generation) && m.generation > 0, "\u6E05\u5355\u4EE3\u6B21\u975E\u6CD5");
  demand(Array.isArray(m.installs), "\u6E05\u5355\u5B89\u88C5\u5217\u8868\u975E\u6CD5");
  const ids = /* @__PURE__ */ new Set();
  const installs = m.installs.map((v) => {
    const record = validateInstallRecord(v);
    demand(!ids.has(record.id), `\u5B89\u88C5\u8BB0\u5F55\u91CD\u590D\uFF1A${record.id}`);
    ids.add(record.id);
    return record;
  });
  return { version: 1, generation: m.generation, installs };
}
async function readRaw(file) {
  let text;
  try {
    text = await (0, import_promises.readFile)(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      return { ...EMPTY_MANIFEST, installs: [] };
    throw error;
  }
  try {
    return validateManifest(JSON.parse(text));
  } catch (error) {
    throw new Error(`\u63D2\u4EF6\u6E05\u5355\u635F\u574F\uFF0C\u62D2\u7EDD\u52A0\u8F7D\uFF1A${file}\uFF08${String(error)}\uFF09`);
  }
}
async function persistAtomic(file, manifest) {
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(file), { recursive: true });
  const tmp = (0, import_node_path.join)((0, import_node_path.dirname)(file), `.installed-${Date.now()}.json`);
  await (0, import_promises.writeFile)(tmp, JSON.stringify(manifest, null, 2));
  await (0, import_promises.rename)(tmp, file);
}
function createManifestStore(file) {
  let chain = Promise.resolve();
  function locked(job) {
    const run = chain.then(job, job);
    chain = run.catch(() => void 0);
    return run;
  }
  return {
    read: () => locked(() => readRaw(file)),
    update: (mutate) => locked(async () => {
      const next = await mutate(await readRaw(file));
      validateManifest(next);
      await persistAtomic(file, next);
      return next;
    }),
    get: (id) => locked(() => readRaw(file)).then((m) => m.installs.find((v) => v.id === id)),
    upsertInstall: (input) => locked(async () => {
      const current = await readRaw(file);
      const generation = current.generation + 1;
      const record = {
        id: input.id,
        version: input.version,
        sha256: input.sha256,
        source: input.source,
        generation,
        partitions: input.partitions.map((v) => ({ ...v, generation }))
      };
      validateInstallRecord(record);
      const installs = current.installs.filter((v) => v.id !== record.id);
      const next = {
        version: 1,
        generation,
        installs: [...installs, record]
      };
      await persistAtomic(file, next);
      return record;
    }),
    recordPartition: (id, partition, ok) => locked(async () => {
      const current = await readRaw(file);
      let updated;
      const installs = current.installs.map((v) => {
        if (v.id !== id) return v;
        const others = v.partitions.filter((p) => p.partition !== partition);
        updated = {
          ...v,
          partitions: [...others, { partition, ok, generation: v.generation }]
        };
        return updated;
      });
      if (!updated) return void 0;
      const next = { ...current, installs };
      validateManifest(next);
      await persistAtomic(file, next);
      return updated;
    }),
    removeInstall: (id) => locked(async () => {
      const current = await readRaw(file);
      if (!current.installs.some((v) => v.id === id)) return false;
      const next = {
        ...current,
        installs: current.installs.filter((v) => v.id !== id)
      };
      validateManifest(next);
      await persistAtomic(file, next);
      return true;
    })
  };
}

// ../../../src/shared/extensions/protocol.ts
var PROTOCOL_VERSION = 1;
var MAX_REQUEST_BYTES = 4096;
var MAX_ENTRIES_PER_TARGET = 128;
var DEFAULT_TIMEOUT_MS = 5e3;
var MAX_IMAGE_BYTES = 32 * 1024 * 1024;
var MAX_PIXELS = 64 * 1024 * 1024;
var MAX_STAGED_BYTES = 64 * 1024 * 1024;
var METHODS = /* @__PURE__ */ new Set([
  "handshake",
  "capture",
  "image.copy",
  "image.save",
  "recording.start",
  "recording.pause",
  "recording.resume",
  "recording.stop",
  "recording.status",
  "install.status"
]);
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function checkRequest(request, context) {
  const r = request;
  if (!context.trusted || !context.topFrame || !context.sameSession) fail("UNAUTHORIZED");
  if (!r || typeof r !== "object" || r.protocol !== PROTOCOL_VERSION) fail("PROTOCOL_UNSUPPORTED");
  if (typeof r.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.requestId))
    fail("INVALID_REQUEST");
  if (!METHODS.has(r.method)) fail("CAPABILITY_UNSUPPORTED");
  if (!context.target?.alive || r.target !== context.target.token) fail("TARGET_GONE");
}
var ERROR_CODES = [
  "UNAUTHORIZED",
  "PROTOCOL_UNSUPPORTED",
  "INVALID_REQUEST",
  "CAPABILITY_UNSUPPORTED",
  "TARGET_GONE",
  "SNAPSHOT_STALE",
  "BUSY",
  "INVALID_STATE",
  "TIMEOUT",
  "CANCELLED"
];
function errorReply(request, error) {
  const r = request;
  const valid = typeof r?.requestId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(r.requestId);
  const code = ERROR_CODES.includes(error) ? error : error?.code && ERROR_CODES.includes(error.code) ? error.code : "INTERNAL";
  return {
    protocol: PROTOCOL_VERSION,
    requestId: valid ? r.requestId : null,
    ok: false,
    error: { code }
  };
}
function createEndpoint(context, operations, options) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxEntries = options?.maxEntries ?? MAX_ENTRIES_PER_TARGET;
  const requests = /* @__PURE__ */ new Map();
  let closed = false;
  function request(payload) {
    try {
      if (closed) throw Object.assign(new Error("TARGET_GONE"), { code: "TARGET_GONE" });
      checkRequest(payload, context());
      const fingerprint = JSON.stringify(payload);
      if (Buffer.byteLength(fingerprint) > MAX_REQUEST_BYTES) fail("INVALID_REQUEST");
      const prior = requests.get(payload.requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail("INVALID_REQUEST");
        return prior.promise;
      }
      if (requests.size >= maxEntries) fail("BUSY");
      const operation = operations[payload.method];
      if (!operation) fail("CAPABILITY_UNSUPPORTED");
      const controller = new AbortController();
      let settled = false;
      let timer;
      let finish = () => void 0;
      const reject = (code) => {
        if (settled) return;
        controller.abort();
        finish(errorReply(payload, { code }));
      };
      const promise = new Promise((resolve) => {
        finish = (value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(value);
        };
        timer = setTimeout(() => reject("TIMEOUT"), timeoutMs);
        void Promise.resolve().then(
          () => controller.signal.aborted ? void 0 : operation(payload, controller.signal)
        ).then(
          (value) => {
            if (settled) return;
            try {
              checkRequest(payload, context());
              finish({
                protocol: 1,
                requestId: payload.requestId,
                ok: true,
                value
              });
            } catch (error) {
              finish(errorReply(payload, error));
            }
          },
          (error) => finish(errorReply(payload, error))
        );
      });
      requests.set(payload.requestId, { fingerprint, promise, reject });
      return promise;
    } catch (error) {
      return Promise.resolve(errorReply(payload, error));
    }
  }
  return {
    request,
    cancel: (id) => requests.get(id)?.reject("CANCELLED"),
    close: () => {
      closed = true;
      for (const entry of requests.values()) entry.reject("TARGET_GONE");
      requests.clear();
    }
  };
}
var STAGED_IMAGE = Symbol("msb.stagedImage");

// ../../../src/main/extensions/runtime/index.ts
var import_node_path3 = require("node:path");
var import_electron_chrome_extensions = require("electron-chrome-extensions");

// ../../../src/main/extensions/runtime/loader.ts
async function loadInstallsIntoSession(session, installs, partition, deps) {
  const loadedIds = new Set(session.getAllExtensions().map((v) => v.id));
  const results = [];
  await Promise.all(
    installs.map(async (record) => {
      try {
        if (loadedIds.has(record.id)) {
          results.push({ id: record.id, path: "", ok: true, detail: "already-loaded" });
          await deps.recordPartition?.(record.id, partition, true);
          return;
        }
        const path = deps.resolvePath(record);
        const ext = await session.loadExtension(path);
        results.push({ id: ext.id, path, ok: true, detail: "loaded" });
        await deps.recordPartition?.(ext.id, partition, true);
      } catch (error) {
        results.push({
          id: record.id,
          path: "",
          ok: false,
          detail: "error",
          message: String(error).slice(0, 120)
        });
        await deps.recordPartition?.(record.id, partition, false);
      }
    })
  );
  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

// ../../../src/main/extensions/runtime/preload-guard.ts
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var import_electron = require("electron");
var LIB_PRELOAD_RELATIVE = (0, import_node_path2.join)(
  "node_modules",
  "electron-chrome-extensions",
  "dist",
  "chrome-extension-api.preload.js"
);
var GUARDED_ID = "msb-extension-bridge-guarded";
var swapped = /* @__PURE__ */ new WeakSet();
function ensureGuardedPreload(session) {
  if (swapped.has(session)) return;
  swapped.add(session);
  const libPreload = (0, import_node_path2.join)(import_electron.app.getAppPath(), LIB_PRELOAD_RELATIVE);
  for (const script of session.getPreloadScripts().filter((s) => s.filePath === libPreload)) {
    session.unregisterPreloadScript(script.id);
  }
  const guarded = (0, import_node_path2.join)(
    import_electron.app.getPath("userData"),
    "extensions",
    "runtime",
    "chrome-extension-api.preload.js"
  );
  void generate(guarded, libPreload).then(() => session.registerPreloadScript({ id: GUARDED_ID, type: "frame", filePath: guarded })).catch((error) => console.warn("[extensions.runtime] preload\u5B88\u536B\u526F\u672C\u751F\u6210\u5931\u8D25", error));
}
async function generate(guarded, libPreload) {
  await (0, import_promises2.mkdir)((0, import_node_path2.dirname)(guarded), { recursive: true });
  let content = "";
  try {
    content = await (0, import_promises2.readFile)(libPreload, "utf8");
  } catch {
    content = "";
  }
  const guard = `if (process.type === 'service-worker' || process.isMainFrame) {`;
  await (0, import_promises2.writeFile)(guarded, `${guard}
${content}
}`);
}

// ../../../src/main/extensions/runtime/index.ts
function createExtensionRuntime(deps) {
  const engines = /* @__PURE__ */ new Map();
  return {
    async mountPartition(partition, session) {
      if (!engines.has(partition)) {
        const options = { session, ...deps.engineOptions };
        engines.set(partition, new import_electron_chrome_extensions.ElectronChromeExtensions(options));
        ensureGuardedPreload(session);
      }
      const bridge = session.extensions;
      const adapter = {
        getAllExtensions: () => session.getAllExtensions(),
        loadExtension: (path) => bridge ? bridge.loadExtension(path) : session.loadExtension(path)
      };
      const installs = (await deps.manifest.read()).installs;
      const results = await loadInstallsIntoSession(adapter, installs, partition, {
        resolvePath: (record) => record.source.kind === "unpacked" ? record.source.origin ?? "" : (0, import_node_path3.join)(deps.packagesRoot, `${record.id}-${record.version}`),
        recordPartition: (id, p, ok) => deps.manifest.recordPartition(id, p, ok)
      });
      const records = (await deps.manifest.read()).installs;
      const thisPartition = records.map((r) => r.partitions.find((p) => p.partition === partition)).filter((v) => v !== void 0);
      const state = classifyInstall(thisPartition);
      return { partition, results, state };
    },
    getEngine: (partition) => engines.get(partition)
  };
}

// ../../../src/main/extensions/install/crx.ts
var import_node_crypto = require("node:crypto");
var import_promises3 = require("node:fs/promises");
var import_node_path4 = require("node:path");
var import_node_crypto2 = require("node:crypto");
var import_adm_zip = __toESM(require("adm-zip"));
var MAX_PACKAGE = 32 * 1024 * 1024;
var MAX_EXPANDED = 64 * 1024 * 1024;
function demand2(value, reason) {
  if (!value) throw new Error(reason);
}
function extensionId(publicKey) {
  return (0, import_node_crypto.createHash)("sha256").update(publicKey).digest("hex").slice(0, 32).replace(/[0-9a-f]/g, (v) => String.fromCharCode(97 + parseInt(v, 16)));
}
function fields(data) {
  let cursor = 0;
  const result = [];
  function varint() {
    let value = 0;
    for (let i = 0; i < 10; i++) {
      demand2(cursor < data.length, "\u622A\u65AD protobuf");
      const byte = data[cursor++];
      value += (byte & 127) * 2 ** (7 * i);
      demand2(Number.isSafeInteger(value), "protobuf \u6574\u6570\u6EA2\u51FA");
      if (!(byte & 128)) return value;
    }
    throw new Error("protobuf varint \u8FC7\u957F");
  }
  while (cursor < data.length) {
    const tag = varint(), wire = tag % 8, field = Math.floor(tag / 8);
    demand2(field > 0, "protobuf \u5B57\u6BB5\u975E\u6CD5");
    if (wire === 0) {
      varint();
      continue;
    }
    const length = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
    demand2(length >= 0 && cursor + length <= data.length, "protobuf \u957F\u5EA6\u975E\u6CD5");
    result.push({ field, data: data.subarray(cursor, cursor + length) });
    cursor += length;
  }
  return result;
}
function keyFromDer(der) {
  return (0, import_node_crypto.createPublicKey)({ key: der, format: "der", type: "spki" });
}
function inspectCrx(buffer, expectedId) {
  demand2(
    Buffer.isBuffer(buffer) && buffer.length >= 16 && buffer.length <= MAX_PACKAGE,
    "CRX \u5927\u5C0F\u975E\u6CD5"
  );
  demand2(buffer.subarray(0, 4).toString() === "Cr24", "CRX \u9B54\u6570\u975E\u6CD5");
  const version = buffer.readUInt32LE(4);
  let publicKey;
  let archive;
  let signedPayload;
  let proofs;
  if (version === 2) {
    const keySize = buffer.readUInt32LE(8), sigSize = buffer.readUInt32LE(12);
    const offset = 16 + keySize + sigSize;
    demand2(keySize > 0 && sigSize > 0 && offset < buffer.length, "CRX2 \u957F\u5EA6\u975E\u6CD5");
    publicKey = buffer.subarray(16, 16 + keySize);
    archive = buffer.subarray(offset);
    demand2(
      (0, import_node_crypto.verify)("sha1", archive, keyFromDer(publicKey), buffer.subarray(16 + keySize, offset)),
      "CRX2 \u7B7E\u540D\u65E0\u6548"
    );
  } else if (version === 3) {
    const size = buffer.readUInt32LE(8);
    demand2(size > 0 && size < 1024 * 1024 && 12 + size < buffer.length, "CRX3 \u957F\u5EA6\u975E\u6CD5");
    const header = fields(buffer.subarray(12, 12 + size));
    const signed = header.filter((v) => v.field === 1e4);
    demand2(signed.length === 1, "CRX3 signed_header_data \u975E\u6CD5");
    const ids = fields(signed[0].data).filter((v) => v.field === 1);
    demand2(ids.length === 1 && ids[0].data.length === 16, "CRX3 ID \u975E\u6CD5");
    const declared = [...ids[0].data].map((v) => String.fromCharCode(97 + (v >> 4), 97 + (v & 15))).join("");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(signed[0].data.length);
    archive = buffer.subarray(12 + size);
    signedPayload = Buffer.concat([
      Buffer.from("CRX3 SignedData\0"),
      length,
      signed[0].data,
      archive
    ]);
    proofs = header.filter((v) => v.field === 2 || v.field === 3);
    for (const proof of proofs) {
      const parts = fields(proof.data);
      const keys = parts.filter((v) => v.field === 1), signatures = parts.filter((v) => v.field === 2);
      if (keys.length !== 1 || signatures.length !== 1) continue;
      const key = keys[0].data;
      if (extensionId(key) !== declared) continue;
      if ((0, import_node_crypto.verify)("sha256", signedPayload, keyFromDer(key), signatures[0].data)) {
        publicKey = key;
        break;
      }
    }
    demand2(publicKey, "CRX3 \u53D1\u5E03\u8005\u7B7E\u540D\u65E0\u6548");
  } else throw new Error("\u4E0D\u652F\u6301\u7684 CRX \u683C\u5F0F");
  const id = extensionId(publicKey);
  demand2(!expectedId || expectedId === id, "\u6269\u5C55 ID \u4E0D\u5339\u914D");
  const zip = new import_adm_zip.default(archive), entries = zip.getEntries();
  demand2(entries.length > 0 && entries.length <= 1e4, "ZIP \u6761\u76EE\u6570\u975E\u6CD5");
  let expanded = 0;
  const paths = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const name = entry.entryName;
    demand2(
      !name.includes("\\") && !(0, import_node_path4.isAbsolute)(name) && !/^[A-Za-z]:/.test(name) && !name.split("/").includes("..") && !name.includes("\0"),
      "ZIP \u8DEF\u5F84\u9003\u9038"
    );
    const normalized = import_node_path4.posix.normalize(name).replace(/\/$/, "").normalize("NFC").toLowerCase();
    demand2(normalized !== "." && !paths.has(normalized), "ZIP \u91CD\u590D\u8DEF\u5F84");
    paths.add(normalized);
    demand2((entry.header.attr >>> 16 & 61440) !== 40960, "ZIP \u7B26\u53F7\u94FE\u63A5\u62D2\u7EDD");
    expanded += entry.header.size;
    demand2(expanded <= MAX_EXPANDED, "ZIP \u5C55\u5F00\u8FC7\u5927");
  }
  const manifestEntry = zip.getEntry("manifest.json");
  demand2(manifestEntry, "\u7F3A\u5C11 manifest");
  demand2(manifestEntry.header.size <= 2 * 1024 * 1024, "\u8FC7\u5927\u7684 manifest");
  const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
  demand2([2, 3].includes(manifest.manifest_version), "manifest \u7248\u672C\u4E0D\u652F\u6301");
  demand2(
    typeof manifest.name === "string" && typeof manifest.version === "string" && /^\d+(\.\d+){0,3}$/.test(manifest.version),
    "manifest \u4FE1\u606F\u975E\u6CD5"
  );
  return {
    version,
    id,
    publicKey,
    manifest,
    zip,
    sha256: (0, import_node_crypto.createHash)("sha256").update(buffer).digest("hex")
  };
}
async function extractCrx(buffer, root, expectedId) {
  const inspected = inspectCrx(buffer, expectedId);
  const destination = (0, import_node_path4.join)(root, `${inspected.id}-${inspected.manifest.version}`);
  try {
    const existing = JSON.parse(await (0, import_promises3.readFile)((0, import_node_path4.join)(destination, ".package.json"), "utf8"));
    demand2(existing.sha256 === inspected.sha256, "\u540C\u7248\u672C\u5305\u5185\u5BB9\u51B2\u7A81");
    return { ...existing, path: destination, duplicate: true };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const staging = (0, import_node_path4.join)(root, `.staging-${(0, import_node_crypto2.randomUUID)()}`);
  await (0, import_promises3.mkdir)(staging, { recursive: true });
  try {
    for (const entry of inspected.zip.getEntries()) {
      const target = (0, import_node_path4.join)(staging, entry.entryName);
      if (entry.isDirectory) await (0, import_promises3.mkdir)(target, { recursive: true });
      else {
        await (0, import_promises3.mkdir)((0, import_node_path4.join)(target, ".."), { recursive: true });
        await (0, import_promises3.writeFile)(target, entry.getData(), { flag: "wx" });
      }
    }
    const manifest = { ...inspected.manifest, key: inspected.publicKey.toString("base64") };
    await (0, import_promises3.writeFile)((0, import_node_path4.join)(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
    const info = {
      id: inspected.id,
      version: manifest.version,
      crxVersion: inspected.version,
      sha256: inspected.sha256
    };
    await (0, import_promises3.writeFile)((0, import_node_path4.join)(staging, ".package.json"), JSON.stringify(info, null, 2));
    await (0, import_promises3.rename)(staging, destination);
    return { ...info, path: destination, duplicate: false };
  } catch (error) {
    await (0, import_promises3.rm)(staging, { recursive: true, force: true });
    throw error;
  }
}

// ../../../src/main/extensions/install/service.ts
var import_node_path5 = require("node:path");
var import_promises4 = require("node:fs/promises");
function createInstallService(deps) {
  const root = deps.packagesRoot;
  const installFromBuffer = async (buffer, expectedId) => {
    const extracted = await extractCrx(buffer, root, expectedId);
    const record = await deps.manifest.upsertInstall({
      id: extracted.id,
      version: extracted.version,
      sha256: extracted.sha256,
      source: { kind: "crx", origin: "package" },
      partitions: []
    });
    return { record, extracted, duplicate: extracted.duplicate };
  };
  const removeDir = async (path) => {
    await (0, import_promises4.rm)(path, { recursive: true, force: true });
  };
  const service = {
    installFromBuffer,
    installFromFile: (path, expectedId) => (0, import_promises4.readFile)(path).then((b) => installFromBuffer(b, expectedId)),
    uninstall: async (id) => {
      const record = await deps.manifest.get(id);
      if (!record) return false;
      const removed = await deps.manifest.removeInstall(id);
      if (!removed) return false;
      await deps.onRemove?.(id);
      await removeDir((0, import_node_path5.join)(root, `${id}-${record.version}`));
      return true;
    },
    upgrade: async (id, buffer) => {
      const prior = await deps.manifest.get(id);
      if (!prior) throw new Error("UPGRADE_TARGET_MISSING: " + id);
      const outcome = await installFromBuffer(buffer, id);
      if (outcome.record.version === prior.version && outcome.record.sha256 === prior.sha256)
        return outcome;
      await removeDir((0, import_node_path5.join)(root, `${id}-${prior.version}`));
      return outcome;
    }
  };
  return service;
}

// ../../../src/main/extensions/install/store.ts
var import_promises5 = require("node:fs/promises");
var import_node_path6 = require("node:path");
var STORE_ORIGIN = "https://chromewebstore.google.com";
function crxUrl(id) {
  const url = new URL("https://clients2.google.com/service/update2/crx");
  url.searchParams.append("response", "redirect");
  url.searchParams.append("acceptformat", "crx2,crx3");
  const x = new URLSearchParams({ id, uc: "" });
  url.searchParams.append("x", x.toString());
  url.searchParams.append("prodversion", process.versions.chrome ?? "120");
  return url.toString();
}
function createStoreInstall(deps) {
  const installFromStore = async (id) => {
    if (!deps.allowlist.includes(id)) throw new Error("STORE_ID_NOT_ALLOWED: " + id);
    const approved = await deps.confirmInstall({ id, name: id, version: "store" }).catch(() => false);
    if (!approved) throw new Error("STORE_CONFIRM_DENIED");
    const response = await fetch(crxUrl(id), { redirect: "follow" });
    if (!response.ok) throw new Error("STORE_DOWNLOAD_HTTP_" + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 16) throw new Error("STORE_DOWNLOAD_EMPTY");
    const extracted = await extractCrx(bytes, deps.packagesRoot, id);
    await deps.manifest.upsertInstall({
      id: extracted.id,
      version: extracted.version,
      sha256: extracted.sha256,
      source: { kind: "store", origin: STORE_ORIGIN },
      partitions: []
    });
    const stale = (0, import_node_path6.join)(deps.downloadDir, id);
    await (0, import_promises5.rm)(stale, { recursive: true, force: true });
    return {
      id: extracted.id,
      version: extracted.version,
      sha256: extracted.sha256,
      duplicate: extracted.duplicate
    };
  };
  return { installFromStore };
}

// ../../../src/main/extensions/bridge.ts
var import_node_crypto3 = require("node:crypto");
var import_electron2 = require("electron");
function checkImagePayload(meta, bytes) {
  const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const valid = !!meta && meta.mimeType === "image/png" && bytes.length >= 24 && bytes.length <= MAX_IMAGE_BYTES && bytes.subarray(0, 8).equals(pngMagic) && bytes.toString("latin1", 12, 16) === "IHDR" && meta.width === bytes.readUInt32BE(16) && meta.height === bytes.readUInt32BE(20) && /^[a-f0-9]{64}$/.test(meta.sha256) && (0, import_node_crypto3.createHash)("sha256").update(bytes).digest("hex") === meta.sha256;
  if (!valid) throw Object.assign(new Error("INVALID_REQUEST"), { code: "INVALID_REQUEST" });
  return { width: meta.width, height: meta.height };
}
var targets = /* @__PURE__ */ new Map();
var handlerAttached = false;
function contextForEvent(event, entry, requestedToken) {
  const sender = event.sender;
  const frame = event.senderFrame;
  const owner = entry ?? [...targets.values()].find((t) => t.wc === sender && !t.wc.isDestroyed());
  return {
    trusted: !!(owner && !sender.isDestroyed() && sender === owner.wc),
    topFrame: !!(frame && frame === frame.top),
    sameSession: !!(owner && sender.session === owner.session),
    target: entry ? { token: entry.token, alive: entry.alive } : owner ? { token: requestedToken ?? "unknown", alive: false } : void 0
  };
}
function attachHandler() {
  if (handlerAttached) return;
  handlerAttached = true;
  import_electron2.ipcMain.handle(
    "msb:extension-bridge",
    (event, payload, binary) => {
      const token = payload?.target;
      const entry = token ? targets.get(token) : void 0;
      try {
        checkRequest(payload, contextForEvent(event, entry, token));
      } catch (error) {
        return Promise.resolve(errorReply(payload, error));
      }
      if (!entry) return Promise.resolve(errorReply(payload, { code: "UNAUTHORIZED" }));
      const request = payload;
      let staged = false;
      if (binary !== void 0) {
        if (!(binary instanceof ArrayBuffer) || request.method !== "image.copy") {
          return Promise.resolve(errorReply(payload, { code: "INVALID_REQUEST" }));
        }
        try {
          const bytes = Buffer.from(binary);
          checkImagePayload(request.image, bytes);
          if (!entry.staged.has(request.requestId) && entry.stagedBytes + bytes.length > MAX_STAGED_BYTES) {
            return Promise.resolve(errorReply(payload, { code: "BUSY" }));
          }
          entry.staged.set(request.requestId, bytes);
          entry.stagedBytes += bytes.length;
          staged = true;
        } catch (error) {
          return Promise.resolve(errorReply(payload, error));
        }
      }
      Object.defineProperty(request, STAGED_IMAGE, {
        value: staged ? entry.staged.get(request.requestId) : void 0,
        enumerable: false
      });
      return entry.endpoint.request(payload).finally(() => {
        if (staged) {
          const bytes = entry.staged.get(request.requestId);
          if (bytes) {
            entry.stagedBytes -= bytes.length;
            entry.staged.delete(request.requestId);
          }
        }
      });
    }
  );
}
function registerBridgeTarget(wc, session, operations) {
  const token = (0, import_node_crypto3.randomUUID)();
  const entry = {
    token,
    alive: true,
    wc,
    session,
    endpoint: createEndpoint(
      () => ({
        trusted: true,
        topFrame: true,
        sameSession: true,
        target: { token, alive: entry.alive }
      }),
      operations
    ),
    staged: /* @__PURE__ */ new Map(),
    stagedBytes: 0,
    onNavigated: () => {
      entry.alive = false;
    }
  };
  wc.on("did-navigate", entry.onNavigated);
  targets.set(token, entry);
  attachHandler();
  return {
    token,
    setAlive: (alive) => {
      entry.alive = alive;
    },
    release: () => {
      entry.alive = false;
      wc.off("did-navigate", entry.onNavigated);
      targets.delete(token);
    }
  };
}

// ../../../src/main/extensions/dev-entry.ts
function extensionsPaths() {
  const root = (0, import_node_path7.join)(import_electron3.app.getPath("userData"), "extensions");
  return {
    root,
    manifestFile: (0, import_node_path7.join)(root, "installed.json"),
    packagesRoot: (0, import_node_path7.join)(root, "packages")
  };
}
var handle;
function getExtensionsHandle(engineOptions) {
  if (!handle) {
    const paths = extensionsPaths();
    handle = {
      runtime: createExtensionRuntime({
        manifest: createManifestStore(paths.manifestFile),
        packagesRoot: paths.packagesRoot,
        engineOptions
      }),
      paths,
      mounted: /* @__PURE__ */ new Map()
    };
  }
  return handle;
}
async function mountDevExtensions(session, partition) {
  const h = getExtensionsHandle();
  try {
    const result = await h.runtime.mountPartition(partition, session);
    h.mounted.set(partition, "ok");
    return result;
  } catch (error) {
    h.mounted.set(partition, "error");
    return { partition, error: String(error).slice(0, 200) };
  }
}
function createCaptureOperations(getWc) {
  let version = 0;
  let snapshot;
  return {
    handshake: () => ({
      protocol: 1,
      capabilities: { capture: true, imageCopy: true, tabAudio: false, subscription: false },
      limits: {
        requestBytes: 4096,
        entries: 128,
        imageBytes: 32 * 1024 * 1024,
        imageInFlightBytes: 64 * 1024 * 1024
      },
      scope: "msb production bridge"
    }),
    capture: async () => {
      const wc = getWc();
      if (!wc || wc.isDestroyed())
        throw Object.assign(new Error("TARGET_GONE"), { code: "TARGET_GONE" });
      const image = await wc.capturePage();
      if (image.isEmpty()) throw Object.assign(new Error("TARGET_GONE"), { code: "TARGET_GONE" });
      version += 1;
      snapshot = { id: "msb-snapshot", version, image };
      const bytes = image.toPNG();
      return {
        snapshot: { id: snapshot.id, version },
        width: image.getSize().width,
        height: image.getSize().height,
        mimeType: "image/png",
        sha256: (0, import_node_crypto4.createHash)("sha256").update(bytes).digest("hex"),
        png: bytes.buffer.slice(bytes.byteOffset, bytes.byteLength)
      };
    },
    "image.copy": (request) => {
      const r = request;
      if (!snapshot || !r.snapshot || r.snapshot.id !== snapshot.id || r.snapshot.version !== snapshot.version) {
        throw Object.assign(new Error("SNAPSHOT_STALE"), { code: "SNAPSHOT_STALE" });
      }
      const staged = request[STAGED_IMAGE];
      const image = staged ? import_electron3.nativeImage.createFromBuffer(staged) : snapshot.image;
      if (image.isEmpty())
        throw Object.assign(new Error("INVALID_REQUEST"), { code: "INVALID_REQUEST" });
      import_electron3.clipboard.writeImage(image);
      return { copied: !import_electron3.clipboard.readImage().isEmpty() };
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createCaptureOperations,
  createInstallService,
  createManifestStore,
  createStoreInstall,
  extensionId,
  extensionsPaths,
  extractCrx,
  getExtensionsHandle,
  mountDevExtensions,
  registerBridgeTarget
});
