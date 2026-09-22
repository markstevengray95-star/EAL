const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;
const root = __dirname;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        // Return a real 404 for missing assets. Serving index.html as
        // JavaScript or CSS creates confusing browser parse errors.
        if (path.extname(filePath)) {
          res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-cache"});
          return res.end("Not found");
        }
        fs.readFile(path.join(root, "index.html"), (fallbackErr, fallback) => {
          if (fallbackErr) {
            res.writeHead(404);
            return res.end("Not found");
          }
          res.writeHead(200, {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache"});
          res.end(fallback);
        });
        return;
      }
      res.writeHead(200, {"Content-Type":types[path.extname(filePath).toLowerCase()] || "application/octet-stream","Cache-Control":"no-cache"});
      res.end(data);
    });
  });
}).listen(port, "0.0.0.0", () => {
  console.log("EAL Progress Hub listening on port " + port);
});
