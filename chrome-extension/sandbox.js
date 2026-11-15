let modulePromise;
let cachedGlb = null;

function signature(hostname, timestamp) {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = BigInt("0xFFFFFFFFFFFFFFFF");

  function mix(text) {
    for (let i = 0; i < text.length; i++) {
      hash ^= BigInt(text.charCodeAt(i));
      hash = (hash * prime) & mask;
    }
  }

  mix("Meshy_Crypto_Key");
  mix(`${hostname}:${timestamp}`);
  hash ^= hash >> 33n;
  hash = (hash * BigInt("0xff51afd7ed558ccd")) & mask;
  hash ^= hash >> 33n;
  hash = (hash * BigInt("0xc4ceb9fe1a85ec53")) & mask;
  hash ^= hash >> 33n;
  return hash.toString(16).padStart(16, "0");
}

async function getMeshyModule() {
  if (!modulePromise) {
    modulePromise = import("./vendor/mesh_loader.js").catch((error) => {
      throw new Error(`Decoder files are missing or could not be loaded. Run setup-vendor.ps1, then reload the extension. Details: ${error.message}`);
    }).then(({ default: Module }) => Module({
      locateFile: (path) => new URL(`./vendor/${path}`, location.href).href,
      printErr: () => {},
    })).catch((error) => {
      if (String(error.message || error).includes("mesh_loader.wasm")) {
        throw new Error(`Decoder files are missing or could not be loaded. Run setup-vendor.ps1, then reload the extension. Details: ${error.message}`);
      }
      throw error;
    }).then((mod) => {
      const hostname = "www.meshy.ai";
      const timestamp = Date.now();
      if (!mod.authorize(hostname, timestamp, signature(hostname, timestamp))) {
        throw new Error("Could not authorize the Meshy decoder.");
      }
      return mod;
    });
  }
  return modulePromise;
}

const readers = {
  5120: { size: 1, read: (b, o) => b.getInt8(o) },
  5121: { size: 1, read: (b, o) => b.getUint8(o) },
  5122: { size: 2, read: (b, o) => b.getInt16(o, true) },
  5123: { size: 2, read: (b, o) => b.getUint16(o, true) },
  5125: { size: 4, read: (b, o) => b.getUint32(o, true) },
  5126: { size: 4, read: (b, o) => b.getFloat32(o, true) },
};

const typeCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function readGlb(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== "glTF" || view.getUint32(4, true) !== 2) {
    throw new Error("The decoder did not return a valid GLB.");
  }

  let offset = 12;
  let json;
  let bin;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, true);
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (type === "JSON") json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === "BIN\0") bin = chunk;
    offset += 8 + length;
  }
  if (!json) throw new Error("GLB is missing its JSON chunk.");
  if (!bin) bin = new Uint8Array(0);
  return { json, bin };
}

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/ktx2": "ktx2",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

const TEXTURE_ROLES = [
  ["baseColor", (material) => material.pbrMetallicRoughness?.baseColorTexture],
  ["metallicRoughness", (material) => material.pbrMetallicRoughness?.metallicRoughnessTexture],
  ["normal", (material) => material.normalTexture],
  ["occlusion", (material) => material.occlusionTexture],
  ["emissive", (material) => material.emissiveTexture],
];

function sanitize(value, fallback = "model") {
  const clean = String(value ?? "")
    .replace(/[^a-z0-9_.-]+/gi, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return clean || fallback;
}

function extensionFor(mimeType) {
  return MIME_EXTENSIONS[String(mimeType || "").toLowerCase()] || "bin";
}

function sniffMime(bytes) {
  if (bytes.length >= 8) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
    if (bytes[0] === 0xab && bytes[1] === 0x4b && bytes[2] === 0x54 && bytes[3] === 0x58) return "image/ktx2";
  }
  return "application/octet-stream";
}

function decodeDataUri(uri) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/is.exec(uri || "");
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const header = uri.slice(0, uri.indexOf(","));
  const payload = match[2] || "";
  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mimeType, bytes };
  }
  return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
}

function resolveImageIndex(gltf, textureIndex) {
  if (textureIndex === undefined || textureIndex === null) return -1;
  const texture = gltf.textures?.[textureIndex];
  if (!texture) return -1;
  const candidates = [
    texture.extensions?.EXT_texture_webp?.source,
    texture.extensions?.EXT_texture_avif?.source,
    texture.extensions?.KHR_texture_basisu?.source,
    texture.source,
  ];
  for (const candidate of candidates) {
    if (Number.isInteger(candidate) && gltf.images?.[candidate]) return candidate;
  }
  return -1;
}

function textureAssignments(gltf) {
  const assignments = [];
  const materials = gltf.materials || [];
  materials.forEach((material, materialIndex) => {
    for (const [role, pick] of TEXTURE_ROLES) {
      const info = pick(material);
      if (!info) continue;
      const imageIndex = resolveImageIndex(gltf, info.index);
      if (imageIndex < 0) continue;
      assignments.push({ imageIndex, role, materialIndex });
    }
  });
  return assignments;
}

function textureTransform(textureInfo) {
  const baseTexCoord = Number.isInteger(textureInfo?.texCoord) ? textureInfo.texCoord : 0;
  const transform = textureInfo?.extensions?.KHR_texture_transform;
  if (!transform) return { texCoord: baseTexCoord, matrix: null };

  const offset = transform.offset || [0, 0];
  const scale = transform.scale || [1, 1];
  const rotation = transform.rotation || 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    texCoord: Number.isInteger(transform.texCoord) ? transform.texCoord : baseTexCoord,
    // Row-vector matrix from the KHR_texture_transform spec.
    matrix: {
      a: cos * scale[0],
      b: sin * scale[0],
      c: -sin * scale[1],
      d: cos * scale[1],
      e: offset[0],
      f: offset[1],
    },
  };
}

function uvInfoForMaterial(gltf, materialIndex) {
  const textureInfo = gltf.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorTexture;
  return textureTransform(textureInfo);
}

function applyUvTransform(matrix, uv) {
  if (!matrix) return uv;
  return [
    uv[0] * matrix.a + uv[1] * matrix.c + matrix.e,
    uv[0] * matrix.b + uv[1] * matrix.d + matrix.f,
  ];
}

function imagePayload(gltf, bin, imageIndex) {
  const image = gltf.images?.[imageIndex];
  if (!image) return null;
  if (image.bufferView !== undefined) {
    const view = gltf.bufferViews?.[image.bufferView];
    if (!view) return null;
    const start = view.byteOffset || 0;
    const end = start + view.byteLength;
    if (end > bin.byteLength) return null;
    const bytes = bin.slice(start, end);
    return { mimeType: image.mimeType || sniffMime(bytes), bytes };
  }
  if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
    const decoded = decodeDataUri(image.uri);
    if (!decoded) return null;
    return { mimeType: image.mimeType || decoded.mimeType || sniffMime(decoded.bytes), bytes: decoded.bytes };
  }
  return null;
}

function extractTextures(gltf, bin, baseName) {
  const assignments = textureAssignments(gltf);
  const usersByImage = new Map();
  for (const assignment of assignments) {
    if (!usersByImage.has(assignment.imageIndex)) usersByImage.set(assignment.imageIndex, new Set());
    usersByImage.get(assignment.imageIndex).add(assignment.materialIndex);
  }

  const materials = gltf.materials || [];
  const used = new Set();
  const textures = [];
  const total = (gltf.images || []).length;

  for (let imageIndex = 0; imageIndex < total; imageIndex++) {
    const payload = imagePayload(gltf, bin, imageIndex);
    if (!payload) continue;

    const materialUsers = usersByImage.get(imageIndex);
    const assignment = assignments.find((entry) => entry.imageIndex === imageIndex);
    let base;
    let role = "image";
    let materialIndex;

    if (assignment) {
      role = assignment.role;
      materialIndex = assignment.materialIndex;
      const shared = materialUsers && materialUsers.size > 1;
      base = materials.length > 1 && !shared
        ? `${baseName}_m${materialIndex}_${role}`
        : `${baseName}_${role}`;
    } else {
      base = `${baseName}_image_${imageIndex + 1}`;
    }

    const stem = sanitize(base, "texture");
    const extension = extensionFor(payload.mimeType);
    let name = `${stem}.${extension}`;
    let suffix = 2;
    while (used.has(name)) {
      name = `${stem}_${suffix++}.${extension}`;
    }
    used.add(name);

    textures.push({
      sourceIndex: imageIndex,
      name,
      role,
      materialIndex,
      mimeType: payload.mimeType,
      bytes: payload.bytes,
    });
  }

  return textures;
}

async function toPng(bytes, mimeType) {
  if (!/^image\//.test(String(mimeType))) return null;
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  if (typeof bitmap.close === "function") bitmap.close();
  return new Uint8Array(await blob.arrayBuffer());
}

async function ensurePng(textures) {
  for (const texture of textures) {
    if (texture.mimeType === "image/png" || texture.mimeType === "image/jpeg") continue;
    try {
      const png = await toPng(texture.bytes, texture.mimeType);
      if (!png) continue;
      texture.bytes = png;
      texture.mimeType = "image/png";
      texture.name = `${texture.name.replace(/\.[a-z0-9]+$/i, "")}.png`;
    } catch {
      // Keep the original texture when the browser cannot decode it.
    }
  }
  return textures;
}

function texturePathsByMaterial(textures, directory) {
  const paths = new Map();
  for (const texture of textures) {
    if (texture.materialIndex === undefined) continue;
    if (!paths.has(texture.materialIndex)) paths.set(texture.materialIndex, {});
    paths.get(texture.materialIndex)[texture.role] = `${directory}/${texture.name}`;
  }
  return paths;
}

function normalized(value, componentType) {
  if (componentType === 5120) return Math.max(value / 127, -1);
  if (componentType === 5121) return value / 255;
  if (componentType === 5122) return Math.max(value / 32767, -1);
  if (componentType === 5123) return value / 65535;
  return value;
}

function accessorReader(gltf, bin, index) {
  const accessor = gltf.accessors[index];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const reader = readers[accessor.componentType];
  const itemSize = typeCounts[accessor.type];
  if (!reader || !itemSize) throw new Error(`Unsupported GLB accessor: ${index}`);

  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const stride = bufferView.byteStride || reader.size * itemSize;
  const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);

  return {
    count: accessor.count,
    get(item) {
      const values = [];
      const base = start + item * stride;
      for (let i = 0; i < itemSize; i++) {
        let value = reader.read(view, base + i * reader.size);
        if (accessor.normalized) value = normalized(value, accessor.componentType);
        values.push(value);
      }
      return values;
    },
  };
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

function matrixFromNode(node) {
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
    (1 - yy - zz) * s[0], (xy - wz) * s[1], (xz + wy) * s[2], t[0],
    (xy + wz) * s[0], (1 - xx - zz) * s[1], (yz - wx) * s[2], t[1],
    (xz - wy) * s[0], (yz + wx) * s[1], (1 - xx - yy) * s[2], t[2],
    0, 0, 0, 1,
  ];
}

function transform(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

function transformDirection(m, v) {
  const x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const y = m[4] * v[0] + m[5] * v[1] + m[6] * v[2];
  const z = m[8] * v[0] + m[9] * v[1] + m[10] * v[2];
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function collectMeshNodes(gltf) {
  const scene = gltf.scenes[gltf.scene || 0];
  const nodes = [];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function visit(index, parent) {
    const node = gltf.nodes[index];
    const world = multiply(parent, matrixFromNode(node));
    if (node.mesh !== undefined) nodes.push({ node, world });
    for (const child of node.children || []) visit(child, world);
  }

  for (const index of scene.nodes || []) visit(index, identity);
  return nodes;
}

function describeModel(gltf) {
  let triangles = 0;
  let vertices = 0;
  for (const { node } of collectMeshNodes(gltf)) {
    for (const primitive of gltf.meshes[node.mesh].primitives || []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const position = primitive.attributes?.POSITION;
      if (position === undefined) continue;
      vertices += gltf.accessors[position]?.count || 0;
      const count = primitive.indices === undefined
        ? gltf.accessors[position]?.count || 0
        : gltf.accessors[primitive.indices]?.count || 0;
      triangles += Math.floor(count / 3);
    }
  }
  return {
    triangles,
    vertices,
    materials: (gltf.materials || []).length,
    images: (gltf.images || []).length,
    textures: [],
  };
}

function number(value) {
  if (!Number.isFinite(value)) return "0";
  const text = value.toFixed(6);
  return text === "-0.000000" ? "0.000000" : text;
}

function glbToBinaryStl(gltf, bin) {
  const meshNodes = collectMeshNodes(gltf);
  let triangleCount = 0;

  for (const { node } of meshNodes) {
    const mesh = gltf.meshes[node.mesh];
    for (const primitive of mesh.primitives || []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      if (primitive.attributes?.POSITION === undefined) throw new Error("GLB is missing POSITION.");
      const indices = primitive.indices === undefined ? null : accessorReader(gltf, bin, primitive.indices);
      const positions = accessorReader(gltf, bin, primitive.attributes.POSITION);
      triangleCount += Math.floor((indices ? indices.count : positions.count) / 3);
    }
  }

  const out = new ArrayBuffer(84 + triangleCount * 50);
  const bytes = new Uint8Array(out);
  const view = new DataView(out);
  bytes.set(new TextEncoder().encode("Converted from Meshy GLB"));
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  function writeVector(v) {
    view.setFloat32(offset, v[0], true); offset += 4;
    view.setFloat32(offset, v[1], true); offset += 4;
    view.setFloat32(offset, v[2], true); offset += 4;
  }

  for (const { node, world } of meshNodes) {
    const mesh = gltf.meshes[node.mesh];
    for (const primitive of mesh.primitives || []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const positions = accessorReader(gltf, bin, primitive.attributes.POSITION);
      const indices = primitive.indices === undefined ? null : accessorReader(gltf, bin, primitive.indices);
      const count = indices ? indices.count : positions.count;

      for (let i = 0; i + 2 < count; i += 3) {
        const ia = indices ? indices.get(i)[0] : i;
        const ib = indices ? indices.get(i + 1)[0] : i + 1;
        const ic = indices ? indices.get(i + 2)[0] : i + 2;
        const a = transform(world, positions.get(ia));
        const b = transform(world, positions.get(ib));
        const c = transform(world, positions.get(ic));
        writeVector(faceNormal(a, b, c));
        writeVector(a);
        writeVector(b);
        writeVector(c);
        view.setUint16(offset, 0, true);
        offset += 2;
      }
    }
  }

  return out;
}

function faceReference(index, vertexOffset, uvOffset, normalOffset) {
  const vertex = index + vertexOffset;
  if (uvOffset === null && normalOffset === null) return `${vertex}`;
  if (normalOffset === null) return `${vertex}/${index + uvOffset}`;
  if (uvOffset === null) return `${vertex}//${index + normalOffset}`;
  return `${vertex}/${index + uvOffset}/${index + normalOffset}`;
}

function buildObj(gltf, bin, options) {
  const { baseName } = options;
  const meshNodes = collectMeshNodes(gltf);
  const lines = ["# Generated by Meshy To STL", `mtllib ${baseName}.mtl`];
  let vertexOffset = 1;
  let uvOffset = 1;
  let normalOffset = 1;
  let objectIndex = 0;

  for (const { node, world } of meshNodes) {
    const mesh = gltf.meshes[node.mesh];
    for (let primitiveIndex = 0; primitiveIndex < (mesh.primitives || []).length; primitiveIndex++) {
      const primitive = mesh.primitives[primitiveIndex];
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      if (primitive.attributes?.POSITION === undefined) throw new Error("GLB is missing POSITION.");

      const positions = accessorReader(gltf, bin, primitive.attributes.POSITION);
      const indices = primitive.indices === undefined ? null : accessorReader(gltf, bin, primitive.indices);
      const uvInfo = uvInfoForMaterial(gltf, primitive.material);
      const uvAccessor = primitive.attributes[`TEXCOORD_${uvInfo.texCoord}`];
      const uvs = uvAccessor === undefined ? null : accessorReader(gltf, bin, uvAccessor);
      const normals = primitive.attributes.NORMAL === undefined ? null : accessorReader(gltf, bin, primitive.attributes.NORMAL);

      const name = sanitize(mesh.name || node.name || `mesh_${objectIndex + 1}`, `mesh_${objectIndex + 1}`);
      lines.push(`o ${name}_${primitiveIndex + 1}`);

      for (let i = 0; i < positions.count; i++) {
        const point = transform(world, positions.get(i));
        lines.push(`v ${number(point[0])} ${number(point[1])} ${number(point[2])}`);
      }

      if (uvs) {
        for (let i = 0; i < uvs.count; i++) {
          const uv = applyUvTransform(uvInfo.matrix, uvs.get(i));
          lines.push(`vt ${number(uv[0])} ${number(1 - uv[1])}`);
        }
      }

      if (normals) {
        for (let i = 0; i < normals.count; i++) {
          const normal = transformDirection(world, normals.get(i));
          lines.push(`vn ${number(normal[0])} ${number(normal[1])} ${number(normal[2])}`);
        }
      }

      if ((gltf.materials || []).length && primitive.material !== undefined) {
        lines.push(`usemtl material_${primitive.material}`);
      }
      lines.push("s 1");

      const count = indices ? indices.count : positions.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const a = indices ? indices.get(i)[0] : i;
        const b = indices ? indices.get(i + 1)[0] : i + 1;
        const c = indices ? indices.get(i + 2)[0] : i + 2;
        lines.push(
          `f ${faceReference(a, vertexOffset, uvs ? uvOffset : null, normals ? normalOffset : null)}` +
          ` ${faceReference(b, vertexOffset, uvs ? uvOffset : null, normals ? normalOffset : null)}` +
          ` ${faceReference(c, vertexOffset, uvs ? uvOffset : null, normals ? normalOffset : null)}`
        );
      }

      vertexOffset += positions.count;
      if (uvs) uvOffset += uvs.count;
      if (normals) normalOffset += normals.count;
      objectIndex++;
    }
  }

  if (!objectIndex) throw new Error("GLB does not contain triangle meshes.");
  return `${lines.join("\n")}\n`;
}

function buildMtl(gltf, texturePaths) {
  const materials = gltf.materials || [];
  const lines = ["# Generated by Meshy To STL"];

  for (let index = 0; index < materials.length; index++) {
    const material = materials[index];
    const pbr = material.pbrMetallicRoughness || {};
    const color = pbr.baseColorFactor || [1, 1, 1, 1];
    const paths = texturePaths.get(index) || {};

    lines.push(`newmtl material_${index}`);
    lines.push(`Kd ${number(color[0])} ${number(color[1])} ${number(color[2])}`);
    lines.push(`d ${number(color[3] ?? 1)}`);
    lines.push("Ka 0.000000 0.000000 0.000000");
    lines.push("Ks 0.000000 0.000000 0.000000");
    lines.push("illum 2");
    if (paths.baseColor) lines.push(`map_Kd ${paths.baseColor}`);
    if (paths.normal) lines.push(`norm ${paths.normal}`);
    if (paths.emissive) {
      lines.push(`map_Ke ${paths.emissive}`);
      const emissive = material.emissiveFactor;
      if (emissive) lines.push(`Ke ${number(emissive[0])} ${number(emissive[1])} ${number(emissive[2])}`);
    }
    if (paths.metallicRoughness) {
      lines.push(`# map_Ks ${paths.metallicRoughness}`);
      lines.push("# metallic-roughness has no standard MTL slot; the file is included in textures/");
    }
    lines.push("");
  }

  return `${lines.join("\n")}`;
}

function buildGltfPackage(gltf, bin, baseName, textures) {
  const out = JSON.parse(JSON.stringify(gltf));
  const bySource = new Map(textures.map((texture, index) => [texture.sourceIndex, { index, name: texture.name }]));

  out.images = textures.map((texture) => ({ name: texture.name, uri: `textures/${texture.name}` }));

  (out.textures || []).forEach((texture, index) => {
    const mapped = bySource.get(resolveImageIndex(gltf, index));
    if (mapped) texture.source = mapped.index;
    else delete texture.source;

    const extensions = texture.extensions;
    if (!extensions) return;
    delete extensions.EXT_texture_webp;
    delete extensions.EXT_texture_avif;
    delete extensions.KHR_texture_basisu;
    if (!Object.keys(extensions).length) delete texture.extensions;
  });

  out.buffers = [{ uri: `${baseName}.bin`, byteLength: bin.byteLength }];

  const removable = new Set(["EXT_texture_webp", "EXT_texture_avif", "KHR_texture_basisu"]);
  if (out.extensionsUsed) {
    out.extensionsUsed = out.extensionsUsed.filter((name) => !removable.has(name));
    if (!out.extensionsUsed.length) delete out.extensionsUsed;
  }
  if (out.extensionsRequired) {
    out.extensionsRequired = out.extensionsRequired.filter((name) => !removable.has(name));
    if (!out.extensionsRequired.length) delete out.extensionsRequired;
  }

  return { json: JSON.stringify(out, null, 2) };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function buildZip(entries, timestamp = new Date()) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(timestamp);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = entry.data;
    const checksum = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(8, 0x0800, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, time, true);
    headerView.setUint16(14, date, true);
    headerView.setUint32(16, checksum, true);
    headerView.setUint32(20, data.length, true);
    headerView.setUint32(24, data.length, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint32(42, offset, true);
    header.set(name, 46);

    locals.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((total, header) => total + header.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of [...locals, ...central, end]) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}

async function decodeMeshy(buffer) {
  if (!buffer) {
    if (!cachedGlb) throw new Error("Decode the file first.");
    return cachedGlb;
  }
  const mod = await getMeshyModule();
  const result = mod.processMeshyFile(new Uint8Array(buffer));
  if (!result?.success) throw new Error(result?.error || "Failed to decode .meshy.");
  const glb = result.data instanceof Uint8Array
    ? result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength)
    : result.data;
  cachedGlb = glb;
  return glb;
}

async function makeOutputs(glb, format, options) {
  const { json, bin } = readGlb(glb);
  const baseName = sanitize(options?.baseName, "model");
  const stats = describeModel(json);

  if (format === "glb") {
    return { fileName: `${baseName}.glb`, mimeType: "model/gltf-binary", bytes: new Uint8Array(glb), stats };
  }

  if (format === "stl") {
    return { fileName: `${baseName}.stl`, mimeType: "model/stl", bytes: new Uint8Array(glbToBinaryStl(json, bin)), stats };
  }

  const textures = extractTextures(json, bin, baseName);
  if (options?.png) await ensurePng(textures);
  stats.textures = textures.map((texture) => ({
    name: texture.name,
    role: texture.role,
    mimeType: texture.mimeType,
    size: texture.bytes.length,
  }));

  if (format === "textures") {
    if (!textures.length) throw new Error("This model has no embedded textures.");
    const bytes = buildZip(textures.map((texture) => ({ path: `${baseName}/textures/${texture.name}`, data: texture.bytes })));
    return { fileName: `${baseName}-textures.zip`, mimeType: "application/zip", bytes, stats };
  }

  if (format === "obj") {
    const obj = buildObj(json, bin, { baseName });
    const mtl = buildMtl(json, texturePathsByMaterial(textures, "textures"));
    const entries = [
      { path: `${baseName}/${baseName}.obj`, data: new TextEncoder().encode(obj) },
      { path: `${baseName}/${baseName}.mtl`, data: new TextEncoder().encode(mtl) },
      ...textures.map((texture) => ({ path: `${baseName}/textures/${texture.name}`, data: texture.bytes })),
    ];
    return { fileName: `${baseName}-obj.zip`, mimeType: "application/zip", bytes: buildZip(entries), stats };
  }

  if (format === "gltf") {
    const packageJson = buildGltfPackage(json, bin, baseName, textures);
    const entries = [
      { path: `${baseName}/${baseName}.gltf`, data: new TextEncoder().encode(packageJson.json) },
      { path: `${baseName}/${baseName}.bin`, data: bin },
      ...textures.map((texture) => ({ path: `${baseName}/textures/${texture.name}`, data: texture.bytes })),
    ];
    return { fileName: `${baseName}-gltf.zip`, mimeType: "application/zip", bytes: buildZip(entries), stats };
  }

  throw new Error(`Unsupported output format: ${format}`);
}

async function buildPreviews(textures) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return [];
  const previews = [];
  for (const texture of textures.slice(0, 8)) {
    try {
      const bitmap = await createImageBitmap(new Blob([texture.bytes], { type: texture.mimeType }));
      const scale = Math.min(1, 72 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
      previews.push({
        name: texture.name,
        role: texture.role,
        mimeType: texture.mimeType,
        size: texture.bytes.length,
        width: bitmap.width,
        height: bitmap.height,
        thumb: await blob.arrayBuffer(),
      });
      if (typeof bitmap.close === "function") bitmap.close();
    } catch {
      // Previews are optional.
    }
  }
  return previews;
}

function exactBytes(bytes) {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

if (typeof window !== "undefined") {
  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || (data.type !== "convert" && data.type !== "inspect")) return;
    try {
      if (data.type === "inspect") {
        const glb = await decodeMeshy(data.buffer);
        const { json, bin } = readGlb(glb);
        const baseName = sanitize(data.baseName, "model");
        const textures = extractTextures(json, bin, baseName);
        const stats = describeModel(json);
        stats.textures = textures.map((texture) => ({
          name: texture.name,
          role: texture.role,
          mimeType: texture.mimeType,
          size: texture.bytes.length,
        }));
        const previews = await buildPreviews(textures);
        event.source.postMessage({ id: data.id, ok: true, stats, previews }, event.origin, previews.map((preview) => preview.thumb));
        return;
      }

      const glb = await decodeMeshy(data.buffer);
      const result = await makeOutputs(glb, data.format, data.options || {});
      const bytes = exactBytes(result.bytes);
      event.source.postMessage(
        {
          id: data.id,
          ok: true,
          stats: result.stats,
          result: { fileName: result.fileName, mimeType: result.mimeType, bytes },
        },
        event.origin,
        [bytes.buffer]
      );
    } catch (error) {
      event.source.postMessage({ id: data.id, ok: false, error: error.message || String(error) }, event.origin);
    }
  });
}

export {
  accessorReader,
  buildGltfPackage,
  buildMtl,
  buildObj,
  buildZip,
  collectMeshNodes,
  crc32,
  decodeDataUri,
  describeModel,
  extractTextures,
  glbToBinaryStl,
  imagePayload,
  makeOutputs,
  readGlb,
  resolveImageIndex,
  sniffMime,
  textureAssignments,
};
