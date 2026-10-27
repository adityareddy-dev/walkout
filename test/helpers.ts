import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".map": "application/json" };

export async function serveFixture(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const file = join(root, path === "/" ? "index.html" : path);
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(() => r())) };
}
