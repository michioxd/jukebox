import "@webcomponents/webcomponentsjs/webcomponents-bundle.js";
import "lit/polyfill-support.js";
import { forceElementInternalsPolyfill } from "element-internals-polyfill";
import { EventTarget as EventTargetShim } from "event-target-shim";

if (!HTMLElement.prototype.attachInternals) forceElementInternalsPolyfill(false);

try {
    new EventTarget();
} catch {
    Object.defineProperty(window, "EventTarget", { configurable: true, writable: true, value: EventTargetShim });
}

if (!window.HTMLSlotElement?.prototype.assignedElements) {
    // ShadyDOM may represent slots as ordinary elements.
    Object.defineProperty(Element.prototype, "assignedElements", {
        configurable: true,
        value(this: HTMLSlotElement, options?: AssignedNodesOptions) {
            return this.assignedNodes(options).filter((node) => node.nodeType === Node.ELEMENT_NODE);
        },
    });
}

if (!Element.prototype.toggleAttribute) {
    Element.prototype.toggleAttribute = function (name, force) {
        const enabled = force === undefined ? !this.hasAttribute(name) : force;
        if (enabled) this.setAttribute(name, "");
        else this.removeAttribute(name);
        return enabled;
    };
}

try {
    document.documentElement.matches(":focus-visible");
} catch {
    const matches = Element.prototype.matches;
    Object.defineProperty(Element.prototype, "matches", {
        configurable: true,
        writable: true,
        value(this: Element, selector: string) {
            return matches.call(this, selector === ":focus-visible" ? ":focus" : selector);
        },
    });
}

if (!("Animation" in window) || !("finished" in Animation.prototype)) {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
        // ponytail: Skip Material's decorative pseudo-element ripple on old Web Animations engines.
        if (typeof options === "object" && "pseudoElement" in options) return animate.call(this, [], 0);
        return animate.call(this, frames, options);
    };
}
