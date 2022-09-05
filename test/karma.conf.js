/* Copyright (c) 2022 Zenin Easa Panthakkalakath */

module.exports = function(config) {
    config.set({
        // base path that will be used to resolve all patterns
        // (eg. files, exclude)
        basePath: '',

        // frameworks to use
        // available frameworks:
        // https://www.npmjs.com/search?q=keywords:karma-adapter
        frameworks: ['qunit'],

        // list of files / patterns to load in the browser
        files: [
            {
                pattern: './**/t*.js',
                included: true,
                type: 'js',
            },
            {
                pattern: './../modules/ImagePack/images/**/*.png',
                served: true,
                type: 'html', // To supress warning
            },
            {
                pattern: './../modules/ImagePack/images/**/*.svg',
                served: true,
                type: 'html', // To supress warning
            },
            {
                pattern: './../modules/**/*.css',
                served: true,
                type: 'css',
            },
        ],

        // list of files / patterns to exclude
        exclude: [
        ],

        // test results reporter to use
        // possible values: 'dots', 'progress'
        // available reporters:
        // https://www.npmjs.com/search?q=keywords:karma-reporter
        reporters: ['progress'],

        // web server port
        port: 9876,

        // enable / disable colors in the output (reporters and logs)
        colors: true,

        // level of logging
        // possible values: config.LOG_DISABLE, config.LOG_ERROR,
        // config.LOG_WARN, config.LOG_INFO, config.LOG_DEBUG
        logLevel: config.LOG_INFO,

        // Define our custom launcher for Node.js support
        customLaunchers: {
            CustomElectron: {
                base: 'Electron',
                browserWindowOptions: {
                // DEV: More preferentially, should link your own
                // 'webPreferences' from your Electron app instead
                    webPreferences: {
                        // Mechanism to expose 'require'
                        nodeIntegration: true,
                        contextIsolation: false,
                        nativeWindowOpen: true,
                    },
                },
            },
        },

        // start these browsers
        // available browser launchers:
        // https://www.npmjs.com/search?q=keywords:karma-launcher
        browsers: ['CustomElectron'],

        // preprocess matching files before serving them to the browser
        // available preprocessors:
        // https://www.npmjs.com/search?q=keywords:karma-preprocessor
        preprocessors: {
            './**/t*.js': ['electron'],
        },

        // enable / disable watching file and executing tests whenever any file
        // changes
        autoWatch: false,

        // Continuous Integration mode
        // if true, Karma captures browsers, runs the tests and exits
        singleRun: true,

        // Concurrency level
        // how many browser instances should be started simultaneously
        concurrency: Infinity,

        // DEV: 'useIframe: false' is for launching a new window instead of
        // using an iframe. In Electron, iframes don't get 'nodeIntegration'
        // priveleges, but windows do.
        client: {
            useIframe: false,
        },
    });
};
