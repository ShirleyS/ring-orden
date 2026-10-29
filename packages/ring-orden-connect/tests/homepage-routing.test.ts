import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const homepage = readFileSync(new URL("../../../showcase/index.html", import.meta.url), "utf8");

function visit(path: string) {
  const script = homepage.match(/<script id="workspace-return">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "Homepage must preserve existing sign-in and invitation return links");
  const url = new URL(path, "https://ring.example");
  let destination: string | undefined;
  runInNewContext(script, {
    URLSearchParams,
    window: { location: {
      pathname: url.pathname, search: url.search, hash: url.hash,
      replace: (value: string) => { destination = value; },
    } },
  });
  return destination;
}

test("existing sign-in callbacks and workspace deep links reach the workspace intact", () => {
  for (const suffix of [
    "?code=sample-code&state=sample-state",
    "?error=access_denied&state=sample-state",
    "?invite=sample-invite",
    "?phone=whatsapp",
    "?signin_error=cancelled",
    "#access_token=sample-access&refresh_token=sample-refresh&expires_in=3600",
    "#error_description=Link+expired",
  ]) assert.equal(visit("/" + suffix), "/app" + suffix);
});

test("normal showcase visits stay on the homepage and workspace returns do not loop", () => {
  for (const path of ["/", "/#workflows", "/#opensource", "/?lang=en", "/app?code=sample&state=sample", "/customer?purpose=billing#sample"])
    assert.equal(visit(path), undefined, path);
});
