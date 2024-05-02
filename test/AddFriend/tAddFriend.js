/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const utils = require('./../../../test/utils');
const addFriend = require('./../../../modules/AddFriend')();
const dbMessenger = require('./../../../modules/DBMessenger')();

/**
 * Mocking the user login functionality
 */
async function mockUserLogin() {
    // Add mock user information to the database
    const info = {
        'privateKey': '11111111111111111111111111111111',
        'displayName': 'Display Name',
        'about': 'About the person!',
        'key': 0,
    };
    await dbMessenger.writeLoggedInUserInfo(info);
}

QUnit.test('Check if AddFriend module is available', function(assert) {
    assert.ok(typeof(addFriend) !== 'undefined');
});

QUnit.test('Attempting rendering', async function(assert) {
    utils.setFixtureWithContainerDOMElemenent();
    await mockUserLogin();

    await addFriend.render(function() {});

    // Check if the title and tabs are available
    const titles = document.querySelectorAll('#title');
    assert.strictEqual(titles.length, 1,
        'There should be exactly one DIV with the id "title".');
    const tabsMain = document.querySelectorAll('#tabs');
    assert.strictEqual(tabsMain.length, 1,
        'There should be exactly one DIV with the id "tabs".');

    const tabContents = document.querySelectorAll('.tabContent');
    const tabs = document.querySelectorAll('.tab');
    assert.strictEqual(tabContents.length, tabs.length,
        'There should as many tabs as contents corresponding to it.');
});

QUnit.test('Pressing back button', async function(assert) {
    utils.setFixtureWithContainerDOMElemenent();
    await mockUserLogin();

    let backButtonPressed = false;
    await addFriend.render(function() {
        backButtonPressed = true;
    });

    // Press back button
    document.getElementById('backButton').click();
    assert.true(backButtonPressed);
});

QUnit.test('Tabs and contents visibility', async function(assert) {
    utils.setFixtureWithContainerDOMElemenent();
    await mockUserLogin();

    await addFriend.render(function() {});

    // TODO: Test visibility on click of tabs
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tabContent');

    for (let i = 0; i < tabs.length; i++) {
        assert.strictEqual(getComputedStyle(tabContents[i]).display, 'none',
            'All tab contents must be invisible initially');
    }

    // Click on each tabs and see if only the corresponding tab content is
    // visible
    for (let i = 0; i < tabs.length; i++) {
        tabs[i].click();
        for (let j = 0; j < tabs.length; j++) {
            if (i == j) {
                assert.strictEqual(tabs[i].getAttribute('name'),
                    tabContents[i].id,
                    'Prefer the tabs and tab content follow the same order.',
                );
                assert.notEqual(getComputedStyle(tabContents[j]).display,
                    'none',
                    'Active tab is supposed to be visible.',
                );
            } else {
                assert.strictEqual(getComputedStyle(tabContents[j]).display,
                    'none',
                    'All tab contents other than the active one must be ' +
                        'invisible.',
                );
            }
        }
    }
});
