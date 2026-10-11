// Minimal static server for local browser E2E tests.
// No dependencies: Node built-in http only.
// Serves browser-e2e/test-page.html at http://127.0.0.1:8099/
const http = require("http");
const fs = require("fs");
const path = require("path");

const server = http.createServer((req, res) => {
  const file = path.join(__dirname, "test-page.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("failed to read test page");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  });
});

server.listen(8099, "127.0.0.1", () => {
  fs.writeFileSync(path.join(__dirname, "serve.pid"), String(process.pid));
  console.log("E2E test page: http://127.0.0.1:8099/");
});
