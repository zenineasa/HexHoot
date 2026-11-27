/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// "Add a friend": a dialog over anything. Paste their address (checked as
// you type: your own address, someone already in your hive, someone you
// already knocked on), and share yours. Knocking selects their new
// "waiting" cell.

import dbMessenger, {errorCode} from '../DBMessenger/index.mjs';
import {t, icon, groupedAddress, displayName, toast, copyWithFeedback}
    from '../UI/index.mjs';
import * as sanitize from '../Sanitize/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));

/**
 * The Add a friend dialog
 */
export default class AddFriend {
    /**
     * Open the dialog
     * @param {Object} app the App
     */
    static async open(app) {
        await styleLoaded;
        if (document.getElementById('addFriendDialog')) {
            return;
        }
        const mine = app.data.me.key;
        const dialog = document.createElement('dialog');
        dialog.id = 'addFriendDialog';
        dialog.className = 'hh-dialog';
        dialog.setAttribute('aria-labelledby', 'addFriendTitle');
        dialog.innerHTML = html`
            <div class="head">
                <h2 id="addFriendTitle">${t('Hive.addFriend')}</h2>
                <button class="hh-icon" name="close"
                    aria-label="${t('Contact.close')}">
                    ${icon('close', 18)}</button>
            </div>
            <div class="body">
                <label class="hh-label" for="theirPublicKey">
                    ${t('AddFriend.theirAddress')}</label>
                <div class="their">
                    <input id="theirPublicKey" class="hh-input mono"
                        placeholder="hh21…" spellcheck="false"
                        autocomplete="off">
                    <button class="hh-btn hh-primary" id="knockButton"
                        disabled>${t('AddFriend.knock')}</button>
                </div>
                <div class="hh-hint" id="addFriendHint" aria-live="polite">
                    ${t('AddFriend.spaces')}</div>
            </div>
            <div class="foot">
                <div class="hh-label">${t('AddFriend.yourAddress')}</div>
                <div class="mine mono" data-testid="my-address">
                    ${groupedAddress(mine)}</div>
                <div class="hh-row">
                    <button class="hh-btn hh-secondary" name="copy">
                        ${t('AddFriend.copyToClipboard')}</button>
                </div>
                <div class="hh-hint">${t('AddFriend.myHint')}</div>
            </div>`.toString();
        document.body.appendChild(dialog);

        const input = dialog.querySelector('#theirPublicKey');
        const knock = dialog.querySelector('#knockButton');
        const close = () => {
            dialog.close();
            dialog.remove();
        };
        dialog.querySelector('[name=close]').onclick = close;
        dialog.oncancel = (event) => {
            event.preventDefault();
            close();
        };
        // A click on the backdrop (outside the box) closes it
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                close();
            }
        });
        const copy = dialog.querySelector('[name=copy]');
        copy.onclick = () => copyWithFeedback(mine, copy);
        input.oninput = () => AddFriend.check(app, dialog, close);
        input.onkeydown = (event) => {
            if (event.key === 'Enter' && !knock.disabled) {
                knock.click();
            }
        };
        knock.onclick = () => AddFriend.knock(app, dialog, close);
        dialog.showModal();
        input.focus();
    }

    /**
     * Check the address as it is typed
     * @param {Object} app the App
     * @param {HTMLDialogElement} dialog the dialog
     * @param {function} close closes it
     * @return {string} the cleaned address, if it may be knocked on
     */
    static check(app, dialog, close) {
        const input = dialog.querySelector('#theirPublicKey');
        const knock = dialog.querySelector('#knockButton');
        const hint = dialog.querySelector('#addFriendHint');
        const key = input.value.replace(/\s+/g, '').toLowerCase();
        const contact = app.contact(key);
        let text = t('AddFriend.spaces');
        let tone = '';
        let ok = false;
        let open = null;
        if (key && !'hh21'.startsWith(key.slice(0, 4))) {
            text = t('AddFriend.prefix');
            tone = 'warn';
        } else if (key === app.data.me.key) {
            text = t('AddFriend.ownAddress');
            tone = 'warn';
        } else if (contact && !contact.pending) {
            text = t('AddFriend.alreadyFriend', {name: displayName(contact)});
            open = [t('AddFriend.openChat'), contact.key];
        } else if (contact) {
            text = t('AddFriend.alreadyWaiting', {name: displayName(contact)});
            open = [t('AddFriend.show'), contact.key];
        } else if (app.data.pending[key]) {
            text = t('AddFriend.theyKnocked');
            tone = 'ok';
            ok = true;
        } else if (sanitize.isValidAddress(key)) {
            text = t('AddFriend.looksRight');
            tone = 'ok';
            ok = true;
        } else if (key.length > 62) {
            text = t('AddFriend.tooLong');
            tone = 'warn';
        }
        hint.dataset.tone = tone;
        hint.textContent = text;
        if (open) {
            const button = document.createElement('button');
            button.className = 'hh-link';
            button.textContent = open[0];
            button.onclick = () => {
                close();
                app.go('chat', {id: open[1]});
            };
            hint.append(' ', button);
        }
        knock.disabled = !ok;
        return ok ? key : '';
    }

    /**
     * Send the request, then select the new "waiting" cell
     * @param {Object} app the App
     * @param {HTMLDialogElement} dialog the dialog
     * @param {function} close closes it
     */
    static async knock(app, dialog, close) {
        const key = AddFriend.check(app, dialog, close);
        if (!key) {
            return;
        }
        const wasKnocking = Boolean(app.data.pending[key]);
        const knock = dialog.querySelector('#knockButton');
        knock.disabled = true;
        try {
            // Accepts their request instead, if they sent one first
            await dbMessenger.addFriend(key);
        } catch (err) {
            const hint = dialog.querySelector('#addFriendHint');
            hint.dataset.tone = 'warn';
            hint.textContent = errorCode(err).code === 'BAD_ADDRESS' ?
                t('AddFriend.typo') : String(err.message);
            return;
        }
        close();
        await app.refresh();
        await app.go('chat', {id: key});
        toast(wasKnocking ? t('AddFriend.letInToo') : t('AddFriend.knocked'));
    }
}
