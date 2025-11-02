/**
 * This file can be edited to customize webpack configuration.
 * To reset delete this file and rerun theia build again.
 */
// @ts-check
const configs = require('./gen-webpack.config.js');
const nodeConfig = require('./gen-webpack.node.config.js');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/**
 * Expose bundled modules on window.theia.moduleName namespace, e.g.
 * window['theia']['@theia/core/lib/common/uri'].
 * Such syntax can be used by external code, for instance, for testing.
 */

// serve favico from root
// @ts-ignore
configs[0].plugins.push(
    // @ts-ignore
    new CopyWebpackPlugin({
        patterns: [
            {
                context: path.resolve('.', '..', '..', 'applications', 'browser', 'ico'),
                from: '**'
            }
        ]
    })
);

// Workaround pour keytar: le marquer comme external pour éviter les erreurs de compilation
// keytar sert au stockage sécurisé des mots de passe, non critique pour le dev
nodeConfig.config.externals = nodeConfig.config.externals || {};
nodeConfig.config.externals['keytar'] = 'commonjs keytar';

module.exports = [
    ...configs,
    nodeConfig.config
];