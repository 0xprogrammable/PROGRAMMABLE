import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedResponseText } from "../read-bounded-response.mjs";

test("reads a bounded response and releases its stream lock", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{\"ok\":true}"));
      controller.close();
    },
  });
  const response = new Response(body, {
    headers: { "content-length": "11" },
  });
  assert.equal(await readBoundedResponseText(response, {
    maximumBytes: 64,
    label: "test response",
  }), "{\"ok\":true}");
  assert.equal(body.locked, false);
});

test("reads many one-byte chunks through one capped destination buffer", async () => {
  const size = 4_096;
  let emitted = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (emitted === size) {
        controller.close();
        return;
      }
      controller.enqueue(Uint8Array.of(97));
      emitted += 1;
    },
  }, { highWaterMark: 1 });
  const text = await readBoundedResponseText(new Response(body), {
    maximumBytes: size,
    label: "test response",
  });
  assert.equal(text, "a".repeat(size));
  assert.equal(emitted, size);
  assert.equal(body.locked, false);
});

test("cancels an adversarial one-byte chunk flood at the fixed read cap", async () => {
  let canceled = false;
  let emitted = 0;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(Uint8Array.of(97));
      emitted += 1;
    },
    cancel() {
      canceled = true;
    },
  }, { highWaterMark: 1 });
  await assert.rejects(readBoundedResponseText(new Response(body), {
    maximumBytes: 65_536,
    label: "test response",
  }), /test response has too many chunks/u);
  assert.equal(emitted, 16_385);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

test("cancels a declared oversized response before buffering", async () => {
  let canceled = false;
  const body = new ReadableStream({
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(readBoundedResponseText(new Response(body, {
    headers: { "content-length": "65" },
  }), {
    maximumBytes: 64,
    label: "test response",
  }), /test response is too large/u);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

test("cancels an oversized chunked response without a content length", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(30));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(readBoundedResponseText(new Response(body), {
    maximumBytes: 64,
    label: "test response",
  }), /test response is too large/u);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

test("cancels a response larger than its small declared length", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(30));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(readBoundedResponseText(new Response(body, {
    headers: { "content-length": "2" },
  }), {
    maximumBytes: 64,
    label: "test response",
  }), /test response is too large/u);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

test("rejects a response without a readable body", async () => {
  await assert.rejects(readBoundedResponseText(new Response(null), {
    maximumBytes: 64,
    label: "test response",
  }), /test response body is unavailable/u);
});

test("cancels a response with a malformed content length", async () => {
  let canceled = false;
  const body = new ReadableStream({
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(readBoundedResponseText(new Response(body, {
    headers: { "content-length": "2x" },
  }), {
    maximumBytes: 64,
    label: "test response",
  }), /test response is too large/u);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});
