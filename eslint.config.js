// ESLint: typescript-eslint's type-aware recommended rules for all TypeScript, plus the React hooks
// rules for the widgets. Type errors are `pnpm typecheck`'s job (astro check); `.astro` files are
// not linted.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", ".astro/", ".vercel/", "src/qrtl-plugin/"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  // Config files are plain JavaScript outside the TypeScript project.
  { files: ["**/*.js", "**/*.mjs"], extends: [tseslint.configs.disableTypeChecked] },
  { files: ["src/components/**/*.tsx"], extends: [reactHooks.configs.flat.recommended] },
);
