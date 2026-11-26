/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

const crypto = require('node:crypto');
const {Identity} = require('../../modules/Crypto/Identity');

/**
 * An identity from random entropy, skipping the slow name-and-password
 * derivation that identity.test.js covers
 * @param {string} [name] account name
 * @return {Identity} the identity
 */
function randomIdentity(name = 'test user') {
    return new Identity(crypto.randomBytes(32), Date.now(), name);
}

module.exports = {randomIdentity};
