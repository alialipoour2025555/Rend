const GITHUB_PAGE = "https://ir-netlify.github.io/NETLIFY/";

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded", "x-forwarded-host", "x-forwarded-proto",
  "x-forwarded-port",
]);

const PORT = process.env.PORT || 8080;
const http = require("http");
const https = require("https");

function forwardRequest(targetUrl, method, headers, bodyStream, res) {
  const url = new URL(targetUrl);
  const lib = url.protocol === "https:" ? https : http;
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers,
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    const responseHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      responseHeaders[key] = value;
    }
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Bad Gateway: Relay Failed");
    }
  });

  if (bodyStream && method !== "GET" && method !== "HEAD") {
    bodyStream.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let targetHost = req.headers["x-host"];

    if (url.pathname === "/" && !targetHost) {
      const githubResponse = await fetch(GITHUB_PAGE);
      const githubContent = await githubResponse.text();
      res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
      res.end(githubContent);
      return;
    }

    if (!targetHost) {
      res.writeHead(400);
      res.end("Error: x-host header is missing.");
      return;
    }

    let targetUrl;
    if (targetHost.startsWith("http://") || targetHost.startsWith("https://")) {
      targetUrl = `${targetHost}${url.pathname}${url.search}`;
    } else {
      const isSecure = !targetHost.includes(":") || targetHost.includes(":443") || /^s\d+\./.test(targetHost);
      const protocol = isSecure ? "https://" : "http://";
      targetUrl = `${protocol}${targetHost}${url.pathname}${url.search}`;
    }

    const headers = {};
    let clientIp = null;

    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k) || k.startsWith("x-nf-") || k.startsWith("x-netlify-") || k === "x-host") continue;
      if (k === "x-real-ip") { clientIp = value; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = value; continue; }
      headers[k] = value;
    }

    if (clientIp) headers["x-forwarded-for"] = clientIp;

    forwardRequest(targetUrl, req.method, headers, req, res);

  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Bad Gateway: Relay Failed");
    }
  }
});

server.listen(PORT, () => {
  console.log(`Relay running on port ${PORT}`);
});
