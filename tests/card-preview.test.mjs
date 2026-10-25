import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardPreviewQueue, makeCardPreview, CARD_PREVIEW_MAX_SIDE } from '../lib/card-preview.ts';

const item = id => ({ id: String(id), file: new File(['photo'], `${id}.jpg`, { type: 'image/jpeg' }) });
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(check) {
  for (let n = 0; n < 2000; n++) { if (check()) return; await nextTick(); }
  throw new Error('queue did not settle');
}

test('200 photos across consecutive selections share two workers and publish progressively', async () => {
  let active = 0, peak = 0, uiTurns = 0;
  const delivered = [], progress = [];
  const input = Array.from({ length: 200 }, (_, id) => item(id));
  const files = input.map(entry => entry.file);
  const queue = createCardPreviewQueue({
    prepare: async file => {
      active++; peak = Math.max(peak, active);
      await nextTick();
      active--;
      return `blob:${file.name}`;
    },
    yieldToUI: async () => { uiTurns++; await nextTick(); },
    onPreview: (id, url) => { delivered.push([id, url]); return true; },
    onError: () => assert.fail('unexpected failure'),
    onProgress: value => progress.push(value),
  });
  queue.enqueue(input.slice(0, 100));
  queue.enqueue(input.slice(100));
  await until(() => delivered.length > 0);
  assert.ok(delivered.length < 200, 'first results appear before the entire batch finishes');
  await until(() => !queue.busy);
  assert.equal(peak, 2);
  assert.equal(uiTurns, 200);
  assert.deepEqual(delivered.map(([id]) => id), input.map(entry => entry.id));
  assert.deepEqual(input.map(entry => entry.file), files, 'original File references are preserved');
  assert.deepEqual(progress.at(-1), { completed: 200, total: 200, remaining: 0 });
  queue.dispose();
});

test('removed active/pending photos and stale results release URLs without updating removed cards', async () => {
  const released = [], delivered = [], started = [], resolve = new Map();
  const queue = createCardPreviewQueue({
    prepare: file => { started.push(file.name); return new Promise(done => resolve.set(file.name, done)); },
    onPreview: id => { delivered.push(id); return false; },
    onError: () => assert.fail('unexpected failure'),
    onProgress() {}, release: url => released.push(url),
  });
  queue.enqueue([item('a'), item('b'), item('pending')]);
  await until(() => started.length === 2);
  queue.cancel('a'); queue.cancel('pending');
  resolve.get('a.jpg')('blob:a'); resolve.get('b.jpg')('blob:b');
  await until(() => !queue.busy);
  assert.deepEqual(started, ['a.jpg', 'b.jpg']);
  assert.deepEqual(delivered, ['b']);
  assert.deepEqual(released.sort(), ['blob:a', 'blob:b']);
});

test('unmount cancels pending work, drops late callbacks and releases in-flight previews', async () => {
  const finish = [], released = [];
  let callbacks = 0;
  const queue = createCardPreviewQueue({
    prepare: () => new Promise(resolve => finish.push(resolve)),
    onPreview: () => { callbacks++; return true; }, onError: () => callbacks++,
    onProgress: () => callbacks++, release: url => released.push(url),
  });
  queue.enqueue([item(1), item(2), item(3)]);
  await until(() => finish.length === 2);
  queue.dispose();
  const before = callbacks;
  finish[0]('blob:1'); finish[1]('blob:2');
  await until(() => !queue.busy);
  assert.equal(callbacks, before);
  assert.deepEqual(released.sort(), ['blob:1', 'blob:2']);
  assert.equal(finish.length, 2);
});

test('a failed photo does not block later previews and the queue can accept a new batch', async () => {
  const delivered = [], errors = [], progress = [];
  const queue = createCardPreviewQueue({
    prepare: async file => { if (file.name === 'bad.jpg') throw new Error('decode failed'); return `blob:${file.name}`; },
    onPreview: id => { delivered.push(id); return true; }, onError: id => errors.push(id),
    onProgress: value => progress.push(value),
  });
  queue.enqueue([item('bad'), item('good')]);
  await until(() => !queue.busy);
  assert.deepEqual(errors, ['bad']); assert.deepEqual(delivered, ['good']);
  queue.enqueue([item('new')]);
  await until(() => !queue.busy);
  assert.deepEqual(progress.at(-1), { completed: 1, total: 1, remaining: 0 });
  assert.deepEqual(delivered, ['good', 'new']);
});

test('preview decode/draw/encoding cleanup never falls back to displaying the original', async () => {
  const original = { bitmap: globalThis.createImageBitmap, document: globalThis.document, url: URL.createObjectURL };
  let closed = 0, drawError = false, encodeError = false;
  let canvas;
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close() { closed++; } });
  globalThis.document = { createElement() {
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage() { if (drawError) throw new Error('draw'); } }),
      toBlob(done) { assert.equal(this.width, CARD_PREVIEW_MAX_SIDE); done(encodeError ? null : new Blob(['small'])); } };
    return canvas;
  } };
  const urlInputs = [];
  URL.createObjectURL = blob => { urlInputs.push(blob); return 'blob:small'; };
  try {
    const originalFile = item('large').file;
    assert.equal(await makeCardPreview(originalFile), 'blob:small');
    assert.notEqual(urlInputs[0], originalFile);
    assert.equal(closed, 1); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
    drawError = true;
    await assert.rejects(makeCardPreview(originalFile), /draw/);
    assert.equal(closed, 2); assert.equal(canvas.width, 0);
    drawError = false; encodeError = true;
    await assert.rejects(makeCardPreview(originalFile), /preview_encoding_failed/);
    assert.equal(closed, 3); assert.equal(canvas.width, 0);
    assert.equal(urlInputs.length, 1, 'errors never create a URL of the large original');
  } finally {
    globalThis.createImageBitmap = original.bitmap; globalThis.document = original.document; URL.createObjectURL = original.url;
  }
});
