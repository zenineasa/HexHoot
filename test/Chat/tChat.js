/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const utils = require('./../../../test/utils');
const Chat = require('./../../../modules/Chat');

const chat = new Chat();

QUnit.test('Check if Chat module is available', function(assert) {
    assert.ok(typeof(Chat) !== 'undefined');
});

QUnit.test('Render login and check the elements within', async function(assert) {
    utils.setFixtureWithContainerDOMElemenent();

    await chat.render();

    // Check the elements within
    const messageSenderInfos = document.querySelectorAll('#messageSenderInfo');
    assert.strictEqual(messageSenderInfos.length, 1,
        'There should be exactly one DIV with the id "messageSenderInfo".');

    const messageReaders = document.querySelectorAll('#messageReader');
    assert.strictEqual(messageReaders.length, 1,
        'There should be exactly one DIV with the id "messageReader".');

    const messageComposers = document.querySelectorAll('#messageComposer');
    assert.strictEqual(messageComposers.length, 1,
        'There should be exactly one DIV with the id "messageComposers".');
    assert.strictEqual(
        messageComposers[0].getElementsByTagName('textarea').length, 1,
        'There should be a textarea to type in the message.');
    assert.strictEqual(
        messageComposers[0].getElementsByClassName('send').length, 1,
        'There should be a send button.');
});
