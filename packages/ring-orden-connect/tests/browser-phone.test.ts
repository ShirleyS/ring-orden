import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserPhoneUrl,
  handleBrowserPhonePopupClosed,
  handleBrowserPhoneMuteRequest,
  readBrowserPhoneEvent,
  withDeadline,
} from "../src/browser-phone.ts";
const source = {};
const event = (
  data: unknown,
  origin = "https://phone.example",
  sender: unknown = source,
) => ({ data, origin, source: sender });
const valid = {
  protocol: "browser-phone",
  v: 1,
  session: "nonce",
  type: "message.request",
  id: "msg1",
  text: "Hello",
};
test("caller bridge accepts only the selected frame, origin, session and validated actions", () => {
  const read = (input: ReturnType<typeof event>) =>
    readBrowserPhoneEvent(input, source, "https://phone.example", "nonce");
  assert.deepEqual(read(event(valid)), valid);
  assert.equal(read(event(valid, "https://evil.example")), null);
  assert.equal(read(event(valid, undefined, {})), null);
  for (const change of [
    { session: "other" },
    { protocol: "other" },
    { v: 2 },
    { type: "message.request", text: "" },
    { type: "call.mute.request", muted: "yes" },
    { type: "call.volume.request", volume: 2 },
    { type: "call.volume.request", volume: NaN },
    { type: "transcript" },
  ])
    assert.equal(read(event({ ...valid, ...change })), null);
  assert.ok(read(event({ ...valid, type: "call.request" })));
});
test("launch URL identifies this exact parent and instance without credentials", () => {
  const url = new URL(
    browserPhoneUrl(
      "https://phone.example/path",
      "https://ring.example",
      "abc123",
    ),
  );
  assert.equal(url.origin, "https://phone.example");
  assert.equal(url.pathname, "/integration");
  assert.equal(url.searchParams.get("parent_origin"), "https://ring.example");
  assert.equal(url.searchParams.get("session"), "abc123");
  assert.equal(url.searchParams.get("embed"), "1");
});
test("deadline returns success or rejects a pending stage", async () => {
  assert.equal(await withDeadline(Promise.resolve("ok"), 20, "stage"), "ok");
  await assert.rejects(
    withDeadline(new Promise(() => {}), 5, "Microphone timed out"),
    /Microphone timed out/,
  );
});

test("closing the caller popup stops the live call before restoring its embedded peer", () => {
  const actions: string[] = [];
  const onStop = () => {
    actions.push("stop SDK session");
  };
  const restore = () => {
    actions.push("restore embedded peer");
  };
  assert.equal(handleBrowserPhonePopupClosed(null, onStop, restore), false);
  assert.equal(
    handleBrowserPhonePopupClosed({ closed: false }, onStop, restore),
    false,
  );
  assert.deepEqual(actions, []);
  assert.equal(
    handleBrowserPhonePopupClosed({ closed: true }, onStop, restore),
    true,
  );
  assert.deepEqual(actions, ["stop SDK session", "restore embedded peer"]);
});

test("failed mute requests resend authoritative state even when it has not changed", () => {
  const states: boolean[] = [];
  const parentMuted = false;
  const sendState = () => {
    states.push(parentMuted);
  };
  assert.equal(
    handleBrowserPhoneMuteRequest(true, () => false, sendState),
    false,
  );
  assert.deepEqual(states, [false]);
  assert.equal(
    handleBrowserPhoneMuteRequest(
      true,
      () => {
        throw new Error("SDK unavailable");
      },
      sendState,
    ),
    false,
  );
  assert.deepEqual(states, [false, false]);
  let requested: boolean | undefined;
  assert.equal(
    handleBrowserPhoneMuteRequest(
      true,
      (next) => {
        requested = next;
        return true;
      },
      sendState,
    ),
    true,
  );
  assert.equal(requested, true);
  assert.deepEqual(states, [false, false]);
});
