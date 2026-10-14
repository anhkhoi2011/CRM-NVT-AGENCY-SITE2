'use strict';

// Local-only server using in-memory demo data. Production starts app.js instead.
process.env.DEMO_MODE = '1';
const path = require('node:path');
const demoRoot = path.resolve(__dirname, '..', 'tmp', 'webhook-sale-demo');
process.env.WEBHOOK_DATA_DIR ||= path.join(demoRoot, 'webhooks');
process.env.SUPPORT_UPLOAD_DIR ||= path.join(demoRoot, 'support');
require('../app.js');
