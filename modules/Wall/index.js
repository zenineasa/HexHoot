/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const Layout = require('./../Layout');
const dbMessenger = require('./../DBMessenger')();
const imagePack = require('../ImagePack');
const i18n = require('./../I18n')();

/**
 * This class implements the functionality for posting on public walls.
 */
 class Wall {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Wall._instance) {
            return Wall._instance;
        }
        Wall._instance = this;
    }

    /**
     * This function renders the template into the UI.
     */
    async render() {
        // Render the layout
        Layout.render();

        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        debugger; // TODO:///
    }

    /**
     * This function renders the profile icon to the icon bar. The profile icon
     * links to the page wherein the user can edit their own profile.
     * @param {function} clickCallback the callback function that is executed
     * when the icon is clicked.
     */
    async renderToIconBar() {
        const holderDOM = document.createElement('div');
        holderDOM.innerHTML = eval('`' +
            requireText('./template_iconbar.html', require) + '`');

        const iconDOMNode = holderDOM.querySelector('#wallIcon');
        iconDOMNode.onclick = function() {
            console.log('asd');
            this.render();
        }.bind(this);

        const iconBarDOMNode = document.getElementById('iconbar');
        iconBarDOMNode.appendChild(holderDOM);
    }
}

module.exports = new Wall();
