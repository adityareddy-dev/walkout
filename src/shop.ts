// A shop under test: where it runs, what the shoppers try to buy, how to tell
// that an order went through, and how to build, test and patch it.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ShopBuild {
  // Label shown on the scoreboard, usually the release or commit.
  label: string;
  commit: string;
  url: string; // where shoppers start on this build
}

export interface Shop {
  id: string;
  name: string;
  upstream: string; // repository URL
  goal: string;
  // An order counts as placed when the page URL matches successUrl or the
  // visible text matches successText (regular expressions, case-insensitive).
  successUrl?: string;
  successText?: string;
  defect: ShopBuild & { issue: string; summary: string; reproduce: string };
  clean: ShopBuild;
  // The shop's source at the defect commit, relative to the repo root. The
  // fix step patches it on a branch.
  sourceDir: string;
  // Source files the fix step may read and patch, relative to sourceDir.
  sourceGlobs: string[];
  // Shell commands, run from the repo root. startCmd brings up the defect and
  // clean builds, fixBuildCmd builds the patched source and serves it at fixUrl.
  startCmd: string;
  stopCmd: string;
  fixBuildCmd: string;
  fixUrl: string;
  testCmd?: string; // the shop's own tests, run from sourceDir
}

export const ROOT = join(import.meta.dirname, "..");

export function loadShop(id: string): Shop {
  const shop = JSON.parse(readFileSync(join(ROOT, "shops", `${id}.json`), "utf8")) as Shop;
  shop.sourceDir = join(ROOT, shop.sourceDir);
  return shop;
}

export async function isOrderPlaced(shop: Shop, url: string, text: string): Promise<boolean> {
  if (shop.successUrl && new RegExp(shop.successUrl, "i").test(url)) return true;
  if (shop.successText && new RegExp(shop.successText, "i").test(text)) return true;
  return false;
}

export function sh(cmd: string, cwd: string, opts: { quiet?: boolean; timeoutMs?: number } = {}): string {
  if (!opts.quiet) console.log(`$ ${cmd}`);
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.timeoutMs ?? 30 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

export async function waitForShop(url: string, timeoutMs = 10 * 60_000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`shop at ${url} did not come up: ${last}`);
}
