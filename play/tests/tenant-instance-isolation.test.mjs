/** Host-only real Wasm32 fixture, compiled from a tiny C counter with clang 17.
 * This does NOT establish that the pinned Atto source compiler emits a private
 * linear memory or that a browser/Node Worker has run; separate gates do that.
 * The counter is stored in the Wasm instance's exported linear memory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActorHost, MAX_ACTORS, MAX_MAILBOX } from '../src/actor-host.js';
import { guestImports } from '../src/guest.js';

// wasm32, private defined memory, exported actor_init and actor_receive.
// Imports only atto.print_i64 and atto.print_newline.
const fixture = 'AGFzbQEAAAABFgVgAX4AYAAAYAF/AGADf35+AGAAAX4CJwIEYXR0bwlwcmludF9pNjQAAARhdHRvDXByaW50X25ld2xpbmUAAQMEAwIDBAQFAXABAQEFBQEBAoAIBggBfwFBkIgECwcuBAZtZW1vcnkCAAphY3Rvcl9pbml0AAINYWN0b3JfcmVjZWl2ZQADBG1haW4ABArjAQM2AwN/AX4BfyOAgICAACEBQRAhAiABIAJrIQMgAyAANgIMQgAhBEEAIQUgBSAENwOAiICAAA8LnQEHA38BfgF/An4CfwF+An8jgICAgAAhA0EgIQQgAyAEayEFIAUkgICAgAAgBSAANgIcIAUgATcDECAFIAI3AwggBSkDECEGQQAhByAHKQOAiICAACEIIAggBnwhCUEAIQogCiAJNwOAiICAAEEAIQsgCykDgIiAgAAhDCAMEICAgIAAEIGAgIAAQSAhDSAFIA1qIQ4gDiSAgICAAA8LCwEBfkIqIQAgAA8LAGsEbmFtZQANDGZpeHR1cmUud2FzbQFBBQAJcHJpbnRfaTY0AQ1wcmludF9uZXdsaW5lAgphY3Rvcl9pbml0Aw1hY3Rvcl9yZWNlaXZlBAlhdHRvX21haW4HEgEAD19fc3RhY2tfcG9pbnRlcgB/CXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQVjbGFuZ18xNy4wLjAgKGh0dHBzOi8vZ2l0aHViLmNvbS9zd2lmdGxhbmcvbGx2bS1wcm9qZWN0LmdpdCAxMDk5OWI2ZDAzNGZlMzE4ZjNkNTZjODNiZGRiNjU3MjU5M2E4YmIwKQBJD3RhcmdldF9mZWF0dXJlcwQrCm11bHRpdmFsdWUrD211dGFibGUtZ2xvYmFscysPcmVmZXJlbmNlLXR5cGVzKwhzaWduLWV4dA==';
const module = new WebAssembly.Module(Buffer.from(fixture, 'base64'));

test('module reuse yields distinct private Wasm32 memory objects', () => {
  const out = { text: '', truncated: false };
  const a = new WebAssembly.Instance(module, guestImports(module, out).imports);
  const b = new WebAssembly.Instance(module, guestImports(module, out).imports);
  assert.ok(a.exports.memory instanceof WebAssembly.Memory);
  assert.ok(b.exports.memory instanceof WebAssembly.Memory);
  assert.notStrictEqual(a.exports.memory, b.exports.memory);
  assert.notStrictEqual(a.exports.memory.buffer, b.exports.memory.buffer);
  assert.ok(!(a.exports.memory.buffer instanceof SharedArrayBuffer));
});

test('tenant schedules independent actor states in round robin FIFO', async () => {
  const out = { text: '', truncated: false };
  const host = createActorHost({ module, names: ['Counter'], out });
  const a = host.spawn(0), b = host.spawn(0);
  host.send(a, 40n); host.send(a, 2n); host.send(b, 7n);
  assert.equal(await host.drain(), null);
  assert.equal(out.text, '40\n7\n42\n');
  host.close();
});

test('actor admissions, payloads and lifetime mail are bounded', () => {
  const host = createActorHost({ module, names: ['Counter'], out: { text: '', truncated: false } });
  assert.throws(() => host.send(0, 1n), /invalid actor reference/);
  for (let i = 0; i < MAX_ACTORS; i++) host.spawn(0);
  assert.throws(() => host.spawn(0), /at most 16 actors/);
  assert.throws(() => host.send(0, 1), /signed 64-bit/);
  assert.throws(() => host.send(0, 2n ** 63n), /signed 64-bit/);
  for (let i = 0; i < MAX_MAILBOX; i++) host.send(0, 1n);
  assert.throws(() => host.send(0, 1n), /already has 10000 messages/);
  host.close();
  assert.throws(() => host.send(0, 1n), /closed/);
});

test('scheduler yields between bounded batches, not during guest turn', async () => {
  let yields = 0;
  const out = { text: '', truncated: false };
  const host = createActorHost({ module, names: ['Counter'], out,
    yieldTurn: async () => { yields++; } });
  const ref = host.spawn(0);
  for (let i = 0; i < 65; i++) host.send(ref, 1n);
  assert.equal(await host.drain(), null);
  assert.equal(yields, 1);
  assert.equal(out.text.trim().split('\n').length, 65);
  host.close();
});
