import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, lstat, utimes } from "node:fs/promises";
import path from "node:path";
import { build, version } from "esbuild";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const input = JSON.parse(await readFile("publication-input.json", "utf8"));
assert.equal(input.schemaVersion, 1);
assert.equal(input.testOnly, true);
assert.equal(input.upstreamTypeScriptCompile, "passed");
assert.equal(input.inputSha256, digest(await readFile("runtime-input.zip")));
assert.equal((await lstat("runtime-input.zip")).size, input.inputBytes);
const paths = input.files.map(file => file.path).sort();
assert.equal(new Set(paths).size, paths.length);
for (const name of paths) {
  assert.ok(/^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.split("/").includes(".."));
  assert.ok(!/\.(?:ts|map)$/.test(name));
  assert.ok(!/(?:^|\/)(?:projectheader\.html|project\.json|\.avi|authoring|source|\.git)(?:\/|$)/.test(name));
}
const archivePaths = execFileSync("unzip", ["-Z1", "runtime-input.zip"], { encoding: "utf8" }).trim().split(/\r?\n/).sort();
assert.deepEqual(archivePaths, paths);
await mkdir("work", { recursive: false });
await mkdir("dist", { recursive: false });
execFileSync("unzip", ["-q", "runtime-input.zip", "-d", "work"]);
for (const file of input.files) {
  const target = path.join("work", ...file.path.split("/"));
  const stat = await lstat(target);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const bytes = await readFile(target);
  assert.equal(bytes.length, file.bytes);
  assert.equal(digest(bytes), file.sha256, file.path);
}
const options = {
  entryPoints: ["work/assets/app.js"], bundle: true, minify: true,
  format: "esm", target: ["es2022"], platform: "browser", legalComments: "none", write: false,
};
const first = await build(options), repeated = await build(options);
assert.equal(first.outputFiles.length, 1);
assert.deepEqual(first.outputFiles[0].contents, repeated.outputFiles[0].contents);
await writeFile("work/assets/app.js", first.outputFiles[0].contents);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(sourceCommit, process.env.GITHUB_SHA);
const epoch = Number(execFileSync("git", ["show", "-s", "--format=%ct", "HEAD"], { encoding: "utf8" }).trim());
const timestamp = new Date(Math.floor(epoch / 2) * 2000);
const files = [];
for (const relative of paths) {
  const target = path.join("work", ...relative.split("/"));
  const bytes = await readFile(target);
  await utimes(target, timestamp, timestamp);
  files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
}
assert.equal(files.length, 46);
assert.equal(files.filter(file => file.path.endsWith(".glb")).length, 11);
assert.equal(files.find(file => file.path === "assets/master-chief.glb").sha256, "4ae6e44e8ec438448253ae9bb595e2c80e345c4a33f2a8cdc4a9cfd7d100ac78");
assert.equal(files.find(file => file.path === "assets/intro-music.wav").sha256, input.files.find(file => file.path === "assets/intro-music.wav").sha256);
const html = await readFile("work/index.html", "utf8");
assert.ok(html.includes('id="show-reference" hidden disabled'));
assert.ok(html.includes('src="./assets/app.js?v=odds-039"'));
assert.ok(html.includes('id="win-estimates"'));
assert.ok(html.includes('id="observation-deck" class="camera-tools" aria-label="Camera views" hidden'));
assert.ok(html.includes('data-view="masterchief"'));
assert.ok(html.includes('id="mission-dialog"'));
assert.ok(html.includes('id="mission-ok"'));
assert.equal(files.find(file=>file.path==="assets/intro-music.wav").sha256,"3438b56d69d2963df24fb469c8203bd6864e70898bd499a3ddf1a62c5ca0fd87");
assert.ok(html.includes('id="movement-mode"'));
assert.ok(html.includes('id="new-game"'));
assert.ok(html.includes('id="board-lock"'));
assert.ok(html.includes('id="game-hud"'));
assert.ok(html.includes('id="promotion-dialog"'));
assert.ok(!html.includes('id="movement-panel"'));
assert.ok(!html.includes('class="deployment"'));
assert.ok(!html.includes('data-count='));
assert.ok(html.includes('id="gpu-benchmark"'));
assert.ok(!first.outputFiles[0].text.includes("__GAME_FIXTURE__"));
assert.ok(!first.outputFiles[0].text.includes("__GPU_PROBE__"));
assert.ok(html.includes("TEST PREVIEW / SCENE BUILD"));
assert.ok(!html.includes("../../../references/"));
execFileSync("zip", ["-X", "-q", "../dist/royalsiege-http-test.zip", ...paths], { cwd: "work" });
const receipt = {
  schemaVersion: 1, sourceCommit, workflowRunId: Number(process.env.GITHUB_RUN_ID),
  testOnly: true, compilation: "public-browser-JavaScript", compiler: `esbuild ${version}`,
  upstreamTypeScriptCommit: input.upstreamTypeScriptCommit, upstreamTypeScriptCompile: input.upstreamTypeScriptCompile,
  upstreamBundleSha256: input.upstreamBundleSha256, inputSha256: input.inputSha256,
  artifactSha256: digest(await readFile("dist/royalsiege-http-test.zip")),
  bundleSha256: digest(first.outputFiles[0].contents), deterministicJavaScriptVerified: true, files,
};
await writeFile("dist/build-receipt.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ compilation: receipt.compilation, sourceCommit, artifactSha256: receipt.artifactSha256, files: files.length }, null, 2));
