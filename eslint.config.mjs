import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: [
      "lib/vendor/manual-router-authority-v2/manual-router-portable.v2.mjs",
    ],
    rules: {
      "@next/next/no-assign-module-variable": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".vercel/**",
    ".codex-temp-programmable-readme-gif/**",
    "node_modules/**",
    "work/**",
    "contracts/lib/**",
    "contracts/out/**",
    "contracts/cache/**",
    "contracts/broadcast/**",
    "indexer/.envio/**",
    "indexer/envio-env.d.ts",
    "ops/**/.cre_build_tmp.*",
    "ops/**/binary.wasm",
  ]),
]);
