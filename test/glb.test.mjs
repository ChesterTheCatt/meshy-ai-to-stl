import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import {
  buildGltfPackage,
  buildMtl,
  buildObj,
  buildZip,
  crc32,
  extractTextures,
  makeOutputs,
  readGlb,
  resolveImageIndex,
} from "../chrome-extension/sandbox.js";

const TEXTURE_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

function pad(buffer, filler) {
  const length = Math.ceil(buffer.length / 4) * 4;
  const out = Buffer.alloc(length, filler);
  buffer.copy(out, 0);
  return out;
}

function chunk(type, data) {
  const padded = pad(Buffer.from(data), type === "JSON" ? 0x20 : 0);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(padded.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, padded]);
}

function buildGlb(json, bin) {
  const jsonChunk = chunk("JSON", Buffer.from(JSON.stringify(json), "utf8"));
  const binChunk = chunk("BIN\0", bin);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + jsonChunk.length + binChunk.length, 8);
  const out = Buffer.concat([header, jsonChunk, binChunk]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

function buildFixture(options = {}) {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const uvs = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer);
  const uvsAlt = Buffer.from(new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]).buffer);
  const normals = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer);
  const indices = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
  const texture = Buffer.from(TEXTURE_BYTES);

  const parts = [];
  const views = [];
  let offset = 0;
  for (const part of [positions, uvs, uvsAlt, normals, indices, texture]) {
    const aligned = pad(part, 0);
    views.push({ buffer: 0, byteOffset: offset, byteLength: part.length });
    parts.push(aligned);
    offset += aligned.length;
  }
  const bin = Buffer.concat(parts);

  const baseColorTexture = { index: 0 };
  if (options.texCoord) baseColorTexture.texCoord = options.texCoord;
  if (options.transform) {
    baseColorTexture.extensions = { KHR_texture_transform: options.transform };
  }

  const json = {
    asset: { version: "2.0", generator: "gltfpack 1.2" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2, NORMAL: 3 },
        indices: 4,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: { baseColorTexture },
      normalTexture: { index: 1 },
    }],
    // gltfpack stores the image only inside the extension, never in texture.source.
    textures: [
      { extensions: { EXT_texture_webp: { source: 0 } } },
      { extensions: { EXT_texture_webp: { source: 1 } } },
    ],
    images: [
      { bufferView: 5, mimeType: "image/webp" },
      { bufferView: 5, mimeType: "image/webp" },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 4, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
    extensionsUsed: options.transform
      ? ["EXT_texture_webp", "KHR_texture_transform"]
      : ["EXT_texture_webp"],
    extensionsRequired: ["EXT_texture_webp"],
  };

  const glb = buildGlb(json, bin);
  return { glb };
}

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, { method, crc: checksum, data: bytes.subarray(start, start + size) });
    offset = start + size;
  }
  return entries;
}

test("crc32 matches the reference vector", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("readGlb splits JSON and BIN chunks", () => {
  const fixture = buildFixture();
  const { json, bin } = readGlb(fixture.glb);
  assert.equal(json.asset.version, "2.0");
  assert.equal(json.images.length, 2);
  assert.ok(bin.byteLength > 0);
});

test("resolveImageIndex reads the EXT_texture_webp source", () => {
  const { json } = readGlb(buildFixture().glb);
  assert.equal(json.textures[0].source, undefined);
  assert.equal(resolveImageIndex(json, 0), 0);
  assert.equal(resolveImageIndex(json, 1), 1);
  assert.equal(resolveImageIndex(json, 9), -1);
});

test("extractTextures names textures by material role", () => {
  const { json, bin } = readGlb(buildFixture().glb);
  const textures = extractTextures(json, bin, "hero");
  assert.deepEqual(textures.map((texture) => texture.name), ["hero_baseColor.webp", "hero_normal.webp"]);
  assert.deepEqual(textures.map((texture) => texture.role), ["baseColor", "normal"]);
  assert.deepEqual([...textures[0].bytes], [...TEXTURE_BYTES]);
  assert.equal(textures[0].mimeType, "image/webp");
});

test("buildObj writes UVs, normals and the mtllib reference", () => {
  const { json, bin } = readGlb(buildFixture().glb);
  const obj = buildObj(json, bin, { baseName: "hero" });
  assert.match(obj, /^mtllib hero\.mtl$/m);
  assert.match(obj, /^usemtl material_0$/m);
  assert.match(obj, /^vt 0\.000000 1\.000000$/m);
  assert.match(obj, /^f 1\/1\/1 2\/2\/2 3\/3\/3$/m);
  assert.equal(obj.split("\n").filter((line) => line.startsWith("v ")).length, 3);
});

test("buildObj bakes KHR_texture_transform into the UVs", () => {
  const { json, bin } = readGlb(buildFixture({
    transform: { offset: [0.5, 0.25], scale: [2, 1] },
  }).glb);
  const obj = buildObj(json, bin, { baseName: "hero" });
  const vt = obj.split("\n").filter((line) => line.startsWith("vt "));
  // (0,0) -> (0.5,0.25) -> flipped V 0.75; (1,0) -> (2.5,0.25) -> flipped V 0.75.
  assert.equal(vt[0], "vt 0.500000 0.750000");
  assert.equal(vt[1], "vt 2.500000 0.750000");
});

test("buildObj uses the TEXCOORD set requested by the material", () => {
  const { json, bin } = readGlb(buildFixture({ texCoord: 1 }).glb);
  const obj = buildObj(json, bin, { baseName: "hero" });
  const vt = obj.split("\n").filter((line) => line.startsWith("vt "));
  assert.equal(vt.length, 3);
  assert.equal(vt[0], "vt 0.500000 0.500000");
});

test("buildMtl points at the exported texture files", () => {
  const { json, bin } = readGlb(buildFixture().glb);
  const textures = extractTextures(json, bin, "hero");
  const paths = new Map([[0, {
    baseColor: "textures/hero_baseColor.webp",
    normal: "textures/hero_normal.webp",
  }]]);
  const mtl = buildMtl(json, paths);
  assert.match(mtl, /^newmtl material_0$/m);
  assert.match(mtl, /^map_Kd textures\/hero_baseColor\.webp$/m);
  assert.match(mtl, /^norm textures\/hero_normal\.webp$/m);
  assert.equal(textures.length, 2);
});

test("buildZip writes store entries with valid CRCs", () => {
  const entries = [
    { path: "hero/hero.obj", data: new TextEncoder().encode("v 0 0 0\n") },
    { path: "hero/textures/hero_baseColor.webp", data: TEXTURE_BYTES },
  ];
  const bytes = buildZip(entries, new Date(2026, 0, 2, 3, 4, 5));
  const parsed = readZip(bytes);
  assert.deepEqual([...parsed.keys()], ["hero/hero.obj", "hero/textures/hero_baseColor.webp"]);
  for (const [name, entry] of parsed) {
    assert.equal(entry.method, 0, name);
    assert.equal(entry.crc, zlib.crc32(entry.data), name);
  }
});

test("buildGltfPackage drops the WebP extension and references files", () => {
  const { json, bin } = readGlb(buildFixture().glb);
  const textures = extractTextures(json, bin, "hero");
  const result = buildGltfPackage(json, bin, "hero", textures);
  const out = JSON.parse(result.json);

  assert.equal(out.extensionsRequired, undefined);
  assert.equal(out.extensionsUsed, undefined);
  assert.equal(out.images[0].uri, "textures/hero_baseColor.webp");
  assert.equal(out.images[1].uri, "textures/hero_normal.webp");
  assert.equal(out.textures[0].source, 0);
  assert.equal(out.textures[0].extensions, undefined);
  assert.equal(out.buffers[0].uri, "hero.bin");
  assert.equal(out.buffers[0].byteLength, bin.byteLength);
});

test("makeOutputs builds an OBJ archive", async () => {
  const { glb } = buildFixture();
  const result = await makeOutputs(glb, "obj", { baseName: "hero", png: false });
  assert.equal(result.fileName, "hero-obj.zip");
  assert.equal(result.mimeType, "application/zip");
  assert.equal(result.stats.triangles, 1);
  assert.equal(result.stats.textures.length, 2);

  const entries = readZip(result.bytes);
  assert.ok(entries.has("hero/hero.obj"));
  assert.ok(entries.has("hero/hero.mtl"));
  assert.ok(entries.has("hero/textures/hero_baseColor.webp"));
  assert.match(new TextDecoder().decode(entries.get("hero/hero.obj").data), /^vt /m);
});

test("makeOutputs builds a GLTF archive with a matching bin", async () => {
  const { glb } = buildFixture();
  const result = await makeOutputs(glb, "gltf", { baseName: "hero", png: false });
  assert.equal(result.fileName, "hero-gltf.zip");

  const entries = readZip(result.bytes);
  const gltf = JSON.parse(new TextDecoder().decode(entries.get("hero/hero.gltf").data));
  const bin = entries.get("hero/hero.bin").data;
  assert.equal(gltf.buffers[0].byteLength, bin.length);
  assert.equal(gltf.images.length, 2);
});

test("makeOutputs builds a texture-only archive", async () => {
  const { glb } = buildFixture();
  const result = await makeOutputs(glb, "textures", { baseName: "hero" });
  const entries = readZip(result.bytes);
  assert.deepEqual([...entries.keys()], [
    "hero/textures/hero_baseColor.webp",
    "hero/textures/hero_normal.webp",
  ]);
});

test("makeOutputs keeps STL and GLB unchanged in structure", async () => {
  const { glb } = buildFixture();
  const stl = await makeOutputs(glb, "stl", { baseName: "hero" });
  assert.equal(stl.fileName, "hero.stl");
  assert.equal(stl.bytes.length, 84 + 50 * 1);

  const glbOut = await makeOutputs(glb, "glb", { baseName: "hero" });
  assert.equal(glbOut.fileName, "hero.glb");
  assert.deepEqual([...glbOut.bytes.subarray(0, 4)], [0x67, 0x6c, 0x54, 0x46]);
});
