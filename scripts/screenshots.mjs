/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Screenshots for the README: seven real apps on a local network (as in the
// E2E tests), Sam and six friends, with a few conversations. The names and
// messages are made up.
//
//     node scripts/screenshots.mjs        writes docs/screenshots/*.png

import fs from 'node:fs';
import path from 'node:path';
import {launchNetwork} from '../test/e2e/orchestrator.mjs';

const out = path.resolve(import.meta.dirname, '..', 'docs', 'screenshots');
const me = 'Sam Rivers';
const friends = {
    maya: 'Maya Okafor',
    ravi: 'Ravi Menon',
    lena: 'Lena Fischer',
    tomas: 'Tomás Rivera',
    aiko: 'Aiko Tanaka',
    noor: 'Noor Haddad',
};
const abouts = {
    sam: 'Coffee, code and long walks',
    maya: 'Climbing on weekends',
    ravi: 'Making music at night',
    lena: 'Reading, always',
    tomas: 'Building things that last',
    aiko: 'Photography and tea',
    noor: 'Learning a new language',
};

const network = await launchNetwork({transport: 'lan',
    peers: ['sam', ...Object.keys(friends)]});
const {peers} = network;
const {sam} = peers;
const others = Object.keys(friends).map((name) => peers[name]);

/**
 * Save a screenshot of Sam's window
 * @param {string} name file name, without .png
 */
async function shot(name) {
    // Sam's window is behind the others; as if Sam were looking at it, so
    // the open chat counts as read (App: the window's focus event)
    await sam.evaluate(`window.dispatchEvent(new Event('focus'))`);
    // Let transitions and the hive settle
    await sam.evaluate(`Promise.all(document.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finish()))`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    fs.writeFileSync(path.join(out, name + '.png'), await sam.screenshot());
    console.log('Saved docs/screenshots/' + name + '.png');
}

/**
 * Have a friend send messages to Sam
 * @param {Object} from their app
 * @param {Array} texts the messages
 */
async function say(from, texts) {
    await from.openChat(sam.key);
    for (const text of texts) {
        await from.send(text);
    }
}

try {
    fs.mkdirSync(out, {recursive: true});
    await sam.resize(1280, 800, 2);
    await shot('welcome');

    await Promise.all([sam.login(me), ...Object.entries(friends).map(
        ([name, displayName]) => peers[name].login(displayName))]);
    await Promise.all(Object.entries(abouts).map(([name, about]) =>
        peers[name].core('writeLoggedInUserInfo', {about})));
    await Promise.all(Object.values(peers).map((app) =>
        app.waitForTransports()));

    // Sam knocks on each; each lets Sam in
    for (const friend of others) {
        await sam.addFriend(friend.key);
    }
    await Promise.all(others.map((friend) =>
        friend.acceptFriendRequest(sam.key, 60000)));
    for (const [name, displayName] of Object.entries(friends)) {
        await sam.waitForFriend(peers[name].key, displayName, 60000);
    }

    // A conversation with Maya
    const {maya, ravi, lena, aiko} = peers;
    await sam.openChat(maya.key);
    await maya.openChat(sam.key);
    const chat = [
        [maya, 'Are we still on for the climbing gym on Saturday?'],
        [sam, 'Yes! 10 o\'clock works for me'],
        [maya, 'Great. I\'ll bring the spare shoes for you'],
        [sam, 'You\'re the best 🙌'],
        [maya, 'Also, have you seen the new route they set? It looks ' +
            'impossible. Lena tried it last week and said the crux is a ' +
            'long reach to a tiny crimp, right at the top.'],
        [sam, 'Then that is our project for the month'],
        [maya, '🧗'],
    ];
    for (const [from, text] of chat) {
        await from.send(text);
        if (from === maya) {
            await sam.waitForMessage(text, 30000);
        } else {
            await maya.waitForMessage(text, 30000);
        }
    }
    await sam.openContact();
    await sam.verify();
    await sam.press('Escape');

    // Others write while Sam reads Maya's chat: their cells light up
    await say(ravi, ['Sent you the demo, tell me what you think']);
    await say(lena, ['Book club moved to Thursday', 'Same place as before']);
    await say(aiko, ['The photos from the trip are ready 📷']);
    await sam.waitFor(`document.querySelectorAll('#hive .badge').length >= 3`,
        30000);

    await shot('chat');
    await sam.openContact();
    await shot('contact');
    await sam.press('Escape');

    // Home: the whole hive
    await sam.press('Escape');
    await sam.waitFor(`document.getElementById('home')`);
    await shot('hive');

    // The same in the day theme
    await sam.evaluate(`document.documentElement.dataset.theme = 'day'`);
    await sam.openChat(maya.key);
    await shot('chat-day');
    await sam.evaluate(`document.documentElement.dataset.theme = 'night'`);
} finally {
    await network.close();
}
