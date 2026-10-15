import { defineConfig } from 'vitest/config';

export default defineConfig({
    root: import.meta.dirname,
    test: {
        include: ['test/unit/**/*.test.js', 'packages/*/test/unit/**/*.test.js', 'apps/*/test/unit/**/*.test.js']
    }
});
