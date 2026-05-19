const GITHUB_PAGE = "https://ir-netlify.github.io/NETLIFY/";

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded", "x-forwarded-host", "x-forwarded-proto",
  "x-forwarded-port",
]);

const PORT = process.env.PORT || 8080;

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let targetHost = req.headers["x-host"];

    if (url.pathname === "/" && !targetHost) {
      const upgradeHeader = req.headers["upgrade"] || "";
      if (upgradeHeader.toLowerCase() !== "websocket") {
        const githubResponse = await fetch(GITHUB_PAGE);
        const githubContent = await githubResponse.text();
        res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
        res.end(githubContent);
        return;
      }
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

    const method = req.method;
    const fetchOptions = {
      method,
      headers,
      redirect: "manual",
      body: (method !== "GET" && method !== "HEAD") ? req : undefined,
      duplex: "half",
    };

    const upstream = await fetch(targetUrl, fetchOptions);

    const responseHeaders = {};
    for (const [key, value] of upstream.headers) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      responseHeaders[key] = value;
    }

    res.writeHead(upstream.status, responseHeaders);
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();

  } catch (error) {
    res.writeHead(502);
    res.end("Bad Gateway: Relay Failed");
  }
}

const http = require("http");
const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`Relay running on port ${PORT}`);
});
