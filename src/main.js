import './styles.css';

import {
  closeFrames,
  decodeFiles,
  sliceSheet,
} from './image-loader.js';

import {
  createManifest,
  framesHaveMatchingDimensions,
  packFrames,
  processFrames,
} from './sprite-processor.js';

import {
  calculateSheetGrid,
  sanitizeBasename,
  suggestFrameDimensions,
  validateInteger,
  validateSheetDimensions,
} from './validation.js';

import {
  canvasToBlob,
  downloadBlob,
} from './downloads.js';


const BYTES_PER_RGBA_PIXEL = 4;
const BYTES_PER_MEBIBYTE = 1024 ** 2;

const REPROCESSING_MESSAGE =
  'Options changed. Generate again to update the output.';

const EDITABLE_OPTION_IDS = new Set([
  'frame-width',
  'frame-height',
  'target-size',
  'padding',
  'columns',
  'basename',
]);


/**
 * Find a required DOM element.
 *
 * Failing immediately produces a more useful error than allowing a later
 * property access to fail against `null`.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
function getElement(id) {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Required element #${id} was not found.`);
  }

  return element;
}


const form = getElement('app-form');
const fileInput = getElement('file-input');
const folderInput = getElement('folder-input');
const dropZone = getElement('drop-zone');


/**
 * Mutable application state.
 *
 * ImageBitmap resources held by `sourceSheet` or `frames` must be closed
 * before they are discarded.
 */
const state = {
  sourceSheet: null,
  frames: [],
  output: null,
  png: null,
  manifest: null,
  busy: false,
};


/**
 * Return the currently selected input mode.
 *
 * @returns {'sheet' | 'frames'}
 */
function getInputMode() {
  return form.elements.mode.value;
}

/**
 * Show or hide an element using the shared `.hidden` utility class.
 *
 * @param {string} id
 * @param {boolean} hidden
 */
function setHidden(id, hidden) {
  getElement(id).classList.toggle('hidden', hidden);
}

/**
 * Render a collection of values as summary chips.
 *
 * @param {HTMLElement} container
 * @param {string[]} values
 */
function renderSummary(container, values) {
  container.replaceChildren();

  for (const value of values) {
    const item = document.createElement('span');

    item.textContent = value;
    container.append(item);
  }
}

/**
 * Clear all generated output after an input or option changes.
 *
 * @param {string} [message]
 */
function invalidateOutput(message = '') {
  state.output = null;
  state.png = null;
  state.manifest = null;

  getElement('canvas-mount').replaceChildren();

  setHidden('output', true);

  getElement('download-png').disabled = true;
  getElement('download-json').disabled = true;

  if (message) {
    getElement('status').textContent = message;
  }
}

/**
 * Release decoded input resources and clear the current selection.
 */
function disposeInputResources() {
  if (state.sourceSheet) {
    closeFrames([state.sourceSheet]);
  }

  closeFrames(state.frames);

  state.sourceSheet = null;
  state.frames = [];
}

/**
 * Return the decoded input associated with the current mode.
 *
 * A source sheet is represented as one decoded image until generation,
 * when it is sliced into individual frames.
 *
 * @returns {Array}
 */
function getSelectedFrames() {
  if (getInputMode() === 'sheet') {
    return state.sourceSheet
      ? [state.sourceSheet]
      : [];
  }

  return state.frames;
}

/**
 * Populate the detected source-sheet dimensions.
 */
function updateSourceDimensions() {
  const sourceSheet =
    getInputMode() === 'sheet'
      ? state.sourceSheet
      : null;

  getElement('source-width').value =
    sourceSheet?.width ?? '';

  getElement('source-height').value =
    sourceSheet?.height ?? '';

  getElement('detected-size').textContent = sourceSheet
    ? `${sourceSheet.width} × ${sourceSheet.height} px`
    : 'Upload a sheet to detect its source dimensions.';
}

/**
 * Reset the editable frame-dimension fields.
 */
function clearFrameSuggestion() {
  getElement('frame-width').value = '';
  getElement('frame-height').value = '';

  getElement('frame-suggestion').textContent =
    'Enter one frame’s dimensions.';
}

/**
 * Prefill a conservative frame-size suggestion for an apparent strip.
 */
function applyFrameSuggestion() {
  if (!state.sourceSheet) {
    return;
  }

  const suggestion = suggestFrameDimensions(
    state.sourceSheet.width,
    state.sourceSheet.height,
  );

  if (!suggestion) {
    return;
  }

  getElement('frame-width').value = suggestion.width;
  getElement('frame-height').value = suggestion.height;

  getElement('frame-suggestion').textContent =
    `Suggested ${suggestion.width} × ${suggestion.height} ` +
    'from the sheet shape. Verify before generating.';
}

/**
 * Render thumbnails for the current source selection.
 */
function previewFrames() {
  const preview = getElement('source-preview');
  const selectedFrames = getSelectedFrames();

  preview.replaceChildren();

  selectedFrames.forEach((frame, index) => {
    const item = document.createElement('div');
    const previewCanvas = document.createElement('canvas');
    const frameNumber = document.createElement('b');
    const details = document.createElement('p');

    item.className = 'thumb';

    previewCanvas.width = frame.width;
    previewCanvas.height = frame.height;

    const context = previewCanvas.getContext('2d');

    if (!context) {
      throw new Error(
        'This browser could not create a preview canvas.',
      );
    }

    context.imageSmoothingEnabled = false;
    context.drawImage(frame.source, 0, 0);

    frameNumber.textContent = String(index + 1);
    details.textContent =
      `${frame.name} · ${frame.width}×${frame.height}`;

    item.append(
      frameNumber,
      previewCanvas,
      details,
    );

    preview.append(item);
  });

  setHidden('clear-files', selectedFrames.length === 0);

  updateSourceDimensions();
  updateSourceSummary();
  updateTrimWarning();
  validateForm();
}

/**
 * Warn when mismatched individual frame dimensions require independent
 * trimming and therefore cannot preserve one shared animation anchor.
 */
function updateTrimWarning() {
  const hasMismatchedFrames =
    getInputMode() === 'frames' &&
    state.frames.length > 1 &&
    !framesHaveMatchingDimensions(state.frames);

  const shouldShowWarning =
    getElement('trim').checked &&
    hasMismatchedFrames;

  setHidden('trim-warning', !shouldShowWarning);
}

/**
 * Update the source-frame or calculated sheet-grid summary.
 */
function updateSourceSummary() {
  const summary = getElement('source-summary');
  const selectedFrames = getSelectedFrames();
  const values = [];

  if (selectedFrames.length === 0) {
    summary.replaceChildren();
    setHidden('source-summary', true);
    return;
  }

  if (getInputMode() === 'frames') {
    const count = state.frames.length;
    const noun = count === 1 ? 'frame' : 'frames';

    values.push(
      `${count} ${noun} naturally sorted by filename`,
    );
  } else if (state.sourceSheet) {
    const frameWidth = Number(
      getElement('frame-width').value,
    );

    const frameHeight = Number(
      getElement('frame-height').value,
    );

    try {
      const grid = calculateSheetGrid(
        state.sourceSheet.width,
        state.sourceSheet.height,
        frameWidth,
        frameHeight,
      );

      values.push(
        `${grid.columns} columns`,
        `${grid.rows} rows`,
        `${grid.frameCount} frames`,
      );
    } catch {
      // Field validation displays the specific issue beside the input.
    }
  }

  renderSummary(summary, values);
  setHidden('source-summary', values.length === 0);
}

/**
 * Validate the current form and update all inline error messages.
 *
 * @returns {boolean} Whether generation may proceed.
 */
function validateForm() {
  const errors = {
    frameWidth: '',
    frameHeight: '',
    target: '',
    padding: '',
    columns: '',
    file: '',
  };

  if (getInputMode() === 'sheet') {
    const frameWidthValue =
      getElement('frame-width').value;

    const frameHeightValue =
      getElement('frame-height').value;

    errors.frameWidth = validateInteger(
      frameWidthValue,
      {
        label: 'Frame width',
      },
    );

    errors.frameHeight = validateInteger(
      frameHeightValue,
      {
        label: 'Frame height',
      },
    );

    if (
      !errors.frameWidth &&
      !errors.frameHeight &&
      state.sourceSheet
    ) {
      errors.file = validateSheetDimensions(
        state.sourceSheet.width,
        state.sourceSheet.height,
        Number(frameWidthValue),
        Number(frameHeightValue),
      );
    }
  }

  errors.target = validateInteger(
    getElement('target-size').value,
    {
      label: 'Target size',
      optional: true,
    },
  );

  errors.padding = validateInteger(
    getElement('padding').value,
    {
      label: 'Padding',
      minimum: 0,
    },
  );

  if (getElement('layout').value === 'grid') {
    errors.columns = validateInteger(
      getElement('columns').value,
      {
        label: 'Grid columns',
        optional: true,
      },
    );
  }

  getElement('frame-width-error').textContent =
    errors.frameWidth;

  getElement('frame-height-error').textContent =
    errors.frameHeight;

  getElement('target-error').textContent =
    errors.target;

  getElement('padding-error').textContent =
    errors.padding;

  getElement('columns-error').textContent =
    errors.columns;

  getElement('file-error').textContent =
    errors.file;

  const hasSelectedFrames =
    getSelectedFrames().length > 0;

  const hasErrors =
    Object.values(errors).some(Boolean);

  const isValid =
    hasSelectedFrames &&
    !hasErrors &&
    !state.busy;

  getElement('generate').disabled = !isValid;

  return isValid;
}

/**
 * Decode a newly selected or dropped group of files.
 *
 * @param {FileList | File[]} files
 */
async function receiveFiles(files) {
  invalidateOutput();

  getElement('file-error').textContent = '';

  const inputMode = getInputMode();
  const selectedFiles = Array.from(files);

  const filesToDecode =
    inputMode === 'sheet'
      ? selectedFiles.slice(0, 1)
      : selectedFiles;

  disposeInputResources();

  if (inputMode === 'sheet') {
    clearFrameSuggestion();
  }

  const result = await decodeFiles(
    filesToDecode,
    {
      naturalSort: inputMode === 'frames',
    },
  );

  if (inputMode === 'sheet') {
    state.sourceSheet = result.frames[0] || null;
    applyFrameSuggestion();
  } else {
    state.frames = result.frames;
  }

  previewFrames();

  if (result.rejected.length > 0) {
    getElement('file-error').textContent =
      result.rejected.join('; ');
  }

  const count = getSelectedFrames().length;

  getElement('status').textContent = count > 0
    ? `Loaded ${count} image${count === 1 ? '' : 's'}.`
    : 'No usable images were selected.';
}

/**
 * Reset mode-specific state and controls.
 */
function configureMode() {
  invalidateOutput();
  disposeInputResources();
  clearFrameSuggestion();

  const isSheetMode = getInputMode() === 'sheet';

  setHidden('sheet-fields', !isSheetMode);
  setHidden('folder-label', isSheetMode);

  fileInput.multiple = !isSheetMode;
  fileInput.value = '';
  folderInput.value = '';

  getElement('file-plural').textContent =
    isSheetMode ? '' : 's';

  getElement('file-error').textContent = '';

  previewFrames();

  getElement('status').textContent = isSheetMode
    ? 'Grid sheet mode selected.'
    : 'Individual frames mode selected.';
}

/**
 * Read the current packing options from the form.
 *
 * @returns {{
 *   trim: boolean,
 *   targetSize: number | null,
 *   padding: number,
 *   layout: 'row' | 'grid',
 *   columns: number
 * }}
 */
function readProcessingOptions() {
  const targetSizeValue =
    getElement('target-size').value;

  const columnValue =
    getElement('columns').value;

  return {
    trim: getElement('trim').checked,

    targetSize: targetSizeValue
      ? Number(targetSizeValue)
      : null,

    padding: Number(
      getElement('padding').value,
    ),

    layout: getElement('layout').value,

    columns: columnValue
      ? Number(columnValue)
      : 0,
  };
}

/**
 * Produce the individual source frames that enter the processing pipeline.
 *
 * Grid sheets must be sliced before trim or target-size processing. The
 * decoded source sheet must never be processed as one animation frame.
 *
 * @returns {Array}
 */
function getFramesForProcessing() {
  if (getInputMode() === 'frames') {
    return state.frames;
  }

  if (!state.sourceSheet) {
    throw new Error(
      'A decoded source sheet is required.',
    );
  }

  return sliceSheet(
    state.sourceSheet,
    Number(getElement('frame-width').value),
    Number(getElement('frame-height').value),
  ).frames;
}

/**
 * Render output geometry and memory information.
 *
 * @param {object} geometry
 * @param {number} frameCount
 */
function updateOutputSummary(
  geometry,
  frameCount,
) {
  const estimatedBytes =
    geometry.sheetW *
    geometry.sheetH *
    BYTES_PER_RGBA_PIXEL;

  const estimatedMebibytes =
    estimatedBytes / BYTES_PER_MEBIBYTE;

  renderSummary(
    getElement('output-summary'),
    [
      `${geometry.sheetW}×${geometry.sheetH} output`,
      `${frameCount} frames`,
      `${geometry.cellW}×${geometry.cellH} content cell`,
      `${geometry.fullCellW}×${geometry.fullCellH} full cell`,
      `${geometry.rows} rows × ${geometry.columns} columns`,
      `${estimatedMebibytes.toFixed(2)} MiB RGBA`,
    ],
  );
}

/**
 * Yield one animation frame so the busy state can render before processing.
 *
 * @returns {Promise<void>}
 */
function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Convert an unknown thrown value into a readable message.
 *
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}


// ---------------------------------------------------------------------------
// Form and input events
// ---------------------------------------------------------------------------

form.addEventListener('change', (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (
    target instanceof HTMLInputElement &&
    target.name === 'mode'
  ) {
    configureMode();
    return;
  }

  if (
    target === fileInput ||
    target === folderInput
  ) {
    void receiveFiles(target.files);
    return;
  }

  invalidateOutput(REPROCESSING_MESSAGE);

  setHidden(
    'columns-field',
    getElement('layout').value !== 'grid',
  );

  updateTrimWarning();
  updateSourceSummary();
  validateForm();
});

form.addEventListener('input', (event) => {
  const target = event.target;

  if (
    !(target instanceof HTMLElement) ||
    !EDITABLE_OPTION_IDS.has(target.id)
  ) {
    return;
  }

  invalidateOutput();
  updateSourceSummary();
  validateForm();
});

dropZone.addEventListener('click', (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const shouldOpenPicker =
    target === dropZone ||
    target.tagName === 'STRONG' ||
    target.tagName === 'SPAN';

  if (shouldOpenPicker) {
    fileInput.click();
  }
});

dropZone.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  fileInput.click();
});

for (const eventType of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventType, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}

for (const eventType of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventType, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}

dropZone.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files) {
    void receiveFiles(event.dataTransfer.files);
  }
});

getElement('clear-files').addEventListener(
  'click',
  () => {
    invalidateOutput();
    disposeInputResources();
    clearFrameSuggestion();

    fileInput.value = '';
    folderInput.value = '';

    previewFrames();

    getElement('status').textContent =
      'Selection cleared.';
  },
);


// ---------------------------------------------------------------------------
// Sprite-sheet generation
// ---------------------------------------------------------------------------

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!validateForm()) {
    return;
  }

  state.busy = true;

  validateForm();

  getElement('generate').textContent =
    'Processing…';

  getElement('status').textContent =
    'Processing frames locally…';

  await waitForNextPaint();

  try {
    const sourceFrames = getFramesForProcessing();
    const options = readProcessingOptions();

    const processedFrames = processFrames(
      sourceFrames,
      options.trim,
      options.targetSize,
    );

    const packed = packFrames(
      processedFrames,
      options,
    );

    const basename = sanitizeBasename(
      getElement('basename').value,
    );

    getElement('basename').value = basename;

    const png = await canvasToBlob(packed.canvas);

    const manifest = createManifest(
      basename,
      options,
      packed.geometry,
      processedFrames,
    );

    state.png = png;
    state.manifest = manifest;
    state.output = packed;

    getElement('canvas-mount').replaceChildren(
      packed.canvas,
    );

    updateOutputSummary(
      packed.geometry,
      processedFrames.length,
    );

    setHidden('output', false);

    getElement('download-png').disabled = false;
    getElement('download-json').disabled = false;

    getElement('status').textContent =
      'Sprite sheet generated successfully.';

    getElement('output').scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  } catch (error) {
    invalidateOutput();

    getElement('file-error').textContent =
      `Could not generate output: ${errorMessage(error)}`;

    getElement('status').textContent =
      'Generation failed.';
  } finally {
    state.busy = false;

    getElement('generate').textContent =
      'Generate sprite sheet';

    validateForm();
  }
});


// ---------------------------------------------------------------------------
// Downloads and lifecycle
// ---------------------------------------------------------------------------

getElement('download-png').addEventListener(
  'click',
  () => {
    if (!state.png) {
      return;
    }

    const basename = sanitizeBasename(
      getElement('basename').value,
    );

    downloadBlob(
      state.png,
      `${basename}.png`,
    );
  },
);

getElement('download-json').addEventListener(
  'click',
  () => {
    if (!state.manifest) {
      return;
    }

    const basename = sanitizeBasename(
      getElement('basename').value,
    );

    const contents = JSON.stringify(
      state.manifest,
      null,
      2,
    );

    const blob = new Blob(
      [contents],
      {
        type: 'application/json',
      },
    );

    downloadBlob(
      blob,
      `${basename}.json`,
    );
  },
);

form.addEventListener('reset', () => {
  // Wait until the browser has restored the form's default values.
  setTimeout(() => {
    configureMode();

    getElement('status').textContent =
      'Application reset.';
  }, 0);
});

window.addEventListener(
  'beforeunload',
  disposeInputResources,
);

configureMode();