import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { checkPackageManagerParity } from "./check-package-manager-parity.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "supercmd-package-manager-parity-"));
  const packageJson = {
    name: "fixture",
    version: "1.0.0",
    packageManager: "npm@11.12.1",
    dependencies: {
      "@raycast/api": "^1.104.5",
    },
    devDependencies: {
      typescript: "^5.3.3",
    },
  };
  const packageLock = {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "fixture",
        version: "1.0.0",
        dependencies: {
          "@raycast/api": "^1.104.5",
        },
        devDependencies: {
          typescript: "^5.3.3",
        },
      },
      "node_modules/@raycast/api": {
        version: "1.104.19",
      },
      "node_modules/typescript": {
        version: "5.9.3",
      },
    },
  };

  writeJson(path.join(rootDir, "package.json"), packageJson);
  writeJson(path.join(rootDir, "package-lock.json"), packageLock);
  writeJson(path.join(rootDir, "node_modules/@raycast/api/package.json"), {
    name: "@raycast/api",
    version: "1.104.19",
  });
  writeJson(path.join(rootDir, "node_modules/typescript/package.json"), {
    name: "typescript",
    version: "5.9.3",
  });

  return rootDir;
}

test("package manager parity passes for npm lockfile and matching installed packages", () => {
  const rootDir = createFixture();

  const result = checkPackageManagerParity({
    rootDir,
    env: {
      CI: "true",
      npm_config_user_agent: "npm/11.12.1 node/v22.22.3 darwin arm64 workspaces/false",
      npm_execpath: "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkedInstalledPackages, 2);
  assert.equal(result.strictInstalledVersions, true);
  assert.equal(result.expectedPackageManager, "npm@11.12.1");
});

test("package manager parity blocks pnpm lifecycle execution", () => {
  const rootDir = createFixture();

  const result = checkPackageManagerParity({
    rootDir,
    env: {
      npm_config_user_agent: "pnpm/11.7.0 npm/? node/v22.22.3 darwin arm64",
      npm_execpath: "/opt/homebrew/lib/node_modules/pnpm/bin/pnpm.cjs",
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /running under pnpm/);
});

test("package manager parity blocks generated root pnpm lockfiles", () => {
  const rootDir = createFixture();
  fs.writeFileSync(path.join(rootDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const result = checkPackageManagerParity({ rootDir, env: {} });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /pnpm-lock\.yaml exists/);
});

test("package manager parity catches package.json and package-lock root spec drift", () => {
  const rootDir = createFixture();
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.dependencies["@raycast/api"] = "^1.104.21";
  writeJson(packageJsonPath, packageJson);

  const result = checkPackageManagerParity({ rootDir, env: {} });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /dependencies\.@raycast\/api/);
});

test("package manager parity catches installed package versions that differ from package-lock", () => {
  const rootDir = createFixture();
  writeJson(path.join(rootDir, "node_modules/@raycast/api/package.json"), {
    name: "@raycast/api",
    version: "1.104.21",
  });

  const result = checkPackageManagerParity({ rootDir, env: { CI: "true" } });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /@raycast\/api is installed at 1\.104\.21/);
});

test("package manager parity skips installed package version drift for local lifecycle commands", () => {
  const rootDir = createFixture();
  writeJson(path.join(rootDir, "node_modules/@raycast/api/package.json"), {
    name: "@raycast/api",
    version: "1.104.21",
  });

  const result = checkPackageManagerParity({ rootDir, env: {} });

  assert.equal(result.ok, true);
  assert.equal(result.checkedInstalledPackages, 0);
  assert.equal(result.strictInstalledVersions, false);
});

test("package manager parity reads the expected npm version from package.json", () => {
  const rootDir = createFixture();
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.packageManager = "npm@11.13.0";
  writeJson(packageJsonPath, packageJson);

  const result = checkPackageManagerParity({ rootDir, env: {} });

  assert.equal(result.ok, true);
  assert.equal(result.expectedPackageManager, "npm@11.13.0");
});

test("package manager parity requires packageManager to name npm", () => {
  const rootDir = createFixture();
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.packageManager = "pnpm@11.7.0";
  writeJson(packageJsonPath, packageJson);

  const result = checkPackageManagerParity({ rootDir, env: {} });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /packageManager must use npm/);
});
