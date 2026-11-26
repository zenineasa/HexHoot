/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// The account model (ADR-004): the identity comes from a name and a
// password, so the same two give the same identity on any device. Every
// guess costs scrypt at N=2^20 (about 8 s and 1 GiB), and the salt comes
// from the name, so each account has to be attacked on its own. Day to day
// the derived secret is kept in the keyring (OS keyring), and the password
// is never asked for; now and then the user may check that they still
// remember it (passwordCheck*).

const crypto = require('node:crypto');
const {CryptoError, encodeParts, scrypt, scryptDefaults} =
    require('./primitives');

// Fixed forever: changing any of these changes every identity
const identityScrypt = Object.freeze({...scryptDefaults});
const minNameLength = 5;
const maxNameLength = 64;
const minPasswordLength = 16;
const maxPasswordLength = 1024;

/**
 * The name as it is used for the key: Unicode NFKC, lower case, with
 * surrounding spaces removed and inner runs of spaces made single. "Alice
 * Liddell" and " alice  liddell " are the same account.
 * @param {string} name as typed
 * @return {string} the normalized name
 */
function normalizeName(name) {
    return String(name).normalize('NFKC').toLowerCase().trim()
        .replace(/\s+/g, ' ');
}

/**
 * @param {string} text a string
 * @return {number} its length in characters (code points)
 */
function characters(text) {
    return [...text].length;
}

/**
 * Check a name and password before deriving anything
 * @param {string} name as typed
 * @param {string} password as typed
 * @return {Array} problems, empty if acceptable: 'nameTooShort',
 * 'nameTooLong', 'passwordTooShort', 'passwordTooLong',
 * 'passwordContainsName', 'passwordRepetitive'
 */
function checkCredentials(name, password) {
    const problems = [];
    const normalized = normalizeName(name);
    const pass = String(password);
    if (characters(normalized) < minNameLength) {
        problems.push('nameTooShort');
    }
    if (characters(normalized) > maxNameLength) {
        problems.push('nameTooLong');
    }
    if (characters(pass) < minPasswordLength) {
        problems.push('passwordTooShort');
    }
    if (characters(pass) > maxPasswordLength) {
        problems.push('passwordTooLong');
    }
    if (normalized.length > 0 && normalizeName(pass).includes(normalized)) {
        problems.push('passwordContainsName');
    }
    if (new Set(pass).size < 5) {
        problems.push('passwordRepetitive');
    }
    return problems;
}

/**
 * Derive the 32 bytes an identity is built from (Identity.js)
 *
 *     salt    = SHA-512(parts("hexhoot/v2/identity-salt", normalizeName(name)))
 *     entropy = scrypt(NFKC(password), salt, N=2^20, r=8, p=1, 32)
 *
 * @param {string} name as typed
 * @param {string} password as typed
 * @param {Object} [options] for tests only: scryptParams, totalMemory
 * @return {Promise<Buffer>} 32 bytes
 * @throws {CryptoError} WEAK_CREDENTIALS (with 'problems'), LOW_MEMORY
 */
async function deriveEntropy(name, password, options = {}) {
    const problems = checkCredentials(name, password);
    if (problems.length > 0) {
        const err = new CryptoError('WEAK_CREDENTIALS',
            'Name or password not accepted: ' + problems.join(', '));
        err.problems = problems;
        throw err;
    }
    const salt = crypto.createHash('sha512').update(encodeParts(
        'hexhoot/v2/identity-salt', normalizeName(name))).digest();
    return scrypt(password, salt, options.scryptParams || identityScrypt,
        {totalMemory: options.totalMemory});
}

// Days between password checks. A right answer moves one step further; a
// wrong one goes back to the start, so the next check comes soon.
const checkIntervalsDays = [3, 7, 14, 30, 60, 90];
const day = 24 * 3600 * 1000;

/**
 * When to offer the next password check
 * @param {Object} state {streak, nextAt} from the last call; {} at first
 * @param {Object} event {now, result}: result is 'right', 'wrong',
 * 'skipped' (dismissed), or 'created' (account just made)
 * @return {Object} the new state {streak, nextAt}
 */
function nextPasswordCheck(state, event) {
    const streak = {
        created: 0,
        right: Math.min((state.streak || 0) + 1, checkIntervalsDays.length - 1),
        wrong: 0,
        skipped: state.streak || 0,
    }[event.result];
    if (streak === undefined) {
        throw new CryptoError('BAD_PARAMS', 'Unknown result ' + event.result);
    }
    const days = event.result === 'wrong' ? 1 :
        event.result === 'skipped' ? 2 : checkIntervalsDays[streak];
    return {streak, nextAt: event.now + days * day};
}

module.exports = {
    normalizeName, checkCredentials, deriveEntropy, nextPasswordCheck,
    limits: {minNameLength, maxNameLength, minPasswordLength,
        maxPasswordLength},
    checkIntervalsDays,
};
