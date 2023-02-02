/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

/**
 * This file contains maps to all the images that are used in the UI and helper
 * functions that enable accessing them.
 */

imagePack = {
    'branding': {
        'logoIcon': 'icon.svg',
        'favicon': 'favicon.png',
    },
    'interface': {
        'sendButton': 'send.svg',
        'defaultProfilePic': 'default_profile.svg',
    },
    'social': {
        'facebook': 'Social/Facebook.png',
        'github': 'Social/GitHub.png',
        'instagram': 'Social/Instagram.png',
        'linkedin': 'Social/LinkedIn.png',
        'reddit': 'Social/Reddit.png',
        'twitter': 'Social/Twitter.png',
        'youtube': 'Social/YouTube.png',
    },
};

/**
 * A function that returns the full path of the requested image.
 * @param {String} hierarchy hierarchy to the image
 * @return {string} image path
 */
imagePack.getPath = function(hierarchy) {
    hierarchy = hierarchy.split('.'); // to hierarchy array

    let value = imagePack[hierarchy[0]];
    for (let i = 1; i < hierarchy.length; i++) {
        value = value[hierarchy[i]];
    }

    if (typeof(value) !== 'string') {
        console.log(new Error('Hierarchy does not exist'));
    }

    return __dirname + '/images/' + value;
};

module.exports = imagePack;
