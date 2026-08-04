const PNG_MIME_TYPE = 'image/png';

/**
 * Export a canvas as a PNG Blob.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 * @throws {Error} When the browser cannot encode the canvas.
 */
export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(
          new Error(
            'The browser could not export the PNG.',
          ),
        );
      },
      PNG_MIME_TYPE,
    );
  });
}

/**
 * Trigger a browser download for a Blob.
 *
 * The temporary object URL and anchor element are released immediately
 * after the download has been initiated.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');

  downloadLink.href = objectUrl;
  downloadLink.download = filename;
  downloadLink.hidden = true;

  document.body.append(downloadLink);

  try {
    downloadLink.click();
  } finally {
    downloadLink.remove();

    // Revoking on the next task gives the browser time to begin reading
    // the object URL after the synthetic click.
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }
}