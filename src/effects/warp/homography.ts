/**
 * Projective (perspective) mapping helpers — pure, GPU-free, unit-testable.
 *
 * A perspective warp is a 3×3 homography acting on homogeneous 2D points:
 * `[x, y, 1]ᵀ → [X, Y, W]ᵀ`, screen point `(X/W, Y/W)`. Affine transforms are
 * the special case with the bottom row `[0, 0, 1]`; a non-zero bottom row is
 * what makes straight edges converge (true perspective), which `Transform2D`
 * (affine only) cannot express.
 *
 * Matrices here are row-major `[a,b,c, d,e,f, g,h,i]` (so `m[row*3+col]`).
 */

/** A 3×3 matrix as a flat row-major array of 9 numbers. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** A normalized 2D point (typically in `[0,1]` over an object's bounds). */
export type Vec2 = [number, number];

/** The four corners of a quad, in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Vec2, Vec2, Vec2, Vec2];

/** The identity quad — the unit square corners in TL, TR, BR, BL order. */
export const UNIT_QUAD: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * Homography mapping the **unit square** `(0,0),(1,0),(1,1),(0,1)` onto the
 * given quad (same corner order). Heckbert's closed form. Returns the matrix
 * `M` such that `M · [u,v,1]ᵀ` (then perspective-divide) lands on the quad.
 */
export function squareToQuad(quad: Quad): Mat3 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  // Affine case: the mapped figure is a parallelogram (bottom row [0,0,1]).
  if (dx3 === 0 && dy3 === 0) {
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  }

  const denom = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / denom;
  const h = (dx1 * dy3 - dx3 * dy1) / denom;

  return [
    x1 - x0 + g * x1,
    x3 - x0 + h * x3,
    x0,
    y1 - y0 + g * y1,
    y3 - y0 + h * y3,
    y0,
    g,
    h,
    1,
  ];
}

/** Invert a 3×3 matrix (row-major in, row-major out). Throws if singular. */
export function invert3x3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0) throw new Error('singular matrix — quad is degenerate');
  const inv = 1 / det;

  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

/** Apply a homography to a point (with perspective divide). */
export function applyHomography(m: Mat3, p: Vec2): Vec2 {
  const [x, y] = p;
  const X = m[0] * x + m[1] * y + m[2];
  const Y = m[3] * x + m[4] * y + m[5];
  const W = m[6] * x + m[7] * y + m[8];
  return [X / W, Y / W];
}

/** Repack a row-major {@link Mat3} into a column-major Float32Array (GL upload order). */
export function toColumnMajor(m: Mat3): Float32Array {
  // row-major m[row*3+col] → column-major [col0, col1, col2]
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/**
 * The matrix a perspective filter uploads: it maps a **destination** point
 * (where we're drawing, in `[0,1]`) back to the **source** UV to sample. That's
 * the inverse of {@link squareToQuad} (source→dest), packed column-major for
 * `gl.uniformMatrix3fv`.
 */
export function perspectiveSampleMatrix(quad: Quad): Float32Array {
  return toColumnMajor(invert3x3(squareToQuad(quad)));
}
