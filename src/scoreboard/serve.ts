import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function inside(root: string, file: string): boolean {
  return file === root || file.startsWith(root.endsWith(sep) ? root : root + sep);
}

function fail(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

export async function serveDir(root: string, port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const base = await realpath(resolve(root));
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed");
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      return fail(res, 400, "Bad request");
    }
    if (pathname.includes("\0")) return fail(res, 400, "Bad request");
    // The raw URL can carry ".." segments that URL parsing keeps once percent-decoded.
    let file = resolve(base, "." + pathname);
    if (!inside(base, file)) return fail(res, 403, "Forbidden");
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = join(file, "index.html");
        info = await stat(file);
      }
      const real = await realpath(file);
      if (!inside(base, real) || !info.isFile()) return fail(res, 403, "Forbidden");
      res.writeHead(200, {
        "Content-Type": TYPES[extname(real).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(real)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch {
      fail(res, 404, "Not found");
    }
  });
  await new Promise<void>((ok, bad) => {
    server.once("error", bad);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", bad);
      ok();
    });
  });
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}/`,
    close: () =>
      new Promise<void>((ok, bad) => {
        server.close((err) => (err ? bad(err) : ok()));
        server.closeAllConnections();
      }),
  };
}
