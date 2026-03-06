/*
 * Copyright (C) 2017 CONTACT Software GmbH
 * All rights reserved.
 * http://www.contact-software.com
 *
 * Revision "$Id: jest.config.js 169999 2017-12-06 07:21:20Z gwe $"
 */

/* eslint-env node */

const path = require('path');

const configDir = process.env.JEST_COMMON_CONFIG_DIR;
const commonConfigPath = path.join(configDir, 'jest.config.common.js');
const commonConfig = require(commonConfigPath);

// componentNameSpace is computed in jest.config.common.js when this
// file is required/imported, require api caches the response resulting
// in componentNameSpace also being cached. To avoid this, the cache needs to
// be invalidated so that the subsequent call to "require" api loads the common
// config again and componentNameSpace is computed correctly.
delete require.cache[require.resolve(commonConfigPath)];

module.exports = Object.assign({},
    commonConfig
    // to overwrite / add to common settings, add stuff here
);
