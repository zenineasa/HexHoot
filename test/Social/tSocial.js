/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const utils = require('./../../../test/utils');
const Social = require('./../../../modules/Social');

QUnit.test('Check if Social module is available', function(assert) {
    assert.ok(typeof(Social) !== 'undefined');
});

QUnit.test('Check the icons and links', function(assert) {
    Social.render();

    const socials = document.querySelectorAll('#social');
    assert.strictEqual(socials.length, 1,
        'There should be exactly one DIV with the id "social".');

    const images = socials[0].querySelectorAll('img');
    assert.ok(images.length > 1,
        'There has to be at least one social button.');

    // Confirm that the image files and the pages to which they are linked to
    // match
    images.forEach(function(image) {
        const filename = utils.getFileNameFromPath(image.src)
            .split('.png')[0].toLowerCase();
        assert.ok(image.getAttribute('href').includes(filename));
    });
});
