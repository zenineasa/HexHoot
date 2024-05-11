/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const utils = require('./../../../test/utils');
const Login = require('./../../../modules/Login');
const dbMessenger = require('./../../../modules/DBMessenger')();

QUnit.test('Check if Login module is available', function(assert) {
    assert.ok(typeof(Login) !== 'undefined');
});

QUnit.test('Render login and check the forms', async function(assert) {
    await utils.setFixtureWithContainerDOMElemenent();

    const login = new Login();
    login.render();

    await utils.waitAndTryAgain(async function(assert){
        // Check if the login form is loaded
        const logins = document.querySelectorAll('#login');
        assert.strictEqual(logins.length, 1,
            'There should be exactly one DIV with the id "login".');
        const inputs = document.querySelectorAll('input');
        assert.strictEqual(inputs.length, 2,
            'There should be exactly two input fields.');
        const buttons = document.querySelectorAll('button');
        assert.strictEqual(buttons.length, 2,
            'There should be exactly two buttons.');
    }, assert);
});

QUnit.test('Check if the logo is rendered', async function(assert) {
    await utils.setFixtureWithContainerDOMElemenent();

    const login = new Login();
    login.render();

    await utils.waitAndTryAgain(async function(assert){
        const logos = document.querySelectorAll('#logoWithText');
        assert.strictEqual(logos.length, 1,
            'There should be exactly one DIV with the id "logoWithText".');
        assert.strictEqual(logos[0].querySelectorAll('svg').length, 1,
            'There should be an SVG icon in the logo.');
        assert.ok(logos[0].innerText.includes('HexHoot'),
            'The logo should have "HexHoot" text on it.');
    }, assert);
});

QUnit.test('Fill in the form and check', async function(assert) {
    await utils.setFixtureWithContainerDOMElemenent();

    // Mocking window.reload() function; in the real implementation, preload
    // function defines this.
    window.reload = function() {};

    // Ensure user is logged out
    await dbMessenger.deleteDatabaseContent();

    const login = new Login();
    login.render();

    const testUserInfoValues = {
        'displayName': 'ZatMan',
        'password': 'ThisIsProbablyAGoodPassword',
    };

    await utils.waitAndTryAgain(async function(assert){
        const inputs = document.querySelectorAll(
            'input[type=text],input[type=password]');
        for (let i = 0; i < inputs.length; i++) {
            if (inputs[i].name === 'password') {
                inputs[i].value = testUserInfoValues.password;
            } else if (inputs[i].name === 'displayName') {
                inputs[i].value = testUserInfoValues.displayName;
            } else {
                assert.notOk(true, 'Form input name not defined');
            }
        }
        document.getElementById('loginButton').click();

        // Verify the data available in dbMessenger with the value provided in the
        // form; might need to wait for a short while for the information to load
        let userInfoPrivate;
        for (let i = 0; i < 10 && !userInfoPrivate; i++) {
            userInfoPrivate = await dbMessenger.getLoggedInUserInfoPrivate();
            if (!userInfoPrivate) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        assert.strictEqual(testUserInfoValues.displayName,
            userInfoPrivate.displayName,
            'Display names need to match.');

        const hexRegex = /^[0-9a-fA-F]+$/;
        assert.ok(
            hexRegex.test(userInfoPrivate.privateKey),
            'Private key is expected to be hexadecimal.'
        );
        assert.ok(
            userInfoPrivate.privateKey.length == 32,
            'Private key is expected to be 32 characters long.'
        );
    }, assert);
});
