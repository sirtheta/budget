import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "**/.next/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/api/**/*.ts", "app/**/actions.ts"],
      exclude: ["**/*.test.ts"],
      // Set a few points under the numbers the suite currently reaches, so the
      // CI run that already collects coverage fails on a real regression
      // without tripping over the noise of a single refactor. Coverage was
      // collected but never enforced before, which let it drift down silently
      // — the point of a ratchet is that it only moves one way.
      //
      // Raise these when the suite genuinely improves; do not lower them to
      // make a red build green.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 88,
        lines: 87,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./") },
  },
});
