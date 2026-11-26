/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// Runs sandboxed, before the page. It gets a MessagePort to Core from the
// main process and gives the page exactly two functions, as window.hexhoot:
//   core.call(method, args) -> Promise   (Core accepts only rendererMethods)
//   core.onEvent(func)                   (Core events, such as new messages)

const {contextBridge, ipcRenderer} = require('electron');

const pending = new Map();
const eventListeners = [];
let nextId = 1;

const portPromise = new Promise(function(resolve) {
    ipcRenderer.once('core:port', function(event) {
        const port = event.ports[0];
        port.onmessage = function({data}) {
            if (data.event) {
                for (const func of eventListeners) {
                    func(data.event);
                }
                return;
            }
            const request = pending.get(data.id);
            if (request) {
                pending.delete(data.id);
                if (Object.hasOwn(data, 'error')) {
                    // Only the message crosses the context bridge, so the
                    // code (and any details) go in front: "[CODE:a,b] text"
                    const details = Array.isArray(data.problems) ?
                        ':' + data.problems.join(',') : '';
                    request.reject(new Error(data.code ?
                        `[${data.code}${details}] ${data.error}` :
                        data.error));
                } else {
                    request.resolve(data.result);
                }
            }
        };
        resolve(port);
    });
});
ipcRenderer.send('core:connect');

contextBridge.exposeInMainWorld('hexhoot', {
    core: {
        call: async function(method, args) {
            if (typeof method !== 'string' || !Array.isArray(args)) {
                throw new Error('Invalid Core call');
            }
            const port = await portPromise;
            const id = nextId++;
            return new Promise(function(resolve, reject) {
                pending.set(id, {resolve, reject});
                port.postMessage({id, method, args});
            });
        },
        onEvent: function(func) {
            if (typeof func === 'function') {
                eventListeners.push(func);
            }
        },
    },
});
