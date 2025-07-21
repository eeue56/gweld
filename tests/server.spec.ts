import { test as base, expect } from "@playwright/test";
import { mkdir, rm, writeFile } from "fs/promises";

const test = base.extend({});

test.beforeAll(async () => {
  await mkdir("tests/fixtures", { recursive: true });
  await mkdir("tests/fixtures/empty_folder", { recursive: true });
  await mkdir("tests/fixtures/sub_folder", { recursive: true });
  await writeFile("./tests/fixtures/index.html", ``.trim());
  await writeFile("./tests/fixtures/main.css", ``.trim());
  await writeFile("./tests/fixtures/index.js", ``.trim());
  await writeFile("./tests/fixtures/feed.html", ``.trim());
});

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

test("does not add live-reload code to non-html assets", async ({ page }) => {
  await writeFile("./tests/fixtures/index.js", `const hi = 5;`.trim());

  await page.goto("localhost:8000/index.js");

  await expect(page.locator("body")).toContainText("const hi = 5;");
  await expect(await page.locator("script").all()).toHaveLength(0);
});

test("blocks path traversal attempt", async ({ request }) => {
  const response = await request.get("http://localhost:8000/../../LICENSE");

  expect(response?.status()).toBe(404);
});

test("rejects access to files outside served root", async ({ request }) => {
  const response = await request.get(
    "http://localhost:8000/../../../../../../etc/hosts"
  );

  expect(response?.status()).toBe(404);
});

test("blocks encoded path traversal", async ({ request }) => {
  const response = await request.get(
    "http://localhost:8000/%2e%2e/server.spec.ts"
  );

  expect(response?.status()).toBe(404);
});

test("blocks double slash traversal", async ({ request }) => {
  const response = await request.get(
    "http://localhost:8000//..//server.spec.ts"
  );

  expect(response?.status()).toBe(404);
});

test("does not allow directory listing", async ({ request }) => {
  const response = await request.get("http://localhost:8000/empty_folder/");

  expect(response?.status()).toBe(404);
});

test.afterAll(async () => {
  await writeFile("./tests/fixtures/index.html", ``.trim());
  await rm("./tests/fixtures/feed.html");
  await rm("./tests/fixtures/main.css");
  await rm("./tests/fixtures/index.js");
  await rm("./tests/fixtures/empty_folder", { recursive: true });
  await rm("./tests/fixtures/sub_folder", { recursive: true });
});
