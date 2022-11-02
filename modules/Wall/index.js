/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const Layout = require('./../Layout');
// eslint-disable-next-line no-unused-vars
const dbMessenger = require('./../DBMessenger')();
// eslint-disable-next-line no-unused-vars
const imagePack = require('../ImagePack');
// eslint-disable-next-line no-unused-vars
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
     * @param {function} backCallback the callback function that is executed
     * when back button is clicked.
     */
    async render(backCallback) {
        // Render the layout
        Layout.render();

        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        // Sidebar related
        const sidebarDOMNode = document.getElementById('sidebar');
        sidebarDOMNode.innerHTML += eval('`' +
            requireText('./template_sidebar.html', require) + '`');
        document.getElementById('backButton').onclick = backCallback;

        // Main content related
        const mainContentDOMNode = document.getElementById('mainContent');
        mainContentDOMNode.innerHTML += eval('`' +
            requireText('./template_mainContent.html', require) + '`');

        const addPost = document.getElementById('addPost');
        const postTextArea = addPost.getElementsByTagName('textarea')[0];
        const postSendButton = addPost.getElementsByClassName('send')[0];
        postSendButton.onclick = function(event) {
            this.addWallPost(postTextArea);
        }.bind(this);
    }

    /**
     * This function renders the profile icon to the icon bar. The profile icon
     * links to the page wherein the user can edit their own profile.
     * @param {function} clickCallback the callback function that is executed
     * when the icon is clicked.
     */
    async renderToIconBar(clickCallback) {
        const holderDOM = document.createElement('div');
        holderDOM.innerHTML = eval('`' +
            requireText('./template_iconbar.html', require) + '`');

        const iconDOMNode = holderDOM.querySelector('#wallIcon');
        iconDOMNode.onclick = function() {
            this.render(clickCallback);
        }.bind(this);

        const iconBarDOMNode = document.getElementById('iconbar');
        iconBarDOMNode.appendChild(holderDOM);

        this.loadWallPosts();
    }

    /**
     * Load all posts in the wall
     */
    async loadWallPosts() {
        const wallPosts = await dbMessenger.getAllWallPosts();
        //debugger;
        // TODO: ...
    }

    /**
     * Add wall post
     * @param {object} postTextArea DOM element for the textarea where the
     * message is composed
     */
    async addWallPost(postTextArea) {
        const userInfo = await dbMessenger.getLoggedInUserInfoPublic();
        const wallPost = {
            timestamp: Date.now(),
            post: postTextArea.value.trim(),
            senderKey: userInfo.key,
        };
        dbMessenger.addWallPost(wallPost);
        this.insertPostToDOM(wallPost);
        postTextArea.value = '';
    }

    /**
     * Insert wall post to DOM
     * @param {Object} wallPost the post and other information associated with
     * it.
     */
    async insertPostToDOM(wallPost) {
        // Get user info of the poster
        const userInfo = await dbMessenger.getUserInfo(wallPost.senderKey);

        const postsDOMNode = document.getElementById('posts');
        postsDOMNode.innerHTML += eval('`' +
            requireText('./template_post.html', require) + '`');
    }

    /**
     * Get the profile pic
     * @param {string} photo either an empty string or a string that contains
     * the entire image (base64 encoded image, data URL)
     * @return {string} an image that can be used as CSS background URL
     */
    getProfilePic(photo) {
        if (photo) {
            return photo;
        } else {
            return imagePack.getPath('interface.defaultProfilePic');
        }
    }
}

module.exports = new Wall();
