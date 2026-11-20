// Adds the Certified Group Service (CGS) to an Atmosphere in a Box checkout as the application
// `cgs`, built from a checkout of CGS. Run it before `deno task sandbox create ... --app cgs`.
//
//   node scripts/e2e-cgs/install.mjs <Atmosphere in a Box checkout> <CGS checkout>
//
// It changes only the AiaB checkout it is given (a per-run copy), never the CGS checkout. The
// image is built from what `git archive HEAD` exports of the CGS checkout, so uncommitted changes
// there are ignored. docs/e2e-testing.md says which CGS commit the tests are written against.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [aiabArg, cgsArg, ...extra] = process.argv.slice(2);
if (!aiabArg || !cgsArg || extra.length > 0) {
  fail("usage: node scripts/e2e-cgs/install.mjs <Atmosphere in a Box checkout> <CGS checkout>");
}
const aiab = resolve(aiabArg);
const cgs = resolve(cgsArg);

const registryPath = join(aiab, "stacks", "components.json");
const registry = readJson(registryPath, "Is that an Atmosphere in a Box checkout?");
const entry = {
  id: "cgs",
  file: "stacks/cgs.yaml",
  application: "cgs",
  definition: "stacks/cgs.definition.json",
};
const existing = registry.filter((item) => item?.id === entry.id);
if (
  existing.length > 1 ||
  (existing.length === 1 && JSON.stringify(existing[0]) !== JSON.stringify(entry))
) {
  fail(`${registryPath} already has a different "cgs" entry.`);
}
if (existing.length === 0) {
  writeFileSync(registryPath, `${JSON.stringify([...registry, entry], null, 2)}\n`);
}
copyFileSync(join(here, "stack.yaml"), join(aiab, "stacks", "cgs.yaml"));
copyFileSync(join(here, "stack.definition.json"), join(aiab, "stacks", "cgs.definition.json"));

// The build context. `.cgs-version` is what CGS's own scripts/stamp-version.sh writes; the
// Dockerfile refuses to build without it because the copy has no .git directory.
const source = join(aiab, "cgs-source");
rmSync(source, { recursive: true, force: true });
mkdirSync(source, { recursive: true });
const sha = git("rev-parse", "HEAD").trim();
const archive = execFileSync("git", ["-C", cgs, "archive", "--format=tar", "HEAD"], {
  maxBuffer: 1 << 30,
});
execFileSync("tar", ["-x", "-C", source], { input: archive });
const { version } = readJson(join(source, "package.json"), "Is that a CGS checkout?");
writeFileSync(join(source, ".cgs-version"), `${version}+${sha.slice(0, 8)}\n`);

console.log(`Installed the cgs application (CGS ${sha}) into ${aiab}.`);

function git(...args) {
  try {
    return execFileSync("git", ["-C", cgs, ...args], { encoding: "utf8" });
  } catch (error) {
    return fail(`${cgs} is not a git checkout of the Certified Group Service (${error.message}).`);
  }
}

function readJson(path, hint) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return fail(`cannot read ${path} (${error.message}). ${hint}`);
  }
}

function fail(message) {
  console.error(`e2e-cgs: ${message}`);
  process.exit(1);
}
