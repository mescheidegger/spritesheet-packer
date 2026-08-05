import test from 'node:test';
import assert from 'node:assert/strict';
import { frameName } from '../src/sprite-processor.js';
import { createStoredZip, crc32 } from '../src/zip-writer.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fixedDate = new Date(2024, 0, 2, 3, 4, 5);

function bytes(value) {
  return encoder.encode(value);
}

async function archiveBytes(entries, options = {}) {
  return new Uint8Array(await (await createStoredZip(entries, { timestamp: fixedDate, ...options })).arrayBuffer());
}

function parseZip(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const locals = [];
  let offset = 0;

  while (view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;

    locals.push({
      offset,
      signature: view.getUint32(offset, true),
      versionNeeded: view.getUint16(offset + 4, true),
      flags: view.getUint16(offset + 6, true),
      method: view.getUint16(offset + 8, true),
      time: view.getUint16(offset + 10, true),
      date: view.getUint16(offset + 12, true),
      crc: view.getUint32(offset + 14, true),
      compressedSize,
      uncompressedSize: view.getUint32(offset + 22, true),
      name: decoder.decode(data.slice(nameStart, nameStart + nameLength)),
      contents: data.slice(dataStart, dataStart + compressedSize),
    });

    offset = dataStart + compressedSize;
  }

  const centralDirectoryOffset = offset;
  const central = [];

  while (view.getUint32(offset, true) === 0x02014b50) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;

    central.push({
      offset,
      signature: view.getUint32(offset, true),
      versionNeeded: view.getUint16(offset + 6, true),
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      crc: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      name: decoder.decode(data.slice(nameStart, nameStart + nameLength)),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });

    offset = nameStart + nameLength + extraLength + commentLength;
  }

  const eocd = {
    signature: view.getUint32(offset, true),
    diskEntries: view.getUint16(offset + 8, true),
    totalEntries: view.getUint16(offset + 10, true),
    centralDirectorySize: view.getUint32(offset + 12, true),
    centralDirectoryOffset: view.getUint32(offset + 16, true),
    commentLength: view.getUint16(offset + 20, true),
  };

  return { locals, central, eocd, centralDirectoryOffset };
}

test('CRC-32 matches the standard check vector', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
});

test('one stored file has matching local, central, and EOCD fields', async () => {
  const parsed = parseZip(await archiveBytes([{ filename: 'hello.txt', contents: bytes('hello') }]));
  assert.equal(parsed.locals.length, 1);
  assert.equal(parsed.central.length, 1);
  assert.equal(parsed.locals[0].signature, 0x04034b50);
  assert.equal(parsed.central[0].signature, 0x02014b50);
  assert.equal(parsed.eocd.signature, 0x06054b50);
  assert.equal(parsed.locals[0].method, 0);
  assert.equal(parsed.central[0].method, 0);
  assert.equal(parsed.locals[0].flags, 0x0800);
  assert.equal(parsed.central[0].flags, 0x0800);
  assert.equal(parsed.locals[0].compressedSize, 5);
  assert.equal(parsed.locals[0].uncompressedSize, 5);
  assert.equal(parsed.central[0].compressedSize, 5);
  assert.equal(parsed.central[0].uncompressedSize, 5);
  assert.equal(parsed.central[0].localHeaderOffset, 0);
  assert.equal(parsed.eocd.totalEntries, 1);
  assert.equal(parsed.eocd.diskEntries, 1);
  assert.equal(parsed.eocd.centralDirectoryOffset, parsed.centralDirectoryOffset);
  assert.deepEqual(Array.from(parsed.locals[0].contents), Array.from(bytes('hello')));
});

test('multiple files are written in provided order with correct local offsets', async () => {
  const parsed = parseZip(await archiveBytes([
    { filename: 'a.txt', contents: bytes('a') },
    { filename: 'b.txt', contents: bytes('bb') },
    { filename: 'c.txt', contents: bytes('ccc') },
  ]));
  assert.deepEqual(parsed.locals.map((entry) => entry.name), ['a.txt', 'b.txt', 'c.txt']);
  assert.deepEqual(parsed.central.map((entry) => entry.name), ['a.txt', 'b.txt', 'c.txt']);
  assert.deepEqual(parsed.central.map((entry) => entry.localHeaderOffset), parsed.locals.map((entry) => entry.offset));
  assert.equal(parsed.eocd.totalEntries, 3);
});

test('empty file contents are accepted with zero matching sizes', async () => {
  const parsed = parseZip(await archiveBytes([{ filename: 'empty.bin', contents: new Uint8Array() }]));
  assert.equal(parsed.locals[0].compressedSize, 0);
  assert.equal(parsed.locals[0].uncompressedSize, 0);
  assert.equal(parsed.central[0].compressedSize, 0);
  assert.equal(parsed.central[0].uncompressedSize, 0);
});

test('UTF-8 filenames are encoded and flagged', async () => {
  const parsed = parseZip(await archiveBytes([{ filename: 'café-🙂.txt', contents: bytes('ok') }]));
  assert.equal(parsed.locals[0].name, 'café-🙂.txt');
  assert.equal(parsed.central[0].name, 'café-🙂.txt');
  assert.equal(parsed.locals[0].flags & 0x0800, 0x0800);
  assert.equal(parsed.central[0].flags & 0x0800, 0x0800);
});

test('timestamps are deterministic when a fixed date is supplied', async () => {
  const parsed = parseZip(await archiveBytes([{ filename: 'time.txt', contents: bytes('x') }]));
  const expectedTime = (3 << 11) | (4 << 5) | 2;
  const expectedDate = ((2024 - 1980) << 9) | (1 << 5) | 2;
  assert.equal(parsed.locals[0].time, expectedTime);
  assert.equal(parsed.locals[0].date, expectedDate);
  assert.equal(parsed.central[0].time, expectedTime);
  assert.equal(parsed.central[0].date, expectedDate);
});

test('duplicate and unsafe filenames are rejected', async () => {
  await assert.rejects(() => createStoredZip([{ filename: 'a.txt', contents: bytes('') }, { filename: 'a.txt', contents: bytes('') }]), /Duplicate/);
  await assert.rejects(() => createStoredZip([{ filename: '', contents: bytes('') }]), /empty/);
  await assert.rejects(() => createStoredZip([{ filename: '../a.txt', contents: bytes('') }]), /Unsafe/);
  await assert.rejects(() => createStoredZip([{ filename: 'dir/a.txt', contents: bytes('') }]), /Unsafe/);
});

test('ZIP32 entry-count and size limits are validated', async () => {
  await assert.rejects(() => createStoredZip([], { timestamp: fixedDate }), /at least one/);
  await assert.rejects(() => createStoredZip([{ filename: 'a', contents: bytes('123') }], { timestamp: fixedDate, limits: { maxFileSize: 2 } }), /exceeds ZIP32/);
  await assert.rejects(() => createStoredZip([{ filename: 'a', contents: bytes('1') }, { filename: 'b', contents: bytes('2') }], { timestamp: fixedDate, limits: { maxEntries: 1 } }), /65,535/);
  await assert.rejects(() => createStoredZip([{ filename: 'a', contents: bytes('1') }], { timestamp: fixedDate, limits: { maxArchiveSize: 10 } }), /archive size/);
});

test('generated frame filenames remain in row-major order', async () => {
  const names = Array.from({ length: 6 }, (_, index) => frameName(index, 6));
  const parsed = parseZip(await archiveBytes(names.map((filename, index) => ({ filename, contents: bytes(String(index)) }))));
  assert.deepEqual(parsed.locals.map((entry) => entry.name), ['frame_000.png', 'frame_001.png', 'frame_002.png', 'frame_003.png', 'frame_004.png', 'frame_005.png']);
});
