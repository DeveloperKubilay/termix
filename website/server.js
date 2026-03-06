const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
    const normalizedPath = pathname === "/" ? "/index.html" : pathname;
    const candidatePath = path.normalize(path.join(rootDir, normalizedPath));

    if (!candidatePath.startsWith(rootDir)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
    }

    fs.stat(candidatePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
            response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("Not found");
            return;
        }

        const extension = path.extname(candidatePath).toLowerCase();
        const contentType = mimeTypes[extension] || "application/octet-stream";

        fs.readFile(candidatePath, (readError, content) => {
            if (readError) {
                response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
                response.end("Server error");
                return;
            }

            response.writeHead(200, {
                "Content-Type": contentType,
                "Cache-Control": "no-cache"
            });
            response.end(content);
        });
    });
});

server.listen(port, () => {
    console.log(`Termix site preview running at http://localhost:${port}`);
});
