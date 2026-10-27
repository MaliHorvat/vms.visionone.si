'use strict';
const { methods, ok } = require('../lib/http');
const license = require('../lib/license');
const { requireAuth } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    return ok(res, { plans: license.PLANS, featureLabels: license.FEATURE_LABELS });
  },
});
