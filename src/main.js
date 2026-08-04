import './styles.css';
import { decodeFiles, sliceSheet, closeFrames } from './image-loader.js';
import { processFrame, packFrames, createManifest } from './sprite-processor.js';
import { validateInteger, validateSheetDimensions, sanitizeBasename } from './validation.js';
import { canvasToBlob, downloadBlob } from './downloads.js';

const $ = (id) => document.getElementById(id);
const state = { frames: [], output: null, png: null, manifest: null, busy: false };
const form = $('app-form'); const fileInput = $('file-input'); const dropZone = $('drop-zone');

function mode() { return form.elements.mode.value; }
function setHidden(id, hidden) { $(id).classList.toggle('hidden', hidden); }
function invalidate(message = '') { state.output = null; state.png = null; state.manifest = null; $('canvas-mount').replaceChildren(); setHidden('output', true); $('download-png').disabled = true; $('download-json').disabled = true; if (message) $('status').textContent = message; }
function disposeFrames() { closeFrames(state.frames); state.frames = []; }

function previewFrames() {
  const mount = $('source-preview'); mount.replaceChildren();
  state.frames.forEach((frame, index) => { const item = document.createElement('div'); item.className = 'thumb'; const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height; const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false; context.drawImage(frame.source, 0, 0); const number = document.createElement('b'); number.textContent = index + 1; const detail = document.createElement('p'); detail.textContent = `${frame.name} · ${frame.width}×${frame.height}`; item.append(number, canvas, detail); mount.append(item); });
  setHidden('clear-files', !state.frames.length); updateSheetSummary(); validate();
}

function updateSheetSummary() {
  const summary = $('source-summary'); summary.replaceChildren();
  if (!state.frames.length) return setHidden('source-summary', true);
  const source = state.frames[0]; const values = mode() === 'sheet' ? [`Source ${source.width}×${source.height}`] : [`${state.frames.length} ordered frame${state.frames.length === 1 ? '' : 's'}`];
  if (mode() === 'sheet') { const w = Number($('frame-width').value), h = Number($('frame-height').value); if (w > 0 && h > 0 && !(source.width % w) && !(source.height % h)) values.push(`${source.width / w} columns`, `${source.height / h} rows`, `${source.width / w * source.height / h} frames`); }
  values.forEach((value) => { const span = document.createElement('span'); span.textContent = value; summary.append(span); }); setHidden('source-summary', false);
}

function validate() {
  const errors = {};
  if (mode() === 'sheet') { errors.frameWidth = validateInteger($('frame-width').value, { label: 'Frame width' }); errors.frameHeight = validateInteger($('frame-height').value, { label: 'Frame height' }); if (!errors.frameWidth && !errors.frameHeight && state.frames.length) errors.file = validateSheetDimensions(state.frames[0].width, state.frames[0].height, Number($('frame-width').value), Number($('frame-height').value)); }
  errors.target = validateInteger($('target-size').value, { label: 'Target size', optional: true }); errors.padding = validateInteger($('padding').value, { label: 'Padding', minimum: 0 }); errors.columns = $('layout').value === 'grid' ? validateInteger($('columns').value, { label: 'Grid columns', optional: true }) : '';
  $('frame-width-error').textContent = errors.frameWidth || ''; $('frame-height-error').textContent = errors.frameHeight || ''; $('target-error').textContent = errors.target; $('padding-error').textContent = errors.padding; $('columns-error').textContent = errors.columns; $('file-error').textContent = errors.file || '';
  const valid = state.frames.length && !Object.values(errors).some(Boolean) && !state.busy; $('generate').disabled = !valid; return valid;
}

async function receiveFiles(files) {
  invalidate(); $('file-error').textContent = ''; const list = mode() === 'sheet' ? [...files].slice(0, 1) : [...files];
  disposeFrames(); const result = await decodeFiles(list); state.frames = result.frames; if (result.rejected.length) $('file-error').textContent = result.rejected.join('; '); previewFrames(); $('status').textContent = state.frames.length ? `Loaded ${state.frames.length} image${state.frames.length === 1 ? '' : 's'}.` : 'No usable images were selected.';
}

function configureMode() {
  invalidate(); disposeFrames(); previewFrames(); const sheet = mode() === 'sheet'; setHidden('sheet-fields', !sheet); setHidden('folder-label', sheet); fileInput.multiple = !sheet; $('file-plural').textContent = sheet ? '' : 's'; fileInput.value = ''; $('folder-input').value = ''; $('file-error').textContent = ''; $('status').textContent = sheet ? 'Grid sheet mode selected.' : 'Individual frames mode selected.';
}

form.addEventListener('change', (event) => { if (event.target.name === 'mode') return configureMode(); if (event.target === fileInput || event.target === $('folder-input')) return receiveFiles(event.target.files); invalidate('Options changed. Generate again to update the output.'); setHidden('columns-field', $('layout').value !== 'grid'); setHidden('trim-warning', !$('trim').checked && !$('target-size').value); updateSheetSummary(); validate(); });
form.addEventListener('input', (event) => { if (['frame-width','frame-height','target-size','padding','columns','basename'].includes(event.target.id)) { invalidate(); updateSheetSummary(); validate(); setHidden('trim-warning', !$('trim').checked && !$('target-size').value); } });
dropZone.addEventListener('click', (event) => { if (event.target === dropZone || event.target.tagName === 'STRONG' || event.target.tagName === 'SPAN') fileInput.click(); });
dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });
for (const type of ['dragenter','dragover']) dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const type of ['dragleave','drop']) dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', (event) => receiveFiles(event.dataTransfer.files));
$('clear-files').addEventListener('click', () => { invalidate(); disposeFrames(); fileInput.value = ''; $('folder-input').value = ''; previewFrames(); $('status').textContent = 'Selection cleared.'; });

form.addEventListener('submit', async (event) => {
  event.preventDefault(); if (!validate()) return; state.busy = true; validate(); $('generate').textContent = 'Processing…'; $('status').textContent = 'Processing frames locally…'; await new Promise(requestAnimationFrame);
  try {
    let sourceFrames = state.frames; if (mode() === 'sheet') sourceFrames = sliceSheet(state.frames[0], Number($('frame-width').value), Number($('frame-height').value)).frames;
    const options = { trim: $('trim').checked, targetSize: $('target-size').value ? Number($('target-size').value) : null, padding: Number($('padding').value), layout: $('layout').value, columns: $('columns').value ? Number($('columns').value) : 0 };
    const processed = sourceFrames.map((frame) => processFrame(frame, options.trim, options.targetSize)); const packed = packFrames(processed, options); const basename = sanitizeBasename($('basename').value); $('basename').value = basename;
    state.png = await canvasToBlob(packed.canvas); state.manifest = createManifest(basename, options, packed.geometry, processed); state.output = packed;
    $('canvas-mount').replaceChildren(packed.canvas); const g = packed.geometry; const memory = g.sheetW * g.sheetH * 4; $('output-summary').innerHTML = [`${g.sheetW}×${g.sheetH} output`, `${processed.length} frames`, `${g.cellW}×${g.cellH} content cell`, `${g.fullCellW}×${g.fullCellH} full cell`, `${g.rows} rows × ${g.columns} columns`, `${(memory / 1048576).toFixed(2)} MiB RGBA`].map((text) => `<span>${text}</span>`).join('');
    setHidden('output', false); $('download-png').disabled = false; $('download-json').disabled = false; $('status').textContent = 'Sprite sheet generated successfully.'; $('output').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { invalidate(); $('file-error').textContent = `Could not generate output: ${error.message}`; $('status').textContent = 'Generation failed.'; }
  finally { state.busy = false; $('generate').textContent = 'Generate sprite sheet'; validate(); }
});
$('download-png').addEventListener('click', () => state.png && downloadBlob(state.png, `${sanitizeBasename($('basename').value)}.png`));
$('download-json').addEventListener('click', () => state.manifest && downloadBlob(new Blob([JSON.stringify(state.manifest, null, 2)], { type: 'application/json' }), `${sanitizeBasename($('basename').value)}.json`));
form.addEventListener('reset', () => setTimeout(() => { invalidate(); disposeFrames(); previewFrames(); configureMode(); $('status').textContent = 'Application reset.'; }, 0));
window.addEventListener('beforeunload', disposeFrames); configureMode();
