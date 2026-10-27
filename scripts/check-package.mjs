// Packs each publishable package and installs the tarball into an isolated
// consumer project outside the workspace. This catches packaging errors
// (bad exports, missing files, leftover workspace: specifiers) that workspace
// symlinks would otherwise hide.
//
// Run after `pnpm build` (see the `check:package` script).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rootManifest = readJson(join(root, "package.json"));
const pinned = (name) => {
  const version = rootManifest.devDependencies?.[name];
  if (!version) throw new Error(`check-package: ${name} must be a root devDependency`);
  return version;
};

const packages = [{ name: "@hypercerts-org/sdk", dir: join(root, "packages/sdk") }];

const work = mkdtempSync(join(tmpdir(), "hypercerts-sdk-consumer-"));
try {
  const tarballs = packages.map((pkg) => packPackage(pkg, work));
  const consumer = createConsumer(work, tarballs);
  checkNode(consumer);
  checkTypes(consumer);
  checkBrowserBuild(consumer);
  console.log("check-package: all consumer checks passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}

function packPackage(pkg, dest) {
  run("pnpm", ["pack", "--pack-destination", dest], pkg.dir);
  const tarball = readdirSync(dest).find(
    (file) => file.endsWith(".tgz") && file.startsWith(slug(pkg.name)),
  );
  if (!tarball) throw new Error(`check-package: no tarball produced for ${pkg.name}`);

  const extracted = join(dest, `${slug(pkg.name)}-extracted`);
  run("mkdir", ["-p", extracted], dest);
  run("tar", ["-xzf", join(dest, tarball), "-C", extracted], dest);
  const packedManifest = readFileSync(join(extracted, "package", "package.json"), "utf8");
  if (packedManifest.includes("workspace:")) {
    throw new Error(
      `check-package: packed ${pkg.name} still contains workspace: dependency specifiers`,
    );
  }
  return { name: pkg.name, path: join(dest, tarball) };
}

function createConsumer(dir, tarballs) {
  const consumer = join(dir, "consumer");
  run("mkdir", ["-p", join(consumer, "src")], dir);
  writeJson(join(consumer, "package.json"), {
    name: "consumer",
    private: true,
    type: "module",
    dependencies: Object.fromEntries(tarballs.map((t) => [t.name, `file:${t.path}`])),
    devDependencies: { typescript: pinned("typescript"), vite: pinned("vite") },
  });
  const imports = packages.map((pkg, i) => `import * as pkg${i} from "${pkg.name}";`).join("\n");
  const uses = packages.map((_, i) => `pkg${i}`).join(", ");
  writeFileSync(join(consumer, "src", "main.ts"), `${imports}\nconsole.log([${uses}]);\n`);
  writeFileSync(
    join(consumer, "index.html"),
    '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n',
  );
  writeJson(join(consumer, "tsconfig.json"), {
    compilerOptions: {
      target: "es2024",
      module: "nodenext",
      moduleResolution: "nodenext",
      strict: true,
      noEmit: true,
      types: [],
      lib: ["es2024", "dom"],
    },
    include: ["src"],
  });
  // --ignore-workspace keeps pnpm from treating the temp dir as part of this repo.
  run("pnpm", ["install", "--ignore-workspace", "--no-frozen-lockfile"], consumer);
  return consumer;
}

function checkNode(consumer) {
  const script = packages.map((pkg) => `await import(${JSON.stringify(pkg.name)});`).join("");
  run("node", ["--input-type=module", "-e", script], consumer);
  console.log("check-package: Node resolves package entry points");
}

function checkTypes(consumer) {
  run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], consumer);
  console.log("check-package: TypeScript resolves package declarations");
}

function checkBrowserBuild(consumer) {
  run("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], consumer);
  console.log("check-package: browser build bundles the package");
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function slug(name) {
  return name.replace(/^@/, "").replace("/", "-");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
