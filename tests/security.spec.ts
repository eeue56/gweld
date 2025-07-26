import { expect, test } from "./fixture";

test("blocks path traversal attempt", async ({ request }) => {
  const response = await request.get("http://localhost:8000/../../LICENSE");

  expect(response?.status()).toBe(404);
});

test("blocks access to files outside served root", async ({ request }) => {
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
