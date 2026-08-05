const ZIP_MIME_TYPE = 'application/zip';
const ZIP32_MAX_UINT16 = 0xffff;
const ZIP32_MAX_UINT32 = 0xffffffff;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED_TO_EXTRACT = 10;
const VERSION_MADE_BY = 20;
const STORE_METHOD = 0;
const UTF8_FILENAME_FLAG = 0x0800;
const DOS_EPOCH_YEAR = 1980;
const MAX_DOS_YEAR = 2107;

const textEncoder = new TextEncoder();
let crcTable;

/**
 * Calculate a CRC-32 checksum.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('CRC-32 input must be a Uint8Array.');
  }

  crcTable ||= createCrcTable();

  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Create a ZIP archive using stored entries and ZIP32 structures.
 *
 * @param {Iterable<{filename: string, contents: Blob | Uint8Array}>} entries
 * @param {object} [options]
 * @param {Date} [options.timestamp]
 * @param {object} [options.limits] Test-only ZIP32 limit overrides.
 * @returns {Promise<Blob>}
 */
export async function createStoredZip(entries, { timestamp = new Date(), limits = {} } = {}) {
  const entryList = Array.from(entries ?? []);

  validateEntryCount(entryList.length, limits.maxEntries ?? ZIP32_MAX_UINT16);

  const normalizedEntries = await Promise.all(
    entryList.map((entry) => normalizeEntry(entry, limits.maxFileSize ?? ZIP32_MAX_UINT32)),
  );

  validateFilenames(normalizedEntries);

  const { time, date } = encodeDosTimestamp(timestamp);
  const parts = [];
  const centralDirectoryRecords = [];
  let offset = 0;

  for (const entry of normalizedEntries) {
    assertZip32Limit(offset, limits.maxOffset ?? ZIP32_MAX_UINT32, 'ZIP entry offset exceeds ZIP32 limits.');

    const localHeader = createLocalFileHeader(entry, time, date);
    parts.push(localHeader, entry.data);
    centralDirectoryRecords.push(createCentralDirectoryHeader(entry, time, date, offset));

    offset = assertZip32Addition(
      offset,
      localHeader.byteLength + entry.data.byteLength,
      limits.maxArchiveSize ?? ZIP32_MAX_UINT32,
      'ZIP archive size exceeds ZIP32 limits.',
    );
  }

  const centralDirectoryOffset = offset;

  for (const record of centralDirectoryRecords) {
    parts.push(record);
    offset = assertZip32Addition(
      offset,
      record.byteLength,
      limits.maxArchiveSize ?? ZIP32_MAX_UINT32,
      'ZIP archive size exceeds ZIP32 limits.',
    );
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  assertZip32Limit(centralDirectorySize, limits.maxCentralDirectorySize ?? ZIP32_MAX_UINT32, 'ZIP central directory exceeds ZIP32 limits.');

  const eocd = createEndOfCentralDirectory(entryList.length, centralDirectorySize, centralDirectoryOffset);
  parts.push(eocd);

  assertZip32Addition(
    offset,
    eocd.byteLength,
    limits.maxArchiveSize ?? ZIP32_MAX_UINT32,
    'ZIP archive size exceeds ZIP32 limits.',
  );

  return new Blob(parts, { type: ZIP_MIME_TYPE });
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }

    table[index] = value >>> 0;
  }

  return table;
}

async function normalizeEntry(entry, maxFileSize) {
  if (!entry || typeof entry.filename !== 'string') {
    throw new TypeError('Each ZIP entry must include a filename.');
  }

  const data = await readEntryContents(entry.contents);
  assertZip32Limit(data.byteLength, maxFileSize, `File "${entry.filename}" exceeds ZIP32 limits.`);
  const encodedFilename = textEncoder.encode(entry.filename);
  assertZip32Limit(encodedFilename.byteLength, ZIP32_MAX_UINT16, `Filename "${entry.filename}" exceeds ZIP32 field limits.`);

  return {
    filename: entry.filename,
    encodedFilename,
    data,
    crc: crc32(data),
  };
}

async function readEntryContents(contents) {
  if (contents instanceof Uint8Array) {
    return contents;
  }

  if (typeof Blob !== 'undefined' && contents instanceof Blob) {
    assertZip32Limit(contents.size, ZIP32_MAX_UINT32, 'File exceeds ZIP32 limits.');
    return new Uint8Array(await contents.arrayBuffer());
  }

  throw new TypeError('ZIP entry contents must be a Blob or Uint8Array.');
}

function validateEntryCount(count, maxEntries) {
  if (count === 0) {
    throw new RangeError('ZIP archive must contain at least one entry.');
  }

  assertZip32Limit(count, maxEntries, 'ZIP archive cannot contain more than 65,535 entries.');
}

function validateFilenames(entries) {
  const filenames = new Set();

  for (const { filename } of entries) {
    if (filename.length === 0) {
      throw new Error('ZIP filenames cannot be empty.');
    }

    if (filename.includes('/') || filename.includes('\\') || filename === '..' || filename.includes('..')) {
      throw new Error(`Unsafe ZIP filename rejected: ${filename}`);
    }

    if (filenames.has(filename)) {
      throw new Error(`Duplicate ZIP filename rejected: ${filename}`);
    }

    filenames.add(filename);
  }
}

function createLocalFileHeader(entry, time, date) {
  const header = new Uint8Array(30 + entry.encodedFilename.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, VERSION_NEEDED_TO_EXTRACT, true);
  view.setUint16(6, UTF8_FILENAME_FLAG, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.byteLength, true);
  view.setUint32(22, entry.data.byteLength, true);
  view.setUint16(26, entry.encodedFilename.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(entry.encodedFilename, 30);

  return header;
}

function createCentralDirectoryHeader(entry, time, date, localHeaderOffset) {
  const header = new Uint8Array(46 + entry.encodedFilename.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, VERSION_MADE_BY, true);
  view.setUint16(6, VERSION_NEEDED_TO_EXTRACT, true);
  view.setUint16(8, UTF8_FILENAME_FLAG, true);
  view.setUint16(10, STORE_METHOD, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.byteLength, true);
  view.setUint32(24, entry.data.byteLength, true);
  view.setUint16(28, entry.encodedFilename.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(entry.encodedFilename, 46);

  return header;
}

function createEndOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);

  view.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return record;
}

function encodeDosTimestamp(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError('ZIP timestamp must be a valid Date.');
  }

  const year = Math.min(Math.max(date.getFullYear(), DOS_EPOCH_YEAR), MAX_DOS_YEAR);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - DOS_EPOCH_YEAR) << 9) | (month << 5) | day,
  };
}

function assertZip32Limit(value, limit, message) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) {
    throw new RangeError(message);
  }
}

function assertZip32Addition(current, addition, limit, message) {
  const next = current + addition;
  assertZip32Limit(next, limit, message);
  return next;
}
