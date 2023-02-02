/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const path = require('path');
const glob = require('glob');
const requireText = require('require-text');
var regex = require('copyright-regex');

QUnit.test('Check code files for copyright message', async function(assert) {
    // All files to ignore in the following checks
    const options = {
        ignore: [
            'node_modules/**/*',
            'package.json',
            'package-lock.json',
        ],
    };

    await new Promise(function(resolve, reject) {
        glob('**/*.+(html|js|json)', options, function(err, files) {
            assert.notOk(err);
            for (let i = 0; i < files.length; i++) {
                const fileContent =
                    requireText(path.join('./../../../', files[i]), require);
                const matches = fileContent.match(regex());
                assert.ok(matches[5].trim() == 'Zenin Easa Panthakkalakath',
                'Copyright message not found in: ' + files[i],
                );
            }
            resolve('All good');
        });
    });
});
