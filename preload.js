/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const i18n = require('./modules/I18n')();
const Social = require('./modules/Social');
const Copyright = require('./modules/Copyright');
const Login = require('./modules/Login');
const Chat = require('./modules/Chat');

window.addEventListener('DOMContentLoaded', function() {
    Social.render();
    Copyright.render();

    window.reload = async function() {
        i18n.render();
        const login = new Login();
        if (await login.isLoggedIn()) {
            const chat = new Chat();
            chat.render();
        } else {
            login.render();
        }
    };
    window.reload();
});
