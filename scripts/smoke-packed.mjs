#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const publicPackageDirs = [
  "packages/chat-core",
  "packages/chat-adapter-discord",
  "packages/chat-adapter-telegram",
  "packages/harness-core",
  "packages/harness-opencode",
  "packages/harness-pi",
  "packages/orchestrator",
  "packages/stt",
];

const dependencyBlocks = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];

const run = (command, args, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });

const runCapture = (command, args, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const readPackageJson = async (pkgDir) => {
  const raw = await readFile(join(pkgDir, "package.json"), "utf8");
  return JSON.parse(raw);
};

const assertPackageManifest = (manifest, source) => {
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${source} is missing package name`);
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${source} is missing package version`);
  }
};

const hasWorkspaceSpecifier = (value) =>
  typeof value === "string" && value.startsWith("workspace:");

const assertSourcePublishableManifest = (manifest, source) => {
  assertPackageManifest(manifest, source);
  if (manifest.private === true) {
    throw new Error(`${manifest.name} is private but listed as publishable`);
  }
  if (!manifest.exports) {
    throw new Error(`${manifest.name} does not declare package exports`);
  }
};

const assertPackedPublishableManifest = (manifest, source, publicPackageNames) => {
  assertSourcePublishableManifest(manifest, source);

  for (const blockName of dependencyBlocks) {
    const block = manifest[blockName];
    if (!isObject(block)) continue;
    for (const [depName, depRange] of Object.entries(block)) {
      if (hasWorkspaceSpecifier(depRange)) {
        throw new Error(`${manifest.name} has unresolved ${blockName}.${depName}: ${depRange}`);
      }
      if (
        blockName !== "devDependencies" &&
        depName.startsWith("@xmux/") &&
        !publicPackageNames.has(depName)
      ) {
        throw new Error(`${manifest.name} ${blockName} references non-public package ${depName}`);
      }
    }
  }
};

const readPackedManifest = async (tarballPath) => {
  const result = await runCapture("tar", ["-xOf", tarballPath, "package/package.json"]);
  if (result.code !== 0) {
    throw new Error(`Failed to read package/package.json from ${tarballPath}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
};

const packPackage = async (relDir, tarballDir) => {
  const pkgDir = join(repoRoot, relDir);
  const manifest = await readPackageJson(pkgDir);
  assertSourcePublishableManifest(manifest, `${relDir}/package.json`);
  if (!existsSync(join(pkgDir, "dist"))) {
    throw new Error(`Missing dist/ in ${relDir}. Run pnpm build before packing.`);
  }

  console.log(`[pack] ${manifest.name}@${manifest.version}`);
  const before = new Set(await readdir(tarballDir));
  await run("pnpm", ["pack", "--pack-destination", tarballDir], { cwd: pkgDir });
  const after = await readdir(tarballDir);
  const produced = after.filter((entry) => entry.endsWith(".tgz") && !before.has(entry));
  if (produced.length !== 1) {
    throw new Error(
      `Expected ${relDir} to produce exactly one tarball, found ${produced.length}: ${produced.join(", ")}`,
    );
  }

  const tarballPath = join(tarballDir, produced[0]);
  const packedManifest = await readPackedManifest(tarballPath);
  return { relDir, pkgDir, manifest, packedManifest, tarballPath };
};

const exportTargets = (exportsField) => {
  if (typeof exportsField === "string") {
    return [{ subpath: ".", value: exportsField }];
  }
  if (!isObject(exportsField)) return [];

  const keys = Object.keys(exportsField);
  if (!keys.some((key) => key.startsWith("."))) {
    return [{ subpath: ".", value: exportsField }];
  }

  return keys
    .filter((key) => key !== "./package.json")
    .map((key) => ({ subpath: key, value: exportsField[key] }));
};

const supportsCondition = (value, condition) => {
  if (typeof value === "string") return true;
  if (!isObject(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, condition)) return true;
  return Object.prototype.hasOwnProperty.call(value, "default");
};

const specifierFor = (packageName, subpath) =>
  subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`;

const firstMeaningfulLine = (output) => {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => !line.startsWith("at ")) ?? lines[0] ?? "unknown error";
};

const probeImport = async (fixtureDir, specifier) => {
  const result = await runCapture(
    "node",
    ["--input-type=module", "--eval", `await import(${JSON.stringify(specifier)});`],
    { cwd: fixtureDir },
  );
  if (result.code !== 0) {
    return firstMeaningfulLine(`${result.stderr}\n${result.stdout}`);
  }
  return null;
};

const probeRequire = async (fixtureDir, specifier) => {
  const result = await runCapture("node", ["--eval", `require(${JSON.stringify(specifier)});`], {
    cwd: fixtureDir,
  });
  if (result.code !== 0) {
    return firstMeaningfulLine(`${result.stderr}\n${result.stdout}`);
  }
  return null;
};

const smokeTestExports = async (fixtureDir, packages) => {
  const failures = [];

  for (const pkg of packages) {
    const targets = exportTargets(pkg.packedManifest.exports);
    if (targets.length === 0) {
      failures.push(`${pkg.packedManifest.name}: no code exports to test`);
      continue;
    }

    for (const target of targets) {
      const specifier = specifierFor(pkg.packedManifest.name, target.subpath);

      if (supportsCondition(target.value, "import")) {
        const failure = await probeImport(fixtureDir, specifier);
        if (failure) {
          failures.push(`${specifier} import failed: ${failure}`);
        } else {
          console.log(`[import] ${specifier}`);
        }
      }

      if (supportsCondition(target.value, "require")) {
        const failure = await probeRequire(fixtureDir, specifier);
        if (failure) {
          failures.push(`${specifier} require failed: ${failure}`);
        } else {
          console.log(`[require] ${specifier}`);
        }
      }
    }
  }

  return failures;
};

const main = async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "xmux-pack-smoke-"));
  try {
    const tarballDir = join(tempRoot, "tarballs");
    const fixtureDir = join(tempRoot, "fixture");
    await mkdir(tarballDir, { recursive: true });
    await mkdir(fixtureDir, { recursive: true });

    const publicPackageNames = new Set();
    for (const relDir of publicPackageDirs) {
      const manifest = await readPackageJson(join(repoRoot, relDir));
      assertPackageManifest(manifest, `${relDir}/package.json`);
      publicPackageNames.add(manifest.name);
    }

    const packages = [];
    for (const relDir of publicPackageDirs) {
      const packed = await packPackage(relDir, tarballDir);
      assertPackedPublishableManifest(
        packed.packedManifest,
        packed.tarballPath,
        publicPackageNames,
      );
      packages.push(packed);
    }

    const dependencies = {};
    const overrides = {};
    for (const pkg of packages) {
      const fileSpec = `file:${pkg.tarballPath}`;
      dependencies[pkg.packedManifest.name] = fileSpec;
      overrides[pkg.packedManifest.name] = fileSpec;
    }

    await writeFile(
      join(fixtureDir, "package.json"),
      `${JSON.stringify(
        {
          name: "xmux-packed-smoke-fixture",
          version: "0.0.0",
          private: true,
          type: "module",
          dependencies,
          overrides,
        },
        null,
        2,
      )}\n`,
    );

    console.log("[install] packed packages in temporary fixture");
    await run("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
      cwd: fixtureDir,
    });

    const failures = await smokeTestExports(fixtureDir, packages);
    if (failures.length > 0) {
      console.error(`\n[smoke] ${failures.length} failure(s):`);
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("[smoke] packed package exports OK");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

await main();
