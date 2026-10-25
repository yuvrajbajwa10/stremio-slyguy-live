const express = require('express');
const { getRouter } = require('stremio-addon-sdk');
const { createAddon } = require('./addon');
const hls = require('./hls');

const PORT = Number(process.env.PORT) || 7000;
const HOST = process.env.HOST || '127.0.0.1';
// The URL Stremio uses to reach this server. Set it to your LAN address (and HOST=0.0.0.0)
// to use the addon from another device, e.g. BASE_URL=http://192.168.1.20:7000
const BASE_URL = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');

async function main() {
    const app = express();
    hls.mount(app);
    app.use(getRouter(await createAddon(BASE_URL)));
    app.get('/', (req, res) => res.redirect('/manifest.json'));

    app.listen(PORT, HOST, () => {
        console.log(`AU & NZ Live TV addon running`);
        console.log(`Install in Stremio: ${BASE_URL}/manifest.json`);
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
