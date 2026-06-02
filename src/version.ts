/**
 * Single source of truth for the mcp-kinetic-gain package version.
 *
 * Read once at module-load time from the published `package.json` so the
 * MCP serverInfo response, the stdio startup banner, and the CLI
 * `--version` output cannot drift relative to each other or relative to
 * what is actually published to npm.
 *
 * Path math: at runtime this file is `dist/version.js`, so `../package.json`
 * resolves to the package root. Both `dist/` and `package.json` ship together
 * because they are both whitelisted in `package.json` `"files"`.
 *
 * Why not `import pkg from "../package.json"`? The tsconfig sets
 * `rootDir: "./src"` which forbids importing files outside src/. Doing the
 * read at runtime via `fs.readFileSync` keeps the build config untouched
 * and avoids embedding the version into the compiled JS at build time
 * (which would re-introduce the same drift bug if a `dist/` ever shipped
 * out of sync with `package.json`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_VERSION: string = ((): string => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();
