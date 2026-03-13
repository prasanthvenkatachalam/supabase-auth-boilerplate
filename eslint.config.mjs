
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: {},
  allConfig: {},
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "no-console": "warn",
      "prefer-const": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "react/self-closing-comp": "error",
      "import/order": ["error", { "alphabetize": { "order": "asc" } }]
    }
  }
];

export default eslintConfig;
