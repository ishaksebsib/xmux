#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoots = ["apps", "packages"];
const ignoredWorkspaceDirs = new Set(["_template"]);
const placeholderVersion = "0.0.0";

const readPackageJson = async (pkgDir) => {
  const raw = await readFile(join(pkgDir, "package.json"), "utf8");
  return JSON.parse(raw);
};

const discoverPublicWorkspacePackages = async () => {
  const packages = [];

  for (const workspaceRoot of workspaceRoots) {
    const absoluteRoot = join(repoRoot, workspaceRoot);
    if (!existsSync(absoluteRoot)) continue;

    const entries = await readdir(absoluteRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredWorkspaceDirs.has(entry.name)) continue;

      const pkgDir = join(absoluteRoot, entry.name);
      const manifestPath = join(pkgDir, "package.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = await readPackageJson(pkgDir);
      if (manifest.private === true) continue;

      packages.push({
        name: typeof manifest.name === "string" ? manifest.name : manifestPath,
        version: typeof manifest.version === "string" ? manifest.version : "",
      });
    }
  }

  return packages.sort((left, right) => left.name.localeCompare(right.name));
};

const runChangesetPublish = () =>
  new Promise((resolveRun, reject) => {
    const child = spawn("pnpm", ["exec", "changeset", "publish"], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun(code ?? 1);
    });
  });

const publicPackages = await discoverPublicWorkspacePackages();
const placeholderPackages = publicPackages.filter((pkg) => pkg.version === placeholderVersion);

if (placeholderPackages.length > 0) {
  console.log(
    `[release] Skipping changeset publish because ${placeholderPackages.length} public workspace package(s) still use placeholder version ${placeholderVersion}.`,
  );
  for (const pkg of placeholderPackages) {
    console.log(`  - ${pkg.name}@${pkg.version}`);
  }
  console.log(
    "[release] Add first-release changesets and merge the version PR before enabling npm publish.",
  );
  process.exit(0);
}

const exitCode = await runChangesetPublish();
process.exit(exitCode);
