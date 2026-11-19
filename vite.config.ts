import legacy from "@vitejs/plugin-legacy";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        legacy({
            targets: "Chrome >= 50, defaults",
            additionalLegacyPolyfills: ["abortcontroller-polyfill/dist/polyfill-patch-fetch.js", "intersection-observer"],
        }),
    ],
    build: {
        cssTarget: "chrome50",
        cssCodeSplit: false,
        minify: "terser",
        terserOptions: {
            parse: {
                html5_comments: false,
            },
            format: {
                comments: false,
            },
        },
    },
});
