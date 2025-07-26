import { cp, writeFile } from "fs/promises";
import { expect, test } from "./fixture";

test("loads the index page", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body><h1>Hello World</h1></body>
</html>`.trim()
  );

  const response = await page.goto("localhost:8000/");
  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello World");
});

test("loads a given page", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body><h1>Hello World</h1></body>
</html>`.trim()
  );

  const response = await page.goto("localhost:8000/index.html");
  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello World");
});

test("supports ESM", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body>
        <h1>Hello World</h1>
        <div id="message"></div>
        <script src="./main.js" type="module" />
    </body>
</html>`.trim()
  );

  await writeFile(
    "./tests/fixtures/main.js",
    `
import {helloWorld} from "./helloworld.js"

helloWorld();
`.trim()
  );

  await writeFile(
    "./tests/fixtures/helloworld.js",
    `
export function helloWorld() {
  document.getElementById("message").appendChild(
    document.createTextNode("Welcome")
  );
}
`.trim()
  );

  const response = await page.goto("localhost:8000/index.html");
  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(page.locator("#message")).toHaveText("Welcome");
});

test("loads images with the right mimetype", async ({ request }) => {
  await cp("./example/logo.png", "./tests/fixtures/logo.png");

  const response = await request.get("http://localhost:8000/logo.png");
  await expect(response?.status()).toBe(200);
  await expect(response?.headers()).toHaveProperty("content-type");
  await expect(response?.headers()["content-type"]).toBe("image/png");
});

test("live reloads when index changes", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body><h1>Hello World</h1></body>
</html>`.trim()
  );

  const response = await page.goto("localhost:8000/index.html");
  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(await page.locator("script").all()).toHaveLength(1);

  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body><h1>Goodbye Everyone</h1></body>
</html>`.trim()
  );

  await expect(page.locator("h1")).toHaveText("Goodbye Everyone");
  await expect(await page.locator("script").all()).toHaveLength(1);
});

test("live reloads when assets change", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
  <head>
    <link rel="stylesheet" type="text/css" href="main.css" />
  </head>
  <body>
    <h1>Hello World</h1>
    <div id="date"></div>
    <script type="text/javascript">
      document.getElementById("date").appendChild(
        document.createTextNode(new Date().getTime())
      );
    </script>
  </body>
</html>`.trim()
  );

  const response = await page.goto("localhost:8000/index.html");

  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(await page.locator("script").all()).toHaveLength(2);

  const firstDate = await page.locator("#date").innerText();

  await writeFile(
    "./tests/fixtures/main.css",
    `body { background-color: red; }`.trim()
  );

  await page.waitForTimeout(50);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(await page.locator("script").all()).toHaveLength(2);

  const secondDate = await page.locator("#date").innerText();

  expect(parseInt(firstDate, 10)).toBeLessThan(parseInt(secondDate, 10));
});

test("live reloads non-index html pages", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/feed.html",
    `
<html>
    <body><h1>Hello Space</h1></body>
</html>`.trim()
  );

  const response = await page.goto("localhost:8000/feed.html");

  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello Space");
  await expect(await page.locator("script").all()).toHaveLength(1);

  await writeFile(
    "./tests/fixtures/feed.html",
    `
<html>
    <body><h1>Goodbye Space</h1></body>
</html>`.trim()
  );

  await expect(page.locator("h1")).toHaveText("Goodbye Space");
  await expect(await page.locator("script").all()).toHaveLength(1);
});

test("live reloads sub-directory index html page", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/sub_folder/index.html",
    `
<html>
    <body><h1>Hello Space</h1></body>
</html>`.trim()
  );

  const response = await page.goto("localhost:8000/sub_folder/");

  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello Space");
  await expect(await page.locator("script").all()).toHaveLength(1);

  await writeFile(
    "./tests/fixtures/sub_folder/index.html",
    `
<html>
    <body><h1>Goodbye Space</h1></body>
</html>`.trim()
  );

  await expect(page.locator("h1")).toHaveText("Goodbye Space");
  await expect(await page.locator("script").all()).toHaveLength(1);
});

test("live reloads ESM", async ({ page }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body>
        <h1>Hello World</h1>
        <div id="message"></div>
        <script src="./main.js" type="module"></script>
    </body>
</html>`.trim()
  );

  await writeFile(
    "./tests/fixtures/main.js",
    `
import {helloWorld} from "./helloworld.js"

helloWorld();
`.trim()
  );

  await writeFile(
    "./tests/fixtures/helloworld.js",
    `
export function helloWorld() {
  document.getElementById("message").appendChild(
    document.createTextNode("Welcome")
  );
}
`.trim()
  );

  const response = await page.goto("localhost:8000/index.html");
  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(page.locator("#message")).toHaveText("Welcome");
  await writeFile(
    "./tests/fixtures/helloworld.js",
    `export function helloWorld() {
  document.getElementById("message").appendChild(
    document.createTextNode("Goodbye")
  );
}
`.trim()
  );

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(page.locator("#message")).toHaveText("Goodbye");
});

test("live reloads when images change", async ({ page }) => {
  await cp("./example/logo.png", "./tests/fixtures/logo.png");
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
  <head>
    <link rel="stylesheet" type="text/css" href="main.css" />
  </head>
  <body>
    <h1>Hello World</h1>
    <div id="date"></div>
    <img src="./logo.png" />
    <script type="text/javascript">
      document.getElementById("date").appendChild(
        document.createTextNode(new Date().getTime())
      );
    </script>
  </body>
</html>`.trim()
  );

  // make sure that the request for live reload happens before we do anything else
  const promiseWaitForLiveReload = page.waitForRequest(/_has_update$/);
  const response = await page.goto("localhost:8000/index.html");

  await expect(response?.status()).toBe(200);

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(await page.locator("script").all()).toHaveLength(2);

  await promiseWaitForLiveReload;

  const firstDate = await page.locator("#date").innerText();

  await cp("./example/logo.png", "./tests/fixtures/logo.png");

  await page.waitForResponse(/\.png$/);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.locator("h1")).toHaveText("Hello World");
  await expect(await page.locator("script").all()).toHaveLength(2);

  const secondDate = await page.locator("#date").innerText();

  expect(parseInt(firstDate, 10)).toBeLessThan(parseInt(secondDate, 10));
});

test("does not add live-reload code to non-html assets", async ({ page }) => {
  await writeFile("./tests/fixtures/index.js", `const hi = 5;`.trim());

  await page.goto("localhost:8000/index.js");

  await expect(page.locator("body")).toContainText("const hi = 5;");
  await expect(await page.locator("script").all()).toHaveLength(0);
});
