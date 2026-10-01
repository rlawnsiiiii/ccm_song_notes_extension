import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("static", "dist", { recursive: true });

// WCC_TEST=1 builds a variant for the automated Firefox test: it also runs on localhost
// and exposes its state on <html data-wcc>. Never ship this build.
const test = process.env.WCC_TEST === "1";
if (test) {
  const m = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
  m.content_scripts[0].matches.push("http://localhost/*");
  m.host_permissions.push("http://localhost/*");
  writeFileSync("dist/manifest.json", JSON.stringify(m, null, 2));
}

const opts = {
  entryPoints: {
    content: "src/content/index.ts",
    background: "src/background/index.ts",
    sidebar: "src/sidebar/index.ts",
  },
  bundle: true,
  outdir: "dist",
  target: "firefox115",
  format: "iife",
  sourcemap: true,
  minifySyntax: !test, // drops the dead test hooks from release builds
  define: { __WCC_TEST__: test ? "true" : "false" },
  logLevel: "info",
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
