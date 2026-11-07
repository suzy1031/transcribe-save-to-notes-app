import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const requireFromCdk = createRequire(new URL("../node_modules/aws-cdk-lib/core/lib/fs/ignore.js", import.meta.url));

test("aws-cdk-lib が読み込む minimatch は GHSA-g3hv-75wg-m249 の修正版である", () => {
  const version = requireFromCdk("minimatch/package.json").version;
  const [major, minor, patch] = version.split(".").map(Number);
  assert.ok(
    major > 11 || (major === 11 && (minor > 0 || patch >= 1)),
    `minimatch@${version}`,
  );

  const { minimatch } = requireFromCdk("minimatch");
  assert.equal(minimatch("src/a.ts", "*.ts", { matchBase: true, flipNegate: true }), true);
  assert.equal(minimatch("src/a.ts", "!*.ts", { matchBase: true, flipNegate: true }), true);
  assert.equal(minimatch("Stage/Stack/Fn", "**"), true);
  assert.equal(minimatch("Stage/Stack/Fn", "Stage/Stack*"), false);
});
