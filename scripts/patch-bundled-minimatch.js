// aws-cdk-lib bundles minimatch 10.2.6. npm overrides do not replace
// bundleDependencies, so install the patched release and copy it over.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cdkDir = path.resolve("node_modules/aws-cdk-lib");
const bundledDir = path.join(cdkDir, "node_modules/minimatch");
const minimum = [11, 0, 1];

if (!existsSync(cdkDir)) {
  process.exit(0);
}

const srcPkgPath = require.resolve("minimatch/package.json");
const srcDir = path.dirname(srcPkgPath);
if (path.resolve(srcDir) === bundledDir) {
  console.error("resolved minimatch is the bundled copy; install minimatch at the repository root");
  process.exit(1);
}

const version = JSON.parse(readFileSync(srcPkgPath, "utf8")).version;
const parts = version.split(".").map((part) => Number(part));
const isPatched = parts.reduce((state, part, index) => {
  if (state !== 0) return state;
  const required = minimum[index] ?? 0;
  if (part > required) return 1;
  if (part < required) return -1;
  return 0;
}, 0) >= 0;
if (!isPatched) {
  console.error(`root minimatch@${version} is outside the patched range >= 11.0.1`);
  process.exit(1);
}

rmSync(bundledDir, { recursive: true, force: true });
cpSync(srcDir, bundledDir, {
  recursive: true,
  dereference: true,
  filter: (source) => {
    const relative = path.relative(srcDir, source);
    return relative === "" || !relative.split(path.sep).includes("node_modules");
  },
});

const installed = JSON.parse(readFileSync(path.join(bundledDir, "package.json"), "utf8")).version;
if (installed !== version) {
  console.error(`bundled minimatch is ${installed} after copy, expected ${version}`);
  process.exit(1);
}

const fromCdk = createRequire(path.join(cdkDir, "core/lib/fs/ignore.js"));
const resolved = fromCdk("minimatch/package.json").version;
if (resolved !== version) {
  console.error(`aws-cdk-lib resolved minimatch@${resolved}, expected ${version}`);
  process.exit(1);
}

const cdkPkgPath = path.join(cdkDir, "package.json");
const cdkPkg = JSON.parse(readFileSync(cdkPkgPath, "utf8"));
if (cdkPkg.dependencies?.minimatch !== version) {
  cdkPkg.dependencies.minimatch = version;
  writeFileSync(cdkPkgPath, `${JSON.stringify(cdkPkg, null, 2)}\n`);
}

console.log(`replaced aws-cdk-lib bundled minimatch with ${version}`);
