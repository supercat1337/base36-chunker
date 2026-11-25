// @ts-check

import test from 'ava';

import { randomChars } from '../src/base36.js';

/** @returns {PropertyDescriptor | undefined} */
function saveCrypto() {
    return Object.getOwnPropertyDescriptor(globalThis, 'crypto');
}

/** @param {PropertyDescriptor | undefined} descriptor */
function restoreCrypto(descriptor) {
    if (descriptor) {
        Object.defineProperty(globalThis, 'crypto', descriptor);
    } else {
        delete (/** @type {any} */ (globalThis).crypto);
    }
}

test.serial('randomChars: throws when crypto is undefined', t => {
    const saved = saveCrypto();
    try {
        Object.defineProperty(globalThis, 'crypto', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        t.throws(() => randomChars('abc', 1), {
            message: /getRandomValues is not available/,
        });
    } finally {
        restoreCrypto(saved);
    }
});

test.serial('randomChars: throws when getRandomValues is not a function', t => {
    const saved = saveCrypto();
    try {
        Object.defineProperty(globalThis, 'crypto', {
            value: {},
            configurable: true,
            writable: true,
        });
        t.throws(() => randomChars('abc', 1), {
            message: /getRandomValues is not available/,
        });
    } finally {
        restoreCrypto(saved);
    }
});

test.serial('randomChars: works again after restore', t => {
    t.is(randomChars('a', 3).length, 3);
});
