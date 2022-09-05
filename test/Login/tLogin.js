/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const utils = require('./../../../test/utils');
const Login = require('./../../../modules/Login');
const dbMessenger = require('./../../../modules/DBMessenger')();

QUnit.test('Check if Login module is available', function(assert) {
    assert.ok(typeof(Login) !== 'undefined');
});

QUnit.test('Render login and check the forms', function(assert) {
    utils.setFixtureWithContainerDOMElemenent();

    const login = new Login();
    login.render();

    // Check if the login form is loaded
    const logins = document.querySelectorAll('#login');
    assert.strictEqual(logins.length, 1,
        'There should be exactly one DIV with the id "login".');
    const inputs = document.querySelectorAll('input[type=text],textarea');
    assert.strictEqual(inputs.length, 3,
        'There should be exactly three input fields.');
    const buttons = document.querySelectorAll('button');
    assert.strictEqual(buttons.length, 3,
        'There should be exactly three buttons.');
});

QUnit.test('Check if the logo is rendered', function(assert) {
    utils.setFixtureWithContainerDOMElemenent();

    const login = new Login();
    login.render();

    const logos = document.querySelectorAll('#logoWithText');
    assert.strictEqual(logos.length, 1,
        'There should be exactly one DIV with the id "logoWithText".');
    assert.strictEqual(logos[0].querySelectorAll('svg').length, 1,
        'There should be an SVG icon in the logo.');
    assert.ok(logos[0].innerText.includes('HexHoot'),
        'The logo should have "HexHoot" text on it.');
});

QUnit.test('Fill in the form and check', async function(assert) {
    utils.setFixtureWithContainerDOMElemenent();

    // Mocking window.reload() function; in the real implementation, preload
    // function defines this.
    window.reload = function() {};

    const login = new Login();
    login.render();

    const testUserInfoValues = {
        'privateKey': '11111111111111111111111111111111',
        'displayName': 'Display Name',
        'about': 'About the person!',
    };

    const inputs = document.querySelectorAll('input[type=text],textarea');
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].name === 'privateKey') {
            inputs[i].value = testUserInfoValues.privateKey;
        } else if (inputs[i].name === 'displayName') {
            inputs[i].value = testUserInfoValues.displayName;
        } else if (inputs[i].name === 'about') {
            inputs[i].value = testUserInfoValues.about;
        } else {
            assert.notOk(true, 'Form input name not defined');
        }
    }
    document.getElementById('loginButton').click();

    // Verify the data available in dbMessenger with the value provided in the
    // form
    const userInfoPrivate = await dbMessenger.getLoggedInUserInfoPrivate();

    assert.strictEqual(testUserInfoValues.privateKey,
        userInfoPrivate.privateKey,
        'Private keys need to match.');
    assert.strictEqual(testUserInfoValues.displayName,
        userInfoPrivate.displayName,
        'Display names need to match.');
    assert.strictEqual(testUserInfoValues.about,
        userInfoPrivate.about,
        'About text need to match.');
});
