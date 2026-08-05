export const RESOURCE_LIMITS = Object.freeze({
  maxFiles: 512,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalFileBytes: 100 * 1024 * 1024,

  maxImageDimension: 16_384,
  maxImagePixels: 32_000_000,
  maxTotalDecodedPixels: 64_000_000,

  maxFrameCount: 2_048,

  maxOutputDimension: 16_384,
  maxOutputPixels: 32_000_000,
});

const BYTES_PER_RGBA_PIXEL = 4;
const BYTES_PER_MEBIBYTE = 1024 ** 2;

export function assertSafeInteger(label, value, { minimum = 0 } = {}) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer of at least ${minimum}.`);
  }
  return value;
}

export function safeAdd(label, ...values) {
  let total = 0;
  for (const value of values) {
    assertSafeInteger(label, value);
    total += value;
    assertSafeInteger(label, total);
  }
  return total;
}

export function safeMultiply(label, ...values) {
  let product = 1;
  for (const value of values) {
    assertSafeInteger(label, value);
    product *= value;
    assertSafeInteger(label, product);
  }
  return product;
}

export function formatBytes(bytes) {
  assertSafeInteger('Byte count', bytes);
  if (bytes === 0) return '0 bytes';
  const mib = bytes / BYTES_PER_MEBIBYTE;
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

export function formatPixels(pixels) {
  assertSafeInteger('Pixel count', pixels);
  return pixels.toLocaleString('en-US');
}

export function validateFiles(files, limits = RESOURCE_LIMITS) {
  const list = Array.from(files);
  if (list.length > limits.maxFiles) {
    throw new RangeError(`This selection contains ${list.length} images; the maximum is ${limits.maxFiles}.`);
  }

  let total = 0;
  for (const file of list) {
    const size = assertSafeInteger(`${file.name} file size`, file.size);
    if (size > limits.maxFileBytes) {
      throw new RangeError(`${file.name} is ${formatBytes(size)}; the maximum file size is ${formatBytes(limits.maxFileBytes)}.`);
    }
    total = safeAdd('Total file size', total, size);
  }

  if (total > limits.maxTotalFileBytes) {
    throw new RangeError(`This selection is ${formatBytes(total)}; the maximum combined file size is ${formatBytes(limits.maxTotalFileBytes)}.`);
  }

  return { count: list.length, bytes: total };
}

export function imagePixelCount(width, height) {
  assertSafeInteger('Image width', width, { minimum: 1 });
  assertSafeInteger('Image height', height, { minimum: 1 });
  return safeMultiply('Image pixel count', width, height);
}

export function validateDecodedImage(name, width, height, limits = RESOURCE_LIMITS) {
  const pixels = imagePixelCount(width, height);
  if (width > limits.maxImageDimension || height > limits.maxImageDimension) {
    throw new RangeError(`${name} decodes to ${width} × ${height}; the maximum image dimension is ${formatPixels(limits.maxImageDimension)} pixels.`);
  }
  if (pixels > limits.maxImagePixels) {
    throw new RangeError(`${name} decodes to ${formatPixels(pixels)} pixels; the maximum is ${formatPixels(limits.maxImagePixels)}.`);
  }
  return { width, height, pixels };
}

export function validateTotalDecodedPixels(totalPixels, nextPixels, limits = RESOURCE_LIMITS) {
  const total = safeAdd('Total decoded pixels', totalPixels, nextPixels);
  if (total > limits.maxTotalDecodedPixels) {
    throw new RangeError(`This decoded selection contains ${formatPixels(total)} pixels; the maximum is ${formatPixels(limits.maxTotalDecodedPixels)}.`);
  }
  return total;
}

export function validateFrameCount(frameCount, limits = RESOURCE_LIMITS) {
  assertSafeInteger('Frame count', frameCount, { minimum: 1 });
  if (frameCount > limits.maxFrameCount) {
    throw new RangeError(`This sheet would create ${formatPixels(frameCount)} frames; the maximum is ${formatPixels(limits.maxFrameCount)}.`);
  }
  return frameCount;
}

export function validateCanvasAllocation(width, height, label = 'This layout', limits = RESOURCE_LIMITS) {
  const pixels = imagePixelCount(width, height);
  if (width > limits.maxOutputDimension || height > limits.maxOutputDimension) {
    throw new RangeError(`${label} would create a ${formatPixels(width)} × ${formatPixels(height)} canvas. The maximum output dimension is ${formatPixels(limits.maxOutputDimension)} pixels.`);
  }
  if (pixels > limits.maxOutputPixels) {
    throw new RangeError(`${label} would create ${formatPixels(pixels)} pixels; the maximum output size is ${formatPixels(limits.maxOutputPixels)} pixels.`);
  }
  return {
    width,
    height,
    pixels,
    rgbaBytes: safeMultiply('RGBA byte estimate', pixels, BYTES_PER_RGBA_PIXEL),
  };
}

export function validateSheetSlicingPlan(sheetWidth, sheetHeight, frameWidth, frameHeight, limits = RESOURCE_LIMITS) {
  validateDecodedImage('Source sheet', sheetWidth, sheetHeight, limits);
  validateCanvasAllocation(frameWidth, frameHeight, 'Each sliced frame', limits);
  const columns = sheetWidth / frameWidth;
  const rows = sheetHeight / frameHeight;
  assertSafeInteger('Sheet columns', columns, { minimum: 1 });
  assertSafeInteger('Sheet rows', rows, { minimum: 1 });
  const frameCount = safeMultiply('Frame count', columns, rows);
  validateFrameCount(frameCount, limits);
  return { columns, rows, frameCount };
}
