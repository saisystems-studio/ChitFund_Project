import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraSession, cameraError } from './cameraSession.js';

const setup = () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const video = { srcObject: null, play: async () => {}, readyState: 2, videoWidth: 640, videoHeight: 480 };
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob: cb => cb(new Blob(['photo'], { type: 'image/jpeg' })) };
  const session = new CameraSession({ getUserMedia: async () => stream, canvas: () => canvas });
  return { session, video, stopped: () => stopped };
};

test('camera stays connected during preview and retake, and closes all tracks', async () => {
  const { session, video, stopped } = setup();
  await session.open(video);
  const photo = await session.capture(video);
  assert.equal(photo.type, 'image/jpeg');
  assert.ok(video.srcObject);
  assert.equal((await session.capture(video)).type, 'image/jpeg');
  session.close();
  session.close();
  assert.equal(stopped(), 1);
});
test('capture rejects a camera without a ready frame', async () => {
  const { session, video } = setup();
  await session.open(video);
  video.videoWidth = 0;
  await assert.rejects(session.capture(video), /ready/);
  session.close();
});
test('cancel while requesting permission stops a late stream', async () => {
  let resolve, stopped = 0;
  const session = new CameraSession({ getUserMedia: () => new Promise(r => { resolve = r; }) });
  const pending = session.open({});
  session.close();
  resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  assert.equal(await pending, false);
  assert.equal(stopped, 1);
});
test('cancel during encoding discards the photo', async () => {
  const { session, video } = setup();
  await session.open(video);
  let encode;
  session.canvas = () => ({ getContext: () => ({ drawImage() {} }), toBlob: cb => { encode = cb; } });
  const pending = session.capture(video);
  session.close();
  encode(new Blob(['photo']));
  assert.equal(await pending, null);
});
test('permission, missing device, unsupported and busy errors are useful', () => {
  assert.match(cameraError({ name: 'NotAllowedError' }), /permission/i);
  assert.match(cameraError({ name: 'NotFoundError' }), /camera.*found/i);
  assert.match(cameraError({ name: 'NotReadableError' }), /in use/i);
  assert.match(cameraError({ name: 'UnsupportedError' }), /HTTPS/i);
});
