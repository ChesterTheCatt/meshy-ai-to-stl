const fs = require("fs");

const input = process.argv[2];
const output = process.argv[3];

if (!input || !output) {
  console.error("Usage: node glb-to-stl.js input.glb output.stl");
  process.exit(1);
}

const componentReaders = {
  5120: { size: 1, read: (b, o) => b.readInt8(o) },
  5121: { size: 1, read: (b, o) => b.readUInt8(o) },
  5122: { size: 2, read: (b, o) => b.readInt16LE(o) },
  5123: { size: 2, read: (b, o) => b.readUInt16LE(o) },
  5125: { size: 4, read: (b, o) => b.readUInt32LE(o) },
  5126: { size: 4, read: (b, o) => b.readFloatLE(o) },
};

const typeCounts = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function readGlb(file) {
  const data = fs.readFileSync(file);
  if (data.toString("ascii", 0, 4) !== "glTF" || data.readUInt32LE(4) !== 2) {
    throw new Error("Input is not a GLB v2 file");
  }

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === "JSON") json = JSON.parse(chunk.toString("utf8"));
    if (type === "BIN\0") bin = chunk;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error("GLB is missing JSON or BIN chunk");
  return { json, bin };
}

function normalizeValue(value, componentType) {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    default: return value;
  }
}

function readAccessor(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const reader = componentReaders[accessor.componentType];
  const count = typeCounts[accessor.type];
  if (!reader || !count) throw new Error(`Unsupported accessor ${accessorIndex}`);

  const stride = view.byteStride || reader.size * count;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return {
    count: accessor.count,
    itemSize: count,
    get(index) {
      const values = [];
      const base = start + index * stride;
      for (let i = 0; i < count; i++) {
        let value = reader.read(bin, base + i * reader.size);
        if (accessor.normalized) value = normalizeValue(value, accessor.componentType);
        values.push(value);
      }
      return values;
    },
  };
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      for (let k = 0; k < 4; k++) out[row * 4 + col] += a[row * 4 + k] * b[k * 4 + col];
    }
  }
  return out;
}

function trsMatrix(node) {
  if (node.matrix) return node.matrix;
  const t = node.translation || [0, 0, 0];
  const s = node.scale || [1, 1, 1];
  const q = node.rotation || [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  return [
    (1 - (yy + zz)) * s[0], (xy - wz) * s[1], (xz + wy) * s[2], t[0],
    (xy + wz) * s[0], (1 - (xx + zz)) * s[1], (yz - wx) * s[2], t[1],
    (xz - wy) * s[0], (yz + wx) * s[1], (1 - (xx + yy)) * s[2], t[2],
    0, 0, 0, 1,
  ];
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

function normal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function collectNodes(gltf) {
  const scene = gltf.scenes[gltf.scene || 0];
  const result = [];
  function visit(nodeIndex, parent) {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parent, trsMatrix(node));
    if (node.mesh !== undefined) result.push({ node, world });
    for (const child of node.children || []) visit(child, world);
  }
  for (const nodeIndex of scene.nodes || []) visit(nodeIndex, identity());
  return result;
}

const { json, bin } = readGlb(input);
const triangles = [];

for (const { node, world } of collectNodes(json)) {
  const mesh = json.meshes[node.mesh];
  for (const primitive of mesh.primitives || []) {
    if (primitive.mode !== undefined && primitive.mode !== 4) continue;
    const positions = readAccessor(json, bin, primitive.attributes.POSITION);
    const indices = primitive.indices === undefined ? null : readAccessor(json, bin, primitive.indices);
    const indexCount = indices ? indices.count : positions.count;
    for (let i = 0; i < indexCount; i += 3) {
      const ia = indices ? indices.get(i)[0] : i;
      const ib = indices ? indices.get(i + 1)[0] : i + 1;
      const ic = indices ? indices.get(i + 2)[0] : i + 2;
      const a = transformPoint(world, positions.get(ia));
      const b = transformPoint(world, positions.get(ib));
      const c = transformPoint(world, positions.get(ic));
      triangles.push([normal(a, b, c), a, b, c]);
    }
  }
}

const out = Buffer.alloc(84 + triangles.length * 50);
out.write("Converted from Meshy GLB", 0, "ascii");
out.writeUInt32LE(triangles.length, 80);
let offset = 84;
for (const tri of triangles) {
  for (const vec of tri) {
    out.writeFloatLE(vec[0], offset); offset += 4;
    out.writeFloatLE(vec[1], offset); offset += 4;
    out.writeFloatLE(vec[2], offset); offset += 4;
  }
  out.writeUInt16LE(0, offset); offset += 2;
}

fs.writeFileSync(output, out);
console.log(`Wrote ${triangles.length} triangles to ${output}`);
