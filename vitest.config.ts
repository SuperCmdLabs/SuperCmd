import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./out/coverage",
      include: [
        "src/main/ai-provider.ts",
        "src/main/script-command-runner.ts",
        "src/main/snippet-store.ts",
        "src/main/settings-store.ts",
        "src/main/extension-platform.ts",
        "src/renderer/src/smart-calculator.ts",
      ],
      thresholds: {
        lines: 35,
        functions: 35,
        branches: 25,
        statements: 35,
      },
    },
  },
});
