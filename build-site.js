const { ensureDataFiles } = require('./lib/store');
const { buildPublicSite } = require('./lib/site-generator');

ensureDataFiles();
const result = buildPublicSite();
console.log(`Built public site with ${result.badges.length} badge page(s).`);
