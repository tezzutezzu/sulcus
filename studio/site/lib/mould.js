// ---------------------------------------------------------------------------
// Press mould
// ---------------------------------------------------------------------------

/**
 * Builds a one-piece press mould from the ring relief.
 *
 * The relief is a heightfield over a polar grid, so the mould needs no
 * undercut handling: the cavity is the same grid flipped in Z and every wall
 * is a vertical step. The only liberty taken is the slope cap, which stops
 * the deepest grooves from becoming narrow slots.
 *
 * Shared by the browser worker and the offline wrapper in tools/. There are
 * no platform APIs here and no dependencies.
 */

/** Defaults for the mould controls. Numeric entries are millimetres/degrees. */
export const MOULD_DEFAULTS = Object.freeze({
  relief: 14, // peak height above the object's base
  slope: 60, // relief slope cap, degrees
  scale: 1, // 1 = full size
  back: 5, // material under the deepest cavity
  marginOut: 15, // rim outside the outer wall
  marginIn: 8, // rim inside the inner wall
  endMargin: 6, // rim beyond each arc end, degrees
  marginStep: 1.5, // sampling of the rim in r
});

/**
 * @param {object} data `landscape-data.json` with shape "circular"
 * @param {object} [options] overrides for MOULD_DEFAULTS
 * @returns {{ stlBytes: ArrayBuffer, triangles: number, bounds: object, cavityVolume: number }}
 */
export function buildMould(data, options = {}) {
  const settings = { ...MOULD_DEFAULTS, ...options };

  if (!data || data.shape !== 'circular') {
    throw new Error('The mould needs a circular relief.');
  }

  const values = data.values;
  if (!Array.isArray(values) || values.length < 2 ||
      !Array.isArray(values[0]) || values[0].length < 2) {
    throw new Error('The relief grid is missing or too small.');
  }
  if (!(data.dbMax > data.dbMin)) {
    throw new Error('dbMax must be greater than dbMin.');
  }

  const rows = values.length;
  const cols = values[0].length;
  const dbMin = data.dbMin;
  const dbSpan = data.dbMax - dbMin;
  const arc = data.arcDegrees;

  if (!(arc > 0 && arc < 360)) {
    throw new Error(`The arc must lie between 0 and 360 degrees, got ${arc}.`);
  }

  const { diameter, innerDiameter, base } = data.geometryMm;
  if (!(diameter > innerDiameter && innerDiameter > 0)) {
    throw new Error('The diameters are not usable.');
  }
  if (!(settings.relief > 0)) throw new Error('The mould relief must be positive.');
  if (!(settings.slope > 0 && settings.slope < 90)) {
    throw new Error('The slope limit must lie between 0 and 90 degrees.');
  }
  if (!(settings.scale > 0)) throw new Error('The mould scale must be positive.');
  if (!(settings.back > 0)) throw new Error('The back thickness must be positive.');
  if (!(settings.marginIn > 0 && settings.marginOut > 0 && settings.endMargin > 0)) {
    throw new Error('The mould rim must be positive.');
  }

  const Rin = innerDiameter / 2;
  const Rout = diameter / 2;
  const dr = (Rout - Rin) / (rows - 1);
  const arcRad = (arc * Math.PI) / 180;
  const dTheta = arcRad / (cols - 1);
  const endRad = (settings.endMargin * Math.PI) / 180;

  if (!(Rin > settings.marginIn + 2)) {
    throw new Error('The rim is too wide for this inner diameter.');
  }
  if (!(arcRad + 2 * endRad < Math.PI * 2)) {
    throw new Error('The end rim is too wide for this arc gap.');
  }

  // Clockwise from the arc start, gap centred on -Y, matching the site.
  const theta0 = ((-90 - (360 - arc) / 2) * Math.PI) / 180;
  const theta1 = theta0 - arcRad;

  // -------------------------------------------------------------------------
  // Relief
  // -------------------------------------------------------------------------

  const H = new Array(rows);
  for (let j = 0; j < rows; j++) {
    H[j] = new Float64Array(cols);
    for (let i = 0; i < cols; i++) {
      const level = Math.min(1, Math.max(0, (values[j][i] - dbMin) / dbSpan));
      H[j][i] = base + settings.relief * level;
    }
  }

  /**
   * Caps the heightfield slope with the lower envelope of cones:
   * H(p) = min over q of H(q) + distance(p, q) * tan(maxSlope).
   * Multi-source Dijkstra over the polar grid. Peaks come down; valleys stay.
   */
  const tanMax = Math.tan((settings.slope * Math.PI) / 180);
  const count = rows * cols;
  const dist = new Float64Array(count);
  const heap = new MinHeap();

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      dist[k] = H[j][i];
      heap.push(dist[k], k);
    }
  }

  const radialStep = dr * tanMax;

  while (heap.size) {
    const [value, k] = heap.pop();
    if (value > dist[k]) continue;

    const j = (k / cols) | 0;
    const i = k - j * cols;
    const angularStep = (Rin + dr * j) * dTheta * tanMax;

    if (j > 0 && value + radialStep < dist[k - cols]) {
      dist[k - cols] = value + radialStep;
      heap.push(dist[k - cols], k - cols);
    }
    if (j < rows - 1 && value + radialStep < dist[k + cols]) {
      dist[k + cols] = value + radialStep;
      heap.push(dist[k + cols], k + cols);
    }
    if (i > 0 && value + angularStep < dist[k - 1]) {
      dist[k - 1] = value + angularStep;
      heap.push(dist[k - 1], k - 1);
    }
    if (i < cols - 1 && value + angularStep < dist[k + 1]) {
      dist[k + 1] = value + angularStep;
      heap.push(dist[k + 1], k + 1);
    }
  }

  let maxH = 0;
  for (let j = 0; j < rows; j++) {
    H[j].set(dist.subarray(j * cols, (j + 1) * cols));
    for (let i = 0; i < cols; i++) maxH = Math.max(maxH, H[j][i]);
  }

  const T = maxH + settings.back;

  // -------------------------------------------------------------------------
  // Grid
  // -------------------------------------------------------------------------

  // The rim is sampled coarsely; the cavity keeps the relief's own samples.
  // Both lists include the cavity limits, so the cavity border is a grid line.
  const innerCount = Math.max(2, Math.ceil(settings.marginIn / settings.marginStep));
  const outerCount = Math.max(2, Math.ceil(settings.marginOut / settings.marginStep));
  const endCount = Math.max(2, Math.ceil(endRad / dTheta));

  const radial = [];
  for (let k = 0; k < innerCount; k++) {
    radial.push(Rin - settings.marginIn + (settings.marginIn * k) / innerCount);
  }
  for (let j = 0; j < rows; j++) radial.push(Rin + dr * j);
  for (let k = 1; k <= outerCount; k++) {
    radial.push(Rout + (settings.marginOut * k) / outerCount);
  }

  const angular = [];
  for (let k = 0; k < endCount; k++) {
    angular.push(theta0 + endRad - (endRad * k) / endCount);
  }
  for (let i = 0; i < cols; i++) angular.push(theta0 - dTheta * i);
  for (let k = 1; k <= endCount; k++) {
    angular.push(theta1 - (endRad * k) / endCount);
  }

  const jCav0 = innerCount;
  const jCav1 = innerCount + rows - 1;
  const iCav0 = endCount;
  const iCav1 = endCount + cols - 1;
  const NJ = radial.length;
  const NI = angular.length;

  // -------------------------------------------------------------------------
  // Mesh
  // -------------------------------------------------------------------------

  const vertices = [];
  const faces = [];

  function addVertex(x, y, z) {
    vertices.push([x, y, z]);
    return vertices.length - 1;
  }

  function triangle(a, b, c) {
    faces.push([a, b, c]);
  }

  function quad(a, b, c, d) {
    triangle(a, b, c);
    triangle(a, c, d);
  }

  const top = new Int32Array(NJ * NI);
  for (let j = 0; j < NJ; j++) {
    const r = radial[j];
    for (let i = 0; i < NI; i++) {
      const th = angular[i];
      top[j * NI + i] = addVertex(r * Math.cos(th), r * Math.sin(th), T);
    }
  }

  const bottom = new Int32Array(NJ * NI);
  for (let j = 0; j < NJ; j++) {
    const r = radial[j];
    for (let i = 0; i < NI; i++) {
      const th = angular[i];
      bottom[j * NI + i] = addVertex(r * Math.cos(th), r * Math.sin(th), 0);
    }
  }

  const floor = new Int32Array(rows * cols);
  for (let j = 0; j < rows; j++) {
    const r = Rin + dr * j;
    for (let i = 0; i < cols; i++) {
      const th = theta0 - dTheta * i;
      floor[j * cols + i] = addVertex(r * Math.cos(th), r * Math.sin(th), T - H[j][i]);
    }
  }

  // Rim at z = T, with the cavity left open.
  for (let j = 0; j < NJ - 1; j++) {
    for (let i = 0; i < NI - 1; i++) {
      const inside = j >= jCav0 && j < jCav1 && i >= iCav0 && i < iCav1;
      if (inside) continue;
      const a = top[j * NI + i];
      const b = top[j * NI + i + 1];
      const c = top[(j + 1) * NI + i + 1];
      const d = top[(j + 1) * NI + i];
      quad(a, b, c, d);
    }
  }

  // Cavity floor.
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = floor[j * cols + i];
      const b = floor[j * cols + i + 1];
      const c = floor[(j + 1) * cols + i + 1];
      const d = floor[(j + 1) * cols + i];
      quad(a, b, c, d);
    }
  }

  // Flat back.
  for (let j = 0; j < NJ - 1; j++) {
    for (let i = 0; i < NI - 1; i++) {
      const a = bottom[j * NI + i];
      const b = bottom[j * NI + i + 1];
      const c = bottom[(j + 1) * NI + i + 1];
      const d = bottom[(j + 1) * NI + i];
      quad(a, d, c, b);
    }
  }

  // Cavity walls: outer radial edge, inner radial edge, then both arc ends.
  for (let i = 0; i < cols - 1; i++) {
    const f0 = floor[(rows - 1) * cols + i];
    const f1 = floor[(rows - 1) * cols + i + 1];
    const t0 = top[jCav1 * NI + iCav0 + i];
    const t1 = top[jCav1 * NI + iCav0 + i + 1];
    quad(f0, f1, t1, t0);
  }
  for (let i = 0; i < cols - 1; i++) {
    const f0 = floor[i];
    const f1 = floor[i + 1];
    const t0 = top[jCav0 * NI + iCav0 + i];
    const t1 = top[jCav0 * NI + iCav0 + i + 1];
    quad(f0, t0, t1, f1);
  }
  for (let j = 0; j < rows - 1; j++) {
    const f0 = floor[j * cols];
    const f1 = floor[(j + 1) * cols];
    const t0 = top[(jCav0 + j) * NI + iCav0];
    const t1 = top[(jCav0 + j + 1) * NI + iCav0];
    quad(f0, f1, t1, t0);
  }
  for (let j = 0; j < rows - 1; j++) {
    const f0 = floor[j * cols + cols - 1];
    const f1 = floor[(j + 1) * cols + cols - 1];
    const t0 = top[(jCav0 + j) * NI + iCav1];
    const t1 = top[(jCav0 + j + 1) * NI + iCav1];
    quad(f0, t0, t1, f1);
  }

  // Outside walls, walking the footprint boundary. The loop is normalised to
  // counter-clockwise so the outward normal is always to the right of travel.
  const loop = [];
  for (let i = 0; i < NI; i++) loop.push([0, i]);
  for (let j = 1; j < NJ; j++) loop.push([j, NI - 1]);
  for (let i = NI - 2; i >= 0; i--) loop.push([NJ - 1, i]);
  for (let j = NJ - 2; j > 0; j--) loop.push([j, 0]);

  let area = 0;
  for (let n = 0; n < loop.length; n++) {
    const [ja, ia] = loop[n];
    const [jb, ib] = loop[(n + 1) % loop.length];
    const ax = radial[ja] * Math.cos(angular[ia]);
    const ay = radial[ja] * Math.sin(angular[ia]);
    const bx = radial[jb] * Math.cos(angular[ib]);
    const by = radial[jb] * Math.sin(angular[ib]);
    area += ax * by - bx * ay;
  }
  if (area < 0) loop.reverse();

  for (let n = 0; n < loop.length; n++) {
    const [ja, ia] = loop[n];
    const [jb, ib] = loop[(n + 1) % loop.length];
    const a = bottom[ja * NI + ia];
    const b = bottom[jb * NI + ib];
    const at = top[ja * NI + ia];
    const bt = top[jb * NI + ib];
    quad(a, b, bt, at);
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const v of vertices) {
    v[0] *= settings.scale;
    v[1] *= settings.scale;
    v[2] *= settings.scale;
    minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
    minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
  }

  // Volume of the cavity (the clay), before scaling. Cell-centred approximation.
  let cavityVolume = 0;
  for (let j = 0; j < rows - 1; j++) {
    const r = Rin + dr * (j + 0.5);
    const cellArea = r * dr * dTheta;
    for (let i = 0; i < cols - 1; i++) {
      cavityVolume += cellArea *
        (H[j][i] + H[j][i + 1] + H[j + 1][i] + H[j + 1][i + 1]) / 4;
    }
  }

  return {
    stlBytes: encodeStl(vertices, faces),
    triangles: faces.length,
    bounds: {
      minX, maxX, minY, maxY, minZ, maxZ,
      width: maxX - minX,
      depth: maxY - minY,
      height: maxZ - minZ,
    },
    cavityVolume,
  };
}

/** Binary STL: 80-byte header + uint32 count + 50 bytes per triangle. */
function encodeStl(vertices, faces) {
  const buffer = new ArrayBuffer(84 + 50 * faces.length);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const header = 'Ring press mould; units mm';
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  view.setUint32(80, faces.length, true);

  let offset = 84;
  for (const [i0, i1, i2] of faces) {
    const p0 = vertices[i0];
    const p1 = vertices[i1];
    const p2 = vertices[i2];

    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];

    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    view.setFloat32(offset + 12, p0[0], true);
    view.setFloat32(offset + 16, p0[1], true);
    view.setFloat32(offset + 20, p0[2], true);
    view.setFloat32(offset + 24, p1[0], true);
    view.setFloat32(offset + 28, p1[1], true);
    view.setFloat32(offset + 32, p1[2], true);
    view.setFloat32(offset + 36, p2[0], true);
    view.setFloat32(offset + 40, p2[1], true);
    view.setFloat32(offset + 44, p2[2], true);

    offset += 50;
  }

  return buffer;
}

/** Binary heap over parallel value/key arrays. Used by the slope cap. */
class MinHeap {
  constructor() {
    this.values = [];
    this.keys = [];
  }

  get size() {
    return this.values.length;
  }

  push(value, key) {
    const values = this.values;
    const keys = this.keys;
    let index = values.length;
    values.push(value);
    keys.push(key);

    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (values[parent] <= value) break;
      values[index] = values[parent];
      keys[index] = keys[parent];
      index = parent;
    }

    values[index] = value;
    keys[index] = key;
  }

  pop() {
    const values = this.values;
    const keys = this.keys;
    const topValue = values[0];
    const topKey = keys[0];
    const lastValue = values.pop();
    const lastKey = keys.pop();

    if (values.length) {
      let index = 0;
      const count = values.length;
      for (;;) {
        let child = index * 2 + 1;
        if (child >= count) break;
        if (child + 1 < count && values[child + 1] < values[child]) child++;
        if (values[child] >= lastValue) break;
        values[index] = values[child];
        keys[index] = keys[child];
        index = child;
      }
      values[index] = lastValue;
      keys[index] = lastKey;
    }

    return [topValue, topKey];
  }
}
