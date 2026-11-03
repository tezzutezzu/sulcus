// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/**
 * In-place radix-2 Cooley-Tukey FFT.
 * `re` and `im` must have the same power-of-two length.
 *
 * The arithmetic below is deliberately plain and unoptimised: it defines the
 * numbers every generated model derives from. Reordering the operations changes
 * every output, so it should not be rewritten casually.
 */
export function fft(re, im) {
  const n = re.length;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly stages.
  for (let len = 2; len <= n; len *= 2) {
    const angle = (-2 * Math.PI) / len;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;

      for (let j = 0; j < len / 2; j++) {
        const u = i + j;
        const v = u + len / 2;
        const tr = wr * re[v] - wi * im[v];
        const ti = wr * im[v] + wi * re[v];

        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;

        // Advance the twiddle factor one step.
        const nextWr = wr * cos - wi * sin;
        wi = wr * sin + wi * cos;
        wr = nextWr;
      }
    }
  }
}
