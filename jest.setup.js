process.env.NODE_ENV = 'test';

// Add missing DOM methods for Obsidian compatibility
HTMLElement.prototype.empty = function () {
    while (this.firstChild) {
        this.removeChild(this.firstChild);
    }
};

HTMLElement.prototype.addClass = function (className) {
    this.classList.add(className);
};

HTMLElement.prototype.removeClass = function (className) {
    this.classList.remove(className);
};

HTMLElement.prototype.createEl = function (tag, attrs, cls) {
    const el = document.createElement(tag);
    if (attrs && attrs.text) {
        el.textContent = attrs.text;
    }
    if (cls) {
        el.className = cls;
    }
    this.appendChild(el);
    return el;
};

HTMLElement.prototype.createDiv = function (className) {
    const div = document.createElement('div');
    if (className) {
        div.className = className;
    }
    this.appendChild(div);
    return div;
};

HTMLElement.prototype.createSpan = function (className) {
    const span = document.createElement('span');
    if (className) {
        span.className = className;
    }
    this.appendChild(span);
    return span;
};

// Mock window.electronAPI for electronFetch tests
Object.defineProperty(window, 'electronAPI', {
    writable: true,
    configurable: true,
    value: {
        fetch: jest.fn(),
    },
});

// Mock Response for electronFetch tests
if (typeof global.Response === 'undefined') {
    global.Response = class {
        constructor(body, init = {}) {
            this.body = body;
            this.status = init.status || 200;
            this.statusText = init.statusText || 'OK';
            this.headers = init.headers || {};
        }

        async text() {
            return typeof this.body === 'string'
                ? this.body
                : JSON.stringify(this.body);
        }

        async json() {
            const text = await this.text();
            return JSON.parse(text);
        }
    };
}

// Mock crypto.subtle for hashUtils tests - global fallback for all tests
const { TextEncoder } = require('util');

Object.defineProperty(global, 'TextEncoder', {
    value: TextEncoder,
    writable: true,
});

// Minimal crypto mock - can be overridden by individual tests
Object.defineProperty(global, 'crypto', {
    value: {
        subtle: {
            digest: jest.fn(() => {
                const buffer = new ArrayBuffer(32);
                new Uint8Array(buffer).fill(42);
                return Promise.resolve(buffer);
            }),
        },
    },
    writable: true,
});
