// Bundles the in-page probe into one file Playwright can add as an init script.
import { build } from "esbuild";

await build({
  entryPoints: ["src/probe/browser.ts"],
  outfile: "dist/probe.js",
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});
console.log("probe: dist/probe.js");
