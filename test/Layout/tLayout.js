/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const utils = require('./../../../test/utils');
const Layout = require('./../../../modules/Layout');

QUnit.test('Check if Layout module is available', function(assert) {
    assert.ok(typeof(Layout) !== 'undefined');
});

QUnit.test('Render the layout', async function(assert) {
    await utils.setFixtureWithContainerDOMElemenent();
    Layout.render();

    await utils.waitAndTryAgain(async function(assert){
        // Check if iconbar, sidebar and mainContent are available
        const iconbars = document.querySelectorAll('#iconbar');
        assert.strictEqual(iconbars.length, 1,
            'There should be exactly one DIV with the id "iconbar".');

        const sidebars = document.querySelectorAll('#sidebar');
        assert.strictEqual(sidebars.length, 1,
            'There should be exactly one DIV with the id "sidebar".');

        const mainContents = document.querySelectorAll('#mainContent');
        assert.strictEqual(mainContents.length, 1,
            'There should be exactly one DIV with the id "mainContent".');
    }, assert);

});

QUnit.test('Check if the logo is loaded in the sidebar', async function(assert) {
    await utils.setFixtureWithContainerDOMElemenent();
    Layout.render();

    await utils.waitAndTryAgain(async function(assert){
        const sidebars = document.querySelectorAll('#sidebar');
        const logos = sidebars[0].querySelectorAll('#logoWithText');
        assert.strictEqual(logos.length, 1,
            'There should be exactly one DIV with the id "logoWithText".');
        assert.strictEqual(logos[0].querySelectorAll('svg').length, 1,
            'There should be an SVG icon in the logo.');
        assert.ok(logos[0].innerText.includes('HexHoot'),
            'The logo should have "HexHoot" text on it.');
    }, assert);
});
