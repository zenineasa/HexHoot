/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// People knocking at your hive: one at a time, or all of them. Letting
// someone in opens their (empty) chain; "Not now" tells nobody and moves to
// the next request.

import dbMessenger from '../DBMessenger/index.mjs';
import {t, avatar, displayName, firstName, groupedAddress, icon, toast}
    from '../UI/index.mjs';
import {html, loadStyle} from '../Html/index.mjs';

const styleLoaded = loadStyle(new URL('./style.css', import.meta.url));

/**
 * Friend requests
 */
export default class Requests {
    /**
     * One person knocking
     * @param {Object} app the App
     * @param {HTMLElement} pane where to draw
     * @param {Object} request their profile
     */
    static async renderOne(app, pane, request) {
        await styleLoaded;
        const others = app.knocking().length - 1;
        pane.innerHTML = html`
            <div class="pane-top narrow-only">
                <button class="hh-btn hh-quiet" name="back">
                    ← ${t('Hive.hive')}</button></div>
            <div id="request" data-key="${request.key}">
                <div class="who">
                    <span class="ring hx">${avatar(request, 80)}</span>
                </div>
                <h2 class="name">${t('Hive.isKnocking',
        {name: displayName(request)})}</h2>
                <div class="address mono">${groupedAddress(request.key)}</div>
                <p class="muted">${t('Requests.explain')}</p>
                <div class="hh-row center">
                    <button class="hh-btn hh-secondary" name="notNow">
                        ${t('Requests.notNow')}</button>
                    <button class="hh-btn hh-primary" name="letIn">
                        ${t('Requests.letIn')}</button>
                </div>
                ${others > 0 ? html`<div class="more muted">
                    ${t('Requests.more', {n: others})}
                    <button class="hh-link" name="seeAll">
                        ${t('Requests.seeAll')}</button></div>` : ''}
            </div>`.toString();
        pane.querySelector('[name=back]').onclick = () => app.go('home');
        pane.querySelector('[name=letIn]').onclick = () =>
            Requests.letIn(app, request);
        pane.querySelector('[name=notNow]').onclick = () =>
            Requests.notNow(app, request, false);
        const seeAll = pane.querySelector('[name=seeAll]');
        if (seeAll) {
            seeAll.onclick = () => app.go('requests');
        }
    }

    /**
     * Everyone knocking
     * @param {Object} app the App
     * @param {HTMLElement} pane where to draw
     */
    static async renderList(app, pane) {
        await styleLoaded;
        const all = app.knocking();
        pane.innerHTML = html`
            <div class="pane-head">
                <button class="hh-btn hh-quiet" name="back">
                    ${icon('back', 16)} ${app.backLabel()}</button>
                <h2>${t('Requests.title')}</h2>
            </div>
            <div id="requests">
                ${all.map((request) => html`<section class="hh-card request"
                    data-key="${request.key}">
                    ${avatar(request, 46)}
                    <div class="text">
                        <div class="name" title="${displayName(request)}"
                            >${displayName(request)}</div>
                        <div class="address mono">${groupedAddress(
        request.key).slice(0, 24)}…</div>
                    </div>
                    <button class="hh-btn hh-quiet" name="notNow">
                        ${t('Requests.notNow')}</button>
                    <button class="hh-btn hh-primary" name="letIn">
                        ${t('Requests.letIn')}</button>
                </section>`)}
                ${all.length ? '' : html`<div class="none muted">
                    ${t('Requests.none')}</div>`}
            </div>`.toString();
        pane.querySelector('[name=back]').onclick = () => app.back();
        for (const card of pane.querySelectorAll('.request')) {
            const request = app.data.pending[card.dataset.key];
            card.querySelector('[name=letIn]').onclick = () =>
                Requests.letIn(app, request);
            card.querySelector('[name=notNow]').onclick = () =>
                Requests.notNow(app, request, true);
        }
    }

    /**
     * Let them in, and open their chain
     * @param {Object} app the App
     * @param {Object} request their profile
     */
    static async letIn(app, request) {
        await dbMessenger.acceptFriendRequest(request.key);
        await app.refresh();
        await app.go('chat', {id: request.key});
        toast(t('Requests.letInDone', {name: firstName(request)}));
    }

    /**
     * Decline; they are not told
     * @param {Object} app the App
     * @param {Object} request their profile
     * @param {boolean} fromList whether the list stays open
     */
    static async notNow(app, request, fromList) {
        await dbMessenger.declineFriendRequest(request.key);
        await app.refresh();
        const next = app.knocking()[0];
        if (fromList) {
            Requests.renderList(app, document.getElementById('pane'));
        } else if (next) {
            await app.go('request', {id: next.key});
        } else {
            await app.go('home');
        }
        toast(t('Requests.notNowDone', {name: firstName(request)}));
    }
}
