import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("static", "dist", { recursive: true });

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
  logLevel: "info",
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
