import esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
// the plugin: one script loaded by dist/index.html (Logseq opens it in the plugin's iframe)
mkdirSync("dist", { recursive: true });
await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "iife", target: "es2020", outfile: "dist/index.js", logLevel: "warning" });
writeFileSync("dist/index.html", '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="index.js"></script></body></html>\n');
// the pure logic as an ES module for the unit tests
await esbuild.build({ entryPoints: ["src/log.ts"], bundle: true, format: "esm", outfile: "build/log.mjs", logLevel: "warning" });
