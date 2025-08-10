import { test as base, BrowserContext, Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "fs/promises";

export const MAXIMUM_EXPECTED_RESPONSE_TIME_FOR_A_SIMPLE_REQUEST_IN_MS = 30;

export const test = base.extend({
  page: async (
    { page, context }: { page: Page; context: BrowserContext },
    use: (r: Page) => Promise<void>
  ): Promise<void> => {
    await beforeAll();
    await use(page);
    await afterAll();
  },
});

async function beforeAll() {
  await mkdir("tests/fixtures", { recursive: true });
  await mkdir("tests/fixtures/empty_sub_folder", { recursive: true });
  await mkdir("tests/fixtures/sub_folder", { recursive: true });
  await writeFile("./tests/fixtures/index.html", ``.trim());
  await writeFile("./tests/fixtures/main.css", ``.trim());
  await writeFile("./tests/fixtures/index.js", ``.trim());
  await writeFile("./tests/fixtures/feed.html", ``.trim());
  await rm("./tests/fixtures/empty/index.html", { force: true });
}

async function afterAll() {
  await writeFile("./tests/fixtures/index.html", ``.trim());
  await rm("./tests/fixtures/feed.html", { force: true });
  await rm("./tests/fixtures/main.css", { force: true });
  await rm("./tests/fixtures/index.js", { force: true });
  await rm("./tests/fixtures/logo.png", { force: true });
  await rm("./tests/fixtures/empty_sub_folder", { recursive: true });
  await rm("./tests/fixtures/sub_folder", { recursive: true });
  await rm("./tests/fixtures/empty/index.html", { force: true });
}

export const expect = test.expect;

/**
 * Add this to a function to see the network requests and responses in a test
 *
 * @param page
 */
export function debugNetworkTraffic(page: Page) {
  page.on("request", (request) =>
    console.log(">>", request.method(), request.url())
  );

  page.on("response", (response) =>
    console.log("<<", response.status(), response.url())
  );
}
