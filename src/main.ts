const startup = document.getElementById("startup-message");
async function start() {
    if (import.meta.env.LEGACY) await import("./legacy-dom.ts");
    if (
        typeof customElements === "undefined" ||
        typeof Element.prototype.attachShadow !== "function" ||
        typeof HTMLElement.prototype.attachInternals !== "function" ||
        typeof globalThis.ElementInternals?.prototype.setFormValue !== "function" ||
        typeof fetch !== "function" ||
        typeof AbortController !== "function"
    ) {
        throw new Error("Missing browser APIs");
    }
    await import("./app.ts");
}

void start().catch((error: unknown) => {
    console.error("Jukebox could not start", error);
    if (startup) startup.textContent = "Jukebox could not start. Reload or try a current browser.";
});
