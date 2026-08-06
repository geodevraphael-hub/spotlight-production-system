import { createServer, request as httpRequest } from "node:http";

const PORT = 3000;
const TARGET_HOST = "::1";
const TARGET_PORT = 3001;

const server = createServer((req, res) => {
  const opts = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const proxy = httpRequest(opts, (upstream) => {
    res.writeHead(upstream.statusCode || 200, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on("error", (e) => {
    res.writeHead(502);
    res.end("Bad Gateway: " + e.message);
  });
  req.pipe(proxy);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy listening on 0.0.0.0:${PORT} → [::1]:${TARGET_PORT}`);
});
