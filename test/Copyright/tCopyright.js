/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const Copyright = require('./../../../modules/Copyright');

QUnit.test('Check if Copyright module is available', function(assert) {
    assert.ok(typeof(Copyright) !== 'undefined');
});

QUnit.test('Check the text in the copyright message', function(assert) {
    Copyright.render();

    const copyrights = document.querySelectorAll('#copyright');
    assert.strictEqual(copyrights.length, 1,
        'There should be exactly one DIV with the id "copyright".');

    assert.ok(copyrights[0].innerText.includes('Copyright'));
});
