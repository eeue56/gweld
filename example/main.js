import { helloWorld } from "./an_esm_test.js";

function main() {
  document.body.appendChild(document.createTextNode("Hi there! "));

  helloWorld();
}

main();
