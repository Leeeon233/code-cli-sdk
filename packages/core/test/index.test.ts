import { test, assert } from "vitest";
import { Pushable } from "../src";

test("pushable yields pushed values", async () => {
  const pushable = new Pushable<string>();

  const results: string[] = [];
  const iterator = (async () => {
    for await (const item of pushable) {
      results.push(item);
      if (results.length === 2) break;
    }
  })();

  pushable.push("a");
  pushable.push("b");
  await iterator;

  assert.deepEqual(results, ["a", "b"]);
});
