/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

const requireText = require('require-text');
const imagePack = require('../ImagePack');

/**
 * This class implements the module to get the logo as a DOM element or as an
 * HTML string
 */
class Logo {
    /**
     * This function returns a DOM element containing the logo
     * @param {number} zoomVal scale the logo; value ranges between 0 and 1
     * @return {string} The DOM element which contains the logo
     */
    static getDOMElement(zoomVal = 1) {
        // Link css
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = __dirname + '/style.css';
        document.body.appendChild(link);

        const elem = document.createElement('div');
        elem.innerHTML = requireText('./template.html', require);
        elem.getElementsByClassName('logo')[0].innerHTML =
            requireText(imagePack.getPath('branding.logoIcon'), require);

        elem.children[0].style.zoom = zoomVal.toString();
        return elem;
    }

    /**
     * This function returns an HTML string containing the logo
     * @param {number} zoomVal scale the logo; value ranges between 0 and 1
     * @return {string} The HTML string which contains the logo
     */
    static getHTML(zoomVal = 1) {
        return Logo.getDOMElement(zoomVal).innerHTML;
    }
}

module.exports = Logo;
