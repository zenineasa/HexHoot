/* Copyright (c) 2022-2026 Zenin Easa Panthakkalakath */

// The google style config used to be registered here as a plugin, which did
// not enable any of its rules; these are the rules that were in effect.
module.exports = [
    {
        'ignores': ['out/**', 'node_modules/**'],
    },
    {
        'files': ['**/*.js', '**/*.mjs'],
        'languageOptions': {
            'ecmaVersion': 'latest',
            'sourceType': 'module',
        },
        'rules': {
            'max-len': ['error', {'code': 80}],
            'indent': ['error', 4],
            'linebreak-style': 0,
            'no-unused-vars': [
                'error',
                {
                    'args': 'none',
                    'caughtErrors': 'none',
                },
            ],
        },
    },
];
