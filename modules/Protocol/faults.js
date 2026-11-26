/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Fault injection for tests (HEXHOOT_TEST_FAULTS, see Main/testHooks.js):
// wraps a carrier so that the envelopes it sends are dropped, duplicated,
// delayed or reordered. The protocol must deliver every message once and
// in a state both sides agree on regardless (Protocol/Messenger.js).

/**
 * Parse "drop:0.1,dup:0.05,reorder:0.1,delay:0-500"
 * @param {string} spec the faults
 * @return {Object} {drop, dup, reorder, delay: [min, max]}
 */
function parseFaults(spec) {
    const faults = {drop: 0, dup: 0, reorder: 0, delay: [0, 0]};
    for (const item of String(spec).split(',').map((s) => s.trim())
        .filter(Boolean)) {
        const [name, value] = item.split(':');
        if (name === 'delay') {
            const [min, max = min] = String(value).split('-').map(Number);
            if (!(min >= 0 && max >= min)) {
                throw new Error('Invalid fault: ' + item);
            }
            faults.delay = [min, max];
        } else if (['drop', 'dup', 'reorder'].includes(name)) {
            const p = Number(value);
            if (!(p >= 0 && p < 1)) {
                throw new Error('Invalid fault: ' + item);
            }
            faults[name] = p;
        } else {
            throw new Error('Unknown fault: ' + item);
        }
    }
    return faults;
}

/**
 * Wrap a carrier so that what it sends suffers the faults
 * @param {Object} carrier a carrier (DhtCarrier, LanCarrier, ...)
 * @param {Object} faults from parseFaults
 * @param {function} [random] () => [0, 1)
 * @return {Object} a carrier with the same interface
 */
function withFaults(carrier, faults, random = Math.random) {
    const [min, max] = faults.delay;
    const stats = {sent: 0, dropped: 0, duplicated: 0, reordered: 0};
    const faulty = (send) => {
        stats.sent++;
        if (random() < faults.drop) {
            stats.dropped++;
            return;
        }
        const copies = random() < faults.dup ? 2 : 1;
        stats.duplicated += copies - 1;
        for (let i = 0; i < copies; i++) {
            let delay = min + random() * (max - min);
            if (random() < faults.reorder) {
                // Held back long enough for later envelopes to overtake it
                stats.reordered++;
                delay += max + 50;
            }
            if (delay > 0) {
                setTimeout(send, delay).unref?.();
            } else {
                send();
            }
        }
    };
    // The same wrapper for the same link: Messenger orders frames per link
    const links = new WeakMap();
    const wrap = (link) => {
        if (!links.has(link)) {
            links.set(link, Object.assign(Object.create(link), {
                reply: (envelope, ...rest) =>
                    faulty(() => link.reply(envelope, ...rest)),
            }));
        }
        return links.get(link);
    };
    const overrides = {
        stats,
        onFrame: (func) => carrier.onFrame((envelope, link) =>
            func(envelope, wrap(link))),
        send: (topic, envelope) =>
            faulty(() => carrier.send(topic, envelope)),
    };
    // Everything else is the carrier's own, run on the carrier itself
    return new Proxy(carrier, {
        get(target, name) {
            if (Object.hasOwn(overrides, name)) {
                return overrides[name];
            }
            const value = target[name];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

module.exports = {parseFaults, withFaults};
