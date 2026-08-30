import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL(".", import.meta.url);
const output = new URL("./dist/", root);
const files = [
  "app.js",
  "claim-discovery.json",
  "custom-v2-release.json",
  "index.html",
  "logic.mjs",
  "styles.css",
  "view-state.mjs",
];

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });

await Promise.all(
  files.map((file) => cp(new URL(file, root), new URL(file, output))),
);
await cp(
  new URL("./assets/programmable-loop-mark-64.png", root),
  new URL("./favicon.ico", output),
);
await Promise.all(
  ["assets", "fonts"].map(async (directory) => {
    await mkdir(new URL(`${directory}/`, output), { recursive: true });
    await cp(new URL(`${directory}/`, root), new URL(`${directory}/`, output), {
      recursive: true,
    });
  }),
);

console.log(`Built static claim app at ${join(root.pathname, "dist")}`);
