#!/usr/bin/env node

import { execSync } from "child_process";
import { createReadStream, watch } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import * as http from "http";
import { resolve } from "path";
import { Readable } from "stream";
import { createBrotliCompress } from "zlib";

/**
 * The code that is injected into HTML response to provide live-reload
 */
const liveCode = `
(function () {
    const eventSource = new EventSource("/_has_update");
    eventSource.onmessage = () => {
        console.log("Reloading");
        window.location.reload();
    }
    eventSource.onerror = () => {
      eventSource.close();
    }
})();
`;

/**
 * Adds the live-reload code to a html string
 */
function addLiveUpdateToHtml(html: string): string {
  return html.replace(
    "</body>",
    `<script type="text/javascript">${liveCode}</script></body>`
  );
}

const defaultHtmlIfIndexMissing = addLiveUpdateToHtml(`
<html>
  <body>
    <h1>gweld landing page</h1>
    <div>No index.html found yet, try adding one</div>
  </body>
</html>
`);

/**
 * Make text green for the cli
 */
function green(str: string): string {
  return `\x1b[32m\x1b[1m${str}\x1b[0m`;
}

/**
 * Make text red for the cli
 */
function red(str: string): string {
  return `\x1b[31m${str}\x1b[0m`;
}

/**
 * Modify console's type for time/timeEnd to ensure that you're
 * passing valid things to it as a label, but also so that you can enforce timeEnd
 * being called as the return value in the function
 *
 * The return values aren't actually used, so we can safely do this hack
 */
interface Console extends globalThis.Console {
  time: (label: string) => void;
  timeEnd: (label: string) => null;
}
const console = globalThis.console as Console;

/**
 * ConnectionId: sequential numbers
 */
type ConnectionId = number;

/**
 * Url path, e.g localhost:8000/file.js
 */
type UrlPath = string;

/**
 * Resolved path to file locally, e.g $HOME/file.js
 */
type ResolvedPath = string;

/**
 * ServerResponse (res) connection
 */
type Connection = http.ServerResponse<http.IncomingMessage>;

const mimeTypeCache: Map<ResolvedPath, string> = new Map();

/**
 * Get the mime type from a path using `file`.
 * Uses a cache to avoid messy/expensive `execSync` calls.
 *
 * @param filePath
 * @returns
 */
function getMimeType(filePath: string): string {
  if (!mimeTypeCache.has(filePath)) {
    const extension = filePath.split(".").pop();

    switch (extension) {
      case "css": {
        mimeTypeCache.set(filePath, "text/css");
        break;
      }
      case "html": {
        mimeTypeCache.set(filePath, "text/html");
        break;
      }
      case "js": {
        mimeTypeCache.set(filePath, "application/javascript");
        break;
      }
      case "mp4": {
        mimeTypeCache.set(filePath, "video/mp4");
        break;
      }
      case "ttf": {
        mimeTypeCache.set(filePath, "font/ttf");
      }
      default: {
        mimeTypeCache.set(
          filePath,
          execSync(`file --mime-type -b ${filePath}`).toString().trim()
        );
        break;
      }
    }
  }

  return mimeTypeCache.get(filePath) as string;
}

/**
 * specific headers for event streams
 */
const eventStreamHeaders = {
  "Content-Type": "text/event-stream",
  Connection: "keep-alive",
  "Cache-Control": "no-cache",
};

/**
 * Remove the closed connections from our internal connection maps
 *
 * @param closedConnectionIds
 * @param eventSourceConnections
 * @param connectionsByUrlPath
 */
function cleanupClosedConnections(
  closedConnectionIds: Set<number>,
  eventSourceConnections: Map<ConnectionId, Connection>,
  connectionsByUrlPath: Map<UrlPath, Set<ConnectionId>>
) {
  for (const closedId of closedConnectionIds) {
    eventSourceConnections.delete(closedId);

    for (const connections of connectionsByUrlPath.values()) {
      connections.delete(closedId);
    }
  }
}

/**
 * Tell all the given connection ids to reload their connection
 *
 * @param uniqueConnectionIds
 * @param eventSourceConnections
 */
function sendReloadMessages(
  uniqueConnectionIds: Set<ConnectionId>,
  eventSourceConnections: Map<ConnectionId, Connection>
): void {
  for (const connectionId of uniqueConnectionIds) {
    const connection = eventSourceConnections.get(connectionId);

    if (!connection || connection.closed) continue;

    connection.write("data: 'reload'\n\n");
    connection.statusCode = 502;
    connection.end();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.error("Not enough arguments!");
    console.log(`Usage: @eeue56/gweld folder [PORT]`);
    return;
  }

  // default to 8000, just like Python's http.server
  let port: number = 8000;

  // try to parse the port if there's an arg for it
  if (process.argv.length > 3) {
    const maybePort = parseInt(process.argv[3], 10);
    if (maybePort) {
      port = maybePort;
    } else {
      console.error(
        "You gave",
        process.argv[3],
        "as the port. It's not a number."
      );
      console.error("Exiting...");
      process.exit();
    }
  }

  /**
   * Primarly used to keep track of the live-reload event source connections
   *
   * 0: req, 1: req, etc
   */
  const internal_eventSourceConnections: Map<ConnectionId, Connection> =
    new Map();

  /**
   * Keep track of event sources connection IDs based on the referer / original
   * url that started the request
   *
   * "/index.html" -> { 1 }
   *
   * @param key referer or original url path
   * @param value the connection ids of the listening eventsources for reload
   */
  const internal_connectionsByUrlPath: Map<
    UrlPath,
    Set<ConnectionId>
  > = new Map();

  /**
   * "$HOME/main.js" -> [ "localhost:8000/index.html" ]
   *
   * @param key the resolved path of the asset that referred another
   * @param value the url paths that the resolved path ends up referring
   */
  const internal_filesThatReferredAConnection: Map<ResolvedPath, UrlPath[]> =
    new Map();

  /**
   * "localhost:8000/main.js" -> "$HOME/main.js"
   *
   * @param key a url path for a specific asset
   * @param value the resolved path for that asset
   */
  const internal_resolvedPaths: Map<UrlPath, ResolvedPath> = new Map();

  const folderToWatch = resolve(process.cwd(), process.argv[2]);

  /**
   * Populate a map with files that are known to exist
   *
   * Perf: avoid unncessary IO operations to see if a file exists
   * when requested
   */
  const filesKnownToExist: Set<string> = new Set();
  {
    const subFilesAndFolders = await readdir(folderToWatch, {
      recursive: true,
      withFileTypes: true,
    });

    for (const fileOrFolder of subFilesAndFolders) {
      if (fileOrFolder.isFile()) {
        const resolved = resolve(fileOrFolder.parentPath, fileOrFolder.name);
        filesKnownToExist.add(resolved);
        getMimeType(resolved);
      }
    }
  }

  console.log(
    "Watching",
    green(folderToWatch),
    `(${filesKnownToExist.size} files)...`
  );

  /**
   * The ID for each connection is incremented each time a new connection happens
   *
   * We use this for labelling each request, along with providing an ID for
   * live-reloading
   *
   * Most requests will be short-lived, so the ID won't stick around. EventSource
   * requests will be long-lived, so their ID is important.
   */
  let connectionCountId: number = 0;

  /**
   * Handle each request as they come in - logging the url
   * and the time taken to respond
   */
  async function requestListener(
    req: http.IncomingMessage,
    res: http.ServerResponse<http.IncomingMessage>
  ): Promise<null> {
    connectionCountId++;

    // make sure each connection gets a unique id (label for console.time)
    const label =
      `id: ${connectionCountId}, ` +
      green(new Date().toLocaleString("en-GB")) +
      " " +
      (req.url || "/");

    // start a timer for this request
    console.time(label);

    // Only support get requests and drop any request without a url
    if (req.method != "GET" || !req.url) {
      res.statusCode = 503;
      res.end();
      return console.timeEnd(label);
    }

    // avoid parsing urls ourselves, just use URL
    const url = new URL(`http://localhost:${port}${req.url}`);

    const referer = req.headers.referer || url.toString();

    const normalizedReferer = referer.endsWith("/")
      ? referer + "index.html"
      : referer;

    // this is the event source handler - used to provide live-reload
    if (req.url === "/_has_update") {
      res.writeHead(200, eventStreamHeaders);

      internal_eventSourceConnections.set(connectionCountId, res);

      const previousValue =
        internal_connectionsByUrlPath.get(normalizedReferer) || new Set();

      previousValue.add(connectionCountId);
      internal_connectionsByUrlPath.set(normalizedReferer, previousValue);

      return console.timeEnd(label);
    }

    // if given a directory url, try the index.html file in that dir instead
    if (url.pathname.endsWith("/")) {
      url.pathname += "index.html";
    }

    const urlString = url.toString();

    if (!internal_resolvedPaths.has(urlString)) {
      const newResolve = resolve(folderToWatch, `.${url.pathname}`);
      internal_resolvedPaths.set(urlString, newResolve);
    }

    // resolve the path to make sure we use the absolute path for indexing
    const resolvedPath = internal_resolvedPaths.get(urlString) as string;

    // don't allow requests that are outside of the base dir
    if (!resolvedPath.startsWith(folderToWatch)) {
      console.error("Illegal access request to", resolvedPath);
      res.statusCode = 403;
      res.end();
      return console.timeEnd(label);
    }

    const otherReferers =
      internal_filesThatReferredAConnection.get(resolvedPath);

    if (otherReferers) {
      otherReferers.push(normalizedReferer);
    } else {
      internal_filesThatReferredAConnection.set(resolvedPath, [
        normalizedReferer,
      ]);
    }

    if (!filesKnownToExist.has(resolvedPath)) {
      if (url.pathname === "/index.html") {
        res.setHeader("Keep-Alive", 10);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.write(defaultHtmlIfIndexMissing);
        res.end();
        return console.timeEnd(label);
      }

      console.error("File not found", red(resolvedPath));
      res.setHeader("Content-Length", 0);
      res.statusCode = 404;
      res.end();
      return console.timeEnd(label);
    }

    res.setHeader("Keep-Alive", 10);
    res.statusCode = 200;

    const mimeType = getMimeType(resolvedPath);
    res.setHeader("Content-Type", mimeType);

    try {
      if (mimeType.includes("image")) {
        res.setHeader("Cache-Control", "10");
        const file = await readFile(resolvedPath);
        Readable.from(file).pipe(res);
        return console.timeEnd(label);
      } else if (mimeType.includes("video")) {
        const range = req.headers.range;

        // if there's no range, fall back to just serve the entire file
        //... but if we have a range, let's chunk it
        if (!range) {
          res.setHeader("Cache-Control", "10");
          const file = await readFile(resolvedPath);
          Readable.from(file).pipe(res);
          return console.timeEnd(label);
        }

        const videoSize = (await stat(resolvedPath)).size;
        const CHUNK_SIZE = 1000 * 1000;

        // get rid of any of the bytes= parts
        const start = Number(range.replace(/\D/g, ""));
        const end = Math.min(start + CHUNK_SIZE, videoSize - 1);

        // Create headers
        const contentLength = end - start + 1;
        const headers = {
          "Content-Range": `bytes ${start}-${end}/${videoSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": contentLength,
          "Content-Type": mimeType,
        };

        // HTTP Status 206 for Partial Content
        res.writeHead(206, headers);

        createReadStream(resolvedPath, { start, end }).pipe(res);

        return console.timeEnd(label);
      }

      const brotliCompress = createBrotliCompress();
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Content-Encoding", "br");

      if (mimeType === "text/html") {
        const file = await readFile(resolvedPath, "utf-8").then(
          addLiveUpdateToHtml
        );

        Readable.from(file).pipe(brotliCompress).pipe(res);
        return console.timeEnd(label);
      } else {
        const readStream = createReadStream(resolvedPath, "utf-8");
        const compressed = readStream.pipe(brotliCompress);
        compressed.pipe(res);
        return console.timeEnd(label);
      }
    } catch (e) {
      console.error(e);
      res.statusCode = 503;
      res.end();
      return console.timeEnd(label);
    }
  }

  /**
   * Watch the folder recursively
   *
   * If the event is "rename", it might be:
   * 1. A file deletion
   * 2. A file rename
   *
   * If it's already in the map, remove it. If it's not in the map, add it.
   *
   * If a file triggers a change, add it to the map.
   *
   * On each change, tell all active connections to reload. Then close each
   * connection, then remove them all.
   */
  watch(
    folderToWatch,
    { recursive: true },
    (event: string | null, filename: string | null) => {
      if (!filename) return;

      // special handling for chrome editing of files
      if (filename.endsWith(".crswap")) {
        if (event === "change") return;
        filename = filename.replace(/\.crswap$/, "");
      }

      const fullPath = resolve(folderToWatch, filename);

      if (event === "rename") {
        if (filesKnownToExist.has(fullPath)) {
          filesKnownToExist.delete(fullPath);
        } else {
          filesKnownToExist.add(fullPath);
        }
      } else if (event === "change") {
        filesKnownToExist.add(fullPath);
      }

      const urlPaths =
        internal_filesThatReferredAConnection.get(fullPath) || [];

      const processedPaths: ResolvedPath[] = [fullPath];

      // expand url path references to find the original request
      for (const urlPath of urlPaths.slice()) {
        // we don't need to investigate html
        if (urlPath.endsWith("html")) {
          continue;
        }

        const resolved = internal_resolvedPaths.get(urlPath);

        if (!resolved || processedPaths.includes(resolved)) {
          continue;
        }

        processedPaths.push(fullPath);
        urlPaths.push(
          ...(internal_filesThatReferredAConnection.get(resolved) || [])
        );
      }

      if (urlPaths.length === 0) {
        return;
      }

      const uniqueConnectionIds: Set<number> = new Set();

      for (const urlPath of urlPaths) {
        const connections = internal_connectionsByUrlPath.get(urlPath);
        if (!connections) continue;

        for (const connectionId of connections) {
          uniqueConnectionIds.add(connectionId);
        }
      }

      sendReloadMessages(uniqueConnectionIds, internal_eventSourceConnections);

      cleanupClosedConnections(
        uniqueConnectionIds,
        internal_eventSourceConnections,
        internal_connectionsByUrlPath
      );
    }
  );

  const server = http.createServer(requestListener);

  server.listen(port, "::", () => {
    console.log(`Listening on port ${port}...`);
  });

  /**
   * Cleanup after the server is done
   */
  function stopServer() {
    console.log("Server stopped, killing active connections...");
    for (const connection of internal_eventSourceConnections.values()) {
      connection.statusCode = 502;
      connection.end();
    }
    server.close();
    process.exit();
  }

  process.on("SIGINT", stopServer);
  process.on("SIGTERM", stopServer);
}

main();
