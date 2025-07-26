import { writeFile } from "fs/promises";
import {
  expect,
  MAXIMUM_EXPECTED_RESPONSE_TIME_FOR_A_SIMPLE_REQUEST_IN_MS,
  test,
} from "./fixture";

test("quickly responds", async ({ request }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body><h1>Hello World</h1></body>
</html>`.trim()
  );

  const before = performance.now();
  const response = await request.get(`http://localhost:8000/index.html`);
  const after = performance.now();

  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Hello World");

  expect(after - before).toBeLessThan(
    MAXIMUM_EXPECTED_RESPONSE_TIME_FOR_A_SIMPLE_REQUEST_IN_MS
  );
});

test("quickly responds to errors", async ({ request }) => {
  const before = performance.now();
  const response = await request.get(`http://localhost:8000/missing_page.html`);
  const after = performance.now();
  expect(response.status()).toBe(404);

  expect(after - before).toBeLessThan(
    MAXIMUM_EXPECTED_RESPONSE_TIME_FOR_A_SIMPLE_REQUEST_IN_MS
  );
});

test("handles thousands of concurrent requests", async ({ request }) => {
  await writeFile(
    "./tests/fixtures/index.html",
    `
<html>
    <body><h1>Hello World</h1></body>
</html>`.trim()
  );

  const requests = Array.from({ length: 2000 }, () =>
    request.get(`http://localhost:8000/index.html`)
  );
  const before = performance.now();
  const responses = await Promise.all(requests);
  const after = performance.now();

  for (const response of responses) {
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Hello World");
  }

  const seconds =
    2000 * MAXIMUM_EXPECTED_RESPONSE_TIME_FOR_A_SIMPLE_REQUEST_IN_MS;

  expect(after - before).toBeLessThan(seconds);

  const timePerRequest = (after - before) / 2000;
  expect(timePerRequest).toBeLessThan(20);
});

test("handles thousands of error concurrent requests", async ({ request }) => {
  const requests = Array.from({ length: 2000 }, () =>
    request.get(`http://localhost:8000/missing_page.html`)
  );
  const before = performance.now();
  const responses = await Promise.all(requests);
  const after = performance.now();

  for (const response of responses) {
    expect(response.status()).toBe(404);
  }

  const seconds =
    2000 * MAXIMUM_EXPECTED_RESPONSE_TIME_FOR_A_SIMPLE_REQUEST_IN_MS;

  expect(after - before).toBeLessThan(seconds);

  const timePerRequest = (after - before) / 2000;
  expect(timePerRequest).toBeLessThan(20);
});
