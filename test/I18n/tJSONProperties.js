/* Copyright (c) 2023-2024 Zenin Easa Panthakkalakath */

const I18n = require('./../../../modules/I18n');

QUnit.test('Check if I18n module is available', function(assert) {
    assert.ok(typeof(I18n) !== 'undefined');
});

QUnit.test('Message for all languages', function(assert) {
    const i18n = new I18n();

    // These variables shall be filled by the low-level object
    let numLanguages = -1;
    let languageNames = [];

    const topLevelKeys = Object.keys(i18n.texts);
    for (topLevelKey of topLevelKeys) {
        if (topLevelKey !== 'coprightMessage') {
            const midLevelKeys = Object.keys(i18n.texts[topLevelKey]);
            for (midLevelKey of midLevelKeys) {
                lowLevelKeys = Object.keys(
                    i18n.texts[topLevelKey][midLevelKey]);

                if (numLanguages == -1) {
                    numLanguages = lowLevelKeys.length;
                    languageNames = lowLevelKeys;
                } else {
                    let errorMessage = 'For \'' + midLevelKey +
                        '\', expected ' + numLanguages +
                        ' languages; found ' + lowLevelKeys.length +
                        '.';
                    assert.ok(
                        numLanguages === lowLevelKeys.length,
                        errorMessage,
                    );

                    errorMessage = 'For \'' + midLevelKey +
                        ', found inconsistent language identifiers.';
                    assert.deepEqual(
                        languageNames, lowLevelKeys,
                        errorMessage,
                    );
                }
            }
        }
    }
});
