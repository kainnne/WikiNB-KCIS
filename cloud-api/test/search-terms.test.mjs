import test from "node:test";
import assert from "node:assert/strict";
import { searchTerms } from "../src/chat.mjs";

test("Chinese questions without spaces still produce matchable terms", () => {
  const terms = searchTerms("登山校外教學那天學生幾點要到學校？");
  for (const term of ["登山", "校外", "學生", "學校", "幾點"]) assert.ok(terms.includes(term), term);
});

test("English stopwords are dropped and content words kept", () => {
  assert.deepEqual(searchTerms("What should students bring for the hiking trip?"), ["should", "students", "bring", "hiking", "trip"]);
});
