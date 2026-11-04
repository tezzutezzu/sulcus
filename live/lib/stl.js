// ---------------------------------------------------------------------------
// Binary STL
// ---------------------------------------------------------------------------

/**
 * Binary STL from a flat indexed mesh.
 *
 * Layout: an 80-byte header, a 4-byte triangle count, then 50 bytes per
 * triangle — a normal and three vertices, all little-endian float32. This
 * matches what the studio writes, so both open identically.
 *
 * Vertices are read as xyz triples and left untouched: the ring is already
 * modelled in millimetres, Z-up, with its own orientation.
 *
 * @param {Float32Array} positions xyz triples in model space
 * @param {Uint32Array} indices triangle vertex indices
 * @param {string} [header] ASCII description, truncated to fit the 80 bytes
 * @returns {ArrayBuffer}
 */
export function encodeStl(positions, indices, header = 'Sulcus live ring; units mm') {
  const triangles = Math.floor(indices.length / 3);
  const buffer = new ArrayBuffer(84 + 50 * triangles);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  for (let i = 0; i < header.length && i < 80; i++) bytes[i] = header.charCodeAt(i) & 0x7f;
  view.setUint32(80, triangles, true);

  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;

    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];

    // u x w, normalised. Degenerate triangles keep a zero normal rather than NaN.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz) || 1;

    const offset = 84 + 50 * t;
    view.setFloat32(offset, nx / length, true);
    view.setFloat32(offset + 4, ny / length, true);
    view.setFloat32(offset + 8, nz / length, true);

    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);
    // The attribute byte count stays zero.
  }

  return buffer;
}
