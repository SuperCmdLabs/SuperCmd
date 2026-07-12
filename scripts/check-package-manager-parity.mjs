import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STRICT_INSTALLED_VERSION_ENV = "SUPERCMD_STRICT_PACKAGE_MANAGER_PARITY";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function packagePathForLockPath(rootDir, lockPath) {
  return path.join(rootDir, lockPath, "package.json");
}

function collectDependencySpecFailures(packageJson, packageLock) {
  const failures = [];
  const rootLockPackage = packageLock.packages?.[""];
  const sections = ["dependencies", "devDependencies", "optionalDependencies"];

  if (!rootLockPackage) {
    return ["package-lock.json is missing packages[\"\"], so root dependency specs cannot be validated."];
  }

  for (const section of sections) {
    const packageSpecs = packageJson[section] ?? {};
    const lockSpecs = rootLockPackage[section] ?? {};
    const dependencyNames = new Set([...Object.keys(packageSpecs), ...Object.keys(lockSpecs)]);

    for (const dependencyName of dependencyNames) {
      if (packageSpecs[dependencyName] !== lockSpecs[dependencyName]) {
        failures.push(
          `${section}.${dependencyName} is ${JSON.stringify(packageSpecs[dependencyName])} in package.json but ${JSON.stringify(lockSpecs[dependencyName])} in package-lock.json.`,
        );
      }
    }
  }

  return failures;
}

function collectInstalledVersionFailures(rootDir, packageLock) {
  const failures = [];
  let checkedInstalledPackages = 0;

  for (const [lockPath, packageEntry] of Object.entries(packageLock.packages ?? {})) {
    if (!lockPath.startsWith("node_modules/") || !packageEntry.version) {
      continue;
    }

    const installedPackageJsonPath = packagePathForLockPath(rootDir, lockPath);
    if (!fs.existsSync(installedPackageJsonPath)) {
      continue;
    }

    const installedPackageJson = readJson(installedPackageJsonPath);
    checkedInstalledPackages += 1;

    if (installedPackageJson.version !== packageEntry.version) {
      failures.push(
        `${lockPath} is installed at ${installedPackageJson.version}, but package-lock.json expects ${packageEntry.version}.`,
      );
    }
  }

  return { failures, checkedInstalledPackages };
}

function getExpectedPackageManager(packageJson) {
  return typeof packageJson.packageManager === "string" ? packageJson.packageManager : "";
}

function isStrictInstalledVersionCheck(env) {
  return env.CI === "true" || env[STRICT_INSTALLED_VERSION_ENV] === "1";
}

function isPnpmRuntime(env) {
  const markers = [
    env.npm_config_user_agent,
    env.npm_execpath,
    env.npm_node_execpath,
    env.npm_config_userconfig,
  ].filter(Boolean);

  return markers.some((marker) => /(^|[/\s])pnpm(?:[/@\s.]|$)/i.test(marker));
}

export function checkPackageManagerParity({ rootDir = process.cwd(), env = process.env } = {}) {
  const failures = [];
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageLockPath = path.join(rootDir, "package-lock.json");
  const pnpmLockPath = path.join(rootDir, "pnpm-lock.yaml");

  if (!fs.existsSync(packageJsonPath)) {
    failures.push("package.json is missing.");
  }

  if (!fs.existsSync(packageLockPath)) {
    failures.push("package-lock.json is missing; validation must use the committed npm lockfile.");
  }

  if (fs.existsSync(pnpmLockPath)) {
    failures.push("pnpm-lock.yaml exists at the repository root; remove it before running validation.");
  }

  if (isPnpmRuntime(env)) {
    failures.push("validation is running under pnpm; use a real npm binary with package-lock.json instead.");
  }

  if (failures.length > 0 || !fs.existsSync(packageJsonPath) || !fs.existsSync(packageLockPath)) {
    return { ok: false, failures, checkedInstalledPackages: 0 };
  }

  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const expectedPackageManager = getExpectedPackageManager(packageJson);

  if (!expectedPackageManager) {
    failures.push("package.json packageManager must be set to the expected npm runtime.");
  } else if (!expectedPackageManager.startsWith("npm@")) {
    failures.push(
      `package.json packageManager must use npm, found ${JSON.stringify(packageJson.packageManager)}.`,
    );
  }

  failures.push(...collectDependencySpecFailures(packageJson, packageLock));

  const strictInstalledVersions = isStrictInstalledVersionCheck(env);
  let checkedInstalledPackages = 0;

  if (strictInstalledVersions) {
    const installedVersionResult = collectInstalledVersionFailures(rootDir, packageLock);
    checkedInstalledPackages = installedVersionResult.checkedInstalledPackages;
    failures.push(...installedVersionResult.failures);
  }

  return {
    ok: failures.length === 0,
    failures,
    checkedInstalledPackages,
    strictInstalledVersions,
    expectedPackageManager,
  };
}

export function formatPackageManagerParityResult(result) {
  if (result.ok) {
    const installedStatus = result.strictInstalledVersions
      ? `checked ${result.checkedInstalledPackages} installed package version(s)`
      : "skipped installed package version checks outside CI";
    return `package-manager parity ok: package-lock.json is authoritative for ${result.expectedPackageManager}; ${installedStatus}.`;
  }

  return [
    "Package manager parity check failed:",
    ...result.failures.map((failure) => `- ${failure}`),
    "",
    "Use a real npm binary and `npm ci` to restore package-lock.json parity. Do not commit pnpm-lock.yaml.",
  ].join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const result = checkPackageManagerParity();
  const message = formatPackageManagerParityResult(result);

  if (result.ok) {
    console.log(message);
  } else {
    console.error(message);
    process.exitCode = 1;
  }
}
