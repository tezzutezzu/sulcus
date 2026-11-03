// ---------------------------------------------------------------------------
// Relief geometry
// ---------------------------------------------------------------------------

/**
 * Shape of the acoustic relief ring, shared by the live view and the generator.
 *
 * This module is pure arithmetic with no platform APIs, so it runs unchanged
 * on the main thread, in a worker, or under Node.
 *
 * The topology is fixed: a top grid of `rows × cols` vertices followed by a
 * duplicate of the same grid at z = 0, joined around the border. Anything that
 * animates the relief only needs to rewrite the top vertices' z values.
 */

/** Geometry and level defaults. Every other option is pipeline-specific. */
export const RELIEF_DEFAULTS = {
  diameter: 160, // outer diameter of the ring, mm
  'inner-diameter': 40, // diameter of the central opening, mm
  arc: 330, // degrees of the ring that carry relief
  base: 3, // thickness of the base plate, mm
  relief: 27, // peak height above the base, mm
  floor: -80, // dB floor; anything quieter is clamped here
};

/**
 * Flat x/y layout and triangles of the relief.
 *
 * Dimensions are read from `options.diameter`, `options['inner-diameter']`,
 * `options.arc`, `options.rows` and `options.cols`.
 */
export function reliefTopology(options) {
  const nx = options.cols;
  const ny = options.rows;
  const vertices = [];
  const faces = [];

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const radius = (options['inner-diameter'] +
        (options.diameter - options['inner-diameter']) * j / (ny - 1)) / 2;
      // Viewed from +Z: clockwise, with the gap centered on -Y.
      const angle = (-90 - (360 - options.arc) / 2 - options.arc * i / (nx - 1)) * Math.PI / 180;
      vertices.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
  }

  // Top surface quads, split into triangles.
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      faces.push([k, k + 1, k + nx + 1], [k, k + nx + 1, k + nx]);
    }
  }

  // Border of the top surface, walked once around the perimeter.
  const border = [];
  for (let i = 0; i < nx; i++) border.push(i);
  for (let j = 1; j < ny; j++) border.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) border.push((ny - 1) * nx + i);
  for (let j = ny - 2; j > 0; j--) border.push(j * nx);

  // Duplicate the full surface grid at z=0. Grid triangulation preserves the
  // annular opening and gap; a center fan would incorrectly fill them.
  const topCount = vertices.length;
  for (let k = 0; k < topCount; k++) {
    vertices.push([vertices[k][0], vertices[k][1]]);
  }
  const topFaceCount = faces.length;
  for (let k = 0; k < topFaceCount; k++) {
    const [a, b, c] = faces[k];
    faces.push([c + topCount, b + topCount, a + topCount]);
  }
  for (let n = 0; n < border.length; n++) {
    const a = border[n], b = border[(n + 1) % border.length];
    faces.push([a, a + topCount, b + topCount], [a, b + topCount, b]);
  }

  return { vertices, faces, topCount, nx, ny };
}

/** Height of one spectral value above the base plate, in millimetres. */
export function reliefHeight(value, options) {
  return options.base + (options.relief * (value - options.floor)) / -options.floor;
}
