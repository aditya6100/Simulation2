// Simple zero-dependency static server for this folder.
// Usage: `node server.cjs` then open http://localhost:5173

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;

const argPort = Number(process.argv[2]);
const envPort = Number(process.env.PORT);
const PORT = Number.isFinite(argPort) && argPort > 0 ? argPort : Number.isFinite(envPort) && envPort > 0 ? envPort : 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const rel = decoded === "/" ? "/index.html" : decoded;
  const joined = path.join(ROOT, rel);
  const normalized = path.normalize(joined);
  if (!normalized.startsWith(ROOT)) return null;
  return normalized;
}

const server = http.createServer((req, res) => {
  const p = safePath(req.url || "/");
  if (!p) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(p).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(p).pipe(res);
  });
});

function listenWithRetry(startPort, maxAttempts) {
  let attempt = 0;
  let port = startPort;

  const tryListen = () => {
    attempt++;
    server.listen(port, "127.0.0.1", () => {
      // eslint-disable-next-line no-console
      console.log(`Server running: http://localhost:${port}`);
    });
  };

  server.on("error", (err) => {
    if ((err.code === "EACCES" || err.code === "EADDRINUSE") && attempt < maxAttempts) {
      // eslint-disable-next-line no-console
      console.warn(`Port ${port} unavailable (${err.code}). Trying ${port + 1}...`);
      port += 1;
      setTimeout(tryListen, 50);
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });

  tryListen();
}

listenWithRetry(PORT, 25);
