import { createReadStream, watch } from "fs";
import { readdir, readFile } from "fs/promises";
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

function addLiveUpdateToHtml(html: string): string {
  return html.replace(
    "</body>",
    `<script type="text/javascript">${liveCode}</script></body>`
  );
}

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

async function main() {
  if (process.argv.length < 3) {
    console.error("Not enough arguments!");
    console.log(`Usage: ${process.argv.join(" ")} folder [PORT]`);
    return;
  }

  const eventSourceConnections: http.ServerResponse<http.IncomingMessage>[] =
    [];
  const folderToWatch = resolve(process.cwd(), process.argv[2]);

  /**
   * Populate a map with files that are known to exist
   *
   * Perf: avoid unncessary IO operations to see if a file exists
   * when requested
   */
  const filesKnownToExist: Map<string, boolean> = new Map();
  {
    const subFilesAndFolders = await readdir(folderToWatch, {
      recursive: true,
      withFileTypes: true,
    });

    for (const fileOrFolder of subFilesAndFolders) {
      if (fileOrFolder.isFile()) {
        filesKnownToExist.set(
          resolve(fileOrFolder.parentPath, fileOrFolder.name),
          true
        );
      }
    }
  }

  console.log(
    "Watching",
    green(folderToWatch),
    `(${filesKnownToExist.size} files)...`
  );

  /**
   * Handle each request as they come in - logging the url
   * and the time taken to respond
   */
  async function requestListener(
    req: http.IncomingMessage,
    res: http.ServerResponse<http.IncomingMessage>
  ): Promise<null> {
    // start a timer for this request
    console.time(req.url || "/");

    // Only support get requests and drop any request without a url
    if (req.method != "GET" || !req.url) {
      res.statusCode = 503;
      res.end();
      return console.timeEnd(req.url || "/");
    }

    // this is the event source handler - used to provide live-reload
    if (req.url === "/_has_update") {
      const headers = {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      };
      res.writeHead(200, headers);
      eventSourceConnections.push(res);
      return console.timeEnd(req.url);
    }

    // avoid parsing urls ourselves, just use URL
    const url = new URL(`http://localhost${req.url}`);

    // if given a directory url, try the index.html file in that dir instead
    if (url.pathname.endsWith("/")) {
      url.pathname += "index.html";
    }

    // resolve the path to make sure we use the absolute path for indexing
    const resolvedPath = resolve(folderToWatch, `.${url.pathname}`);

    // don't allow requests that are outside of the base dir
    if (!resolvedPath.startsWith(folderToWatch)) {
      console.log("Illegal access request to", resolvedPath);
      res.statusCode = 403;
      res.end();
      return console.timeEnd(req.url);
    }

    if (!filesKnownToExist.get(resolvedPath)) {
      console.error("File not found", red(resolvedPath));
      res.setHeader("Content-Length", 0);
      res.statusCode = 404;
      res.end();
      return console.timeEnd(req.url);
    }

    res.setHeader("Keep-Alive", 10);
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("content-encoding", "br");
    res.statusCode = 200;

    const brotliCompress = createBrotliCompress();

    try {
      if (url.pathname.endsWith(".html")) {
        let file = await readFile(resolvedPath, "utf-8");
        file = addLiveUpdateToHtml(file);
        Readable.from(file).pipe(brotliCompress).pipe(res);
        return console.timeEnd(req.url);
      } else {
        const readStream = createReadStream(resolvedPath, "utf-8");
        const compressed = readStream.pipe(brotliCompress);
        compressed.pipe(res);
        return console.timeEnd(req.url);
      }
    } catch (e) {
      console.error(e);
      res.statusCode = 503;
      res.end();
      return console.timeEnd(req.url);
    }
  }

  const server = http.createServer(requestListener);

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
      if (filename) {
        const fullPath = resolve(folderToWatch, filename);

        if (event === "rename") {
          const existsInMap = filesKnownToExist.get(fullPath);
          if (existsInMap) {
            filesKnownToExist.delete(fullPath);
          } else {
            filesKnownToExist.set(fullPath, true);
          }
        } else if (event === "change") {
          filesKnownToExist.set(fullPath, true);
        }
      }

      for (const connection of eventSourceConnections) {
        connection.write("data: 'reload'\n\n");
        connection.statusCode = 502;
        connection.end();
      }
      eventSourceConnections.splice(0, eventSourceConnections.length);
    }
  );

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

  server.listen(port, "::", () => {
    console.log(`Listening on port ${port}...`);
  });

  /**
   * Cleanup after the server is done
   */
  function stopServer() {
    console.log("Server stopped, killing active connections...");
    for (const connection of eventSourceConnections) {
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
