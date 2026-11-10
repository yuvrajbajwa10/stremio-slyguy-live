// Local copy of the addon, for development. The published one is the static GitHub Pages build.
const { serveHTTP } = require('stremio-addon-sdk');
const { createAddon } = require('./addon');

const PORT = Number(process.env.PORT) || 7000;

createAddon().then((addon) => serveHTTP(addon, { port: PORT })).catch((err) => {
    console.error(err);
    process.exit(1);
});
