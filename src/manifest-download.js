/**
 * Return a downloadable manifest that points at the selected PNG basename.
 *
 * The generated sprite or atlas geometry remains unchanged; only the emitted
 * output filename is adjusted so users can rename downloads without
 * regenerating the canvas/blob state.
 *
 * @param {object} manifest
 * @param {string} basename
 * @returns {object}
 */
export function createDownloadableManifest(manifest, basename) {
  return {
    ...manifest,
    output: `${basename}.png`,
  };
}
