/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

const google = require('eslint-config-google');

module.exports = [{
    'files': ['**/*.js'],
    'plugins': {
        'google': google
    },
    'languageOptions': {
        'ecmaVersion': 2022,
        'sourceType': 'module',
    },
    'rules': {
        'indent': ['error', 4],
        'linebreak-style': 0,
        'no-unused-vars': [
            "error",
            {
                'args': 'none',
                'caughtErrors': 'none'
            }
        ]
    }
}];
