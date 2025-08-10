import { writeFile } from "fs/promises";
import { expect, test } from "./fixture";

test("loads a default html page for the root directory if one does not exist", async ({
  page,
}) => {
  const response = await page.goto("localhost:8012/index.html");
  await expect(response?.status()).toBe(200);

  await expect(await page.locator("script")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("gweld landing page");

  await writeFile(
    "./tests/fixtures/empty/index.html",
    `
<html>
    <body><h1>Hello World</h1></body>
</html>`.trim()
  );

  await expect(page.locator("h1")).toHaveText("Hello World");
});
