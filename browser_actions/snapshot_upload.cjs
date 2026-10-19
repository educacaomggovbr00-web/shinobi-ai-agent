#!/usr/bin/env node
/**
 * Upload one explicitly requested screenshot to this private GitHub Actions
 * run as a short-retention artifact. No screenshot is ever committed.
 */
const fs = require("node:fs");
const path = require("node:path");
const { DefaultArtifactClient } = require("@actions/artifact");

async function main() {
  const [file, name] = process.argv.slice(2);
  if (!file || !name || !/^bushin-snapshot-[a-zA-Z0-9_-]{4,130}$/.test(name)) {
    throw new Error("Invalid screenshot file or artifact name");
  }
  const realFile = fs.realpathSync(file);
  if (!realFile.startsWith("/tmp/bushin-snapshots/")) {
    throw new Error("Screenshot must be a temporary file in protected snapshot directory");
  }
  if (!realFile.endsWith(".jpg") || fs.statSync(realFile).size > 1024 * 1024) {
    throw new Error("Expected JPEG screenshot smaller than 1 MiB");
  }
  const client = new DefaultArtifactClient();
  const artifact = await client.uploadArtifact(
    name, [realFile], path.dirname(realFile),
    {retentionDays: 1, compressionLevel: 6}
  );
  console.log(JSON.stringify({
    artifact_id: artifact.id,
    artifact_name: name,
    size: artifact.size
  }));
}

main().catch(err => {
  // Never print file content, token, cookies or browser state.
  console.error("Screenshot upload failed:", err?.name || "unknown");
  process.exit(1);
});
