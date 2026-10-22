import test from 'node:test';
import assert from 'node:assert/strict';
import { savePendingDocuments, newUploadToken } from './pendingDocuments.js';

test('upload tokens are unique UUIDs', () => {
  const first = newUploadToken();
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(first, newUploadToken());
});

test('confirmed files keep their selected proof and upload to the saved entity only', async () => {
  const calls = [];
  const api = { post: async (...args) => calls.push(args) };
  const pending = [{ uploadToken: '8d3a2be2-6a9e-4b9c-b26f-02d705294789', documentType: 'OTHER', otherName: 'Employee ID', file: new File(['photo'], 'capture.jpg', { type: 'image/jpeg' }) }];
  assert.equal(calls.length, 0);
  const result = await savePendingDocuments(api, {}, '/customers/12/kyc-documents/', pending);
  assert.deepEqual(result.remaining, []);
  assert.equal(calls[0][0], '/customers/12/kyc-documents/');
  assert.equal(calls[0][1].get('other_document_name'), 'Employee ID');
  assert.equal(calls[0][1].get('file').name, 'capture.jpg');
  assert.equal(calls[0][1].get('upload_token'), pending[0].uploadToken);
});
test('partial failure retains remaining files, and retry does not upload successful files twice', async () => {
  const file = new File(['x'], 'id.jpg');
  const pending = [{ documentType: 'AADHAAR', file }, { documentType: 'PAN', file }];
  let count = 0;
  const api = { post: async () => { if (++count === 2) throw new Error('offline'); } };
  const result = await savePendingDocuments(api, {}, '/finance/loans/7/kyc-documents/', pending);
  assert.equal(result.remaining.length, 1);
  assert.ok(result.error);
  await savePendingDocuments(api, {}, '/finance/loans/7/kyc-documents/', result.remaining);
  assert.equal(count, 3);
});
