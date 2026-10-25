// Builds a static copy of the addon (manifest, catalogs, metas, streams) into dist/ for GitHub Pages.
// Usage: node scripts/build-static.js [outDir]
// LOCAL_PROXY_URL sets the base of the secondary "local proxy" stream (default http://127.0.0.1:7000).

const fs = require('fs');
const path = require('path');
const { createAddon } = require('../src/addon');

const OUT = path.resolve(process.argv[2] || 'dist');
const LOCAL_PROXY_URL = process.env.LOCAL_PROXY_URL || 'http://127.0.0.1:7000';
// Characters that can't appear in a file name (on Linux or Windows)
const BAD_NAME = /[\/\\:*?"<>|]/;

function write(rel, data) {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
}

async function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    const addon = await createAddon(LOCAL_PROXY_URL, { staticMode: true });
    const { manifest } = addon;

    for (const catalog of manifest.catalogs) {
        const genre = catalog.extra.find((e) => e.name === 'genre');
        if (!genre) continue;
        const bad = genre.options.filter((o) => BAD_NAME.test(o));
        if (bad.length) console.warn(`[build] ${catalog.id}: dropping genres ${JSON.stringify(bad)}`);
        genre.options = genre.options.filter((o) => !BAD_NAME.test(o));
    }
    write('manifest.json', manifest);

    const ids = new Set();
    for (const catalog of manifest.catalogs) {
        const genre = catalog.extra.find((e) => e.name === 'genre');
        const variants = [{}, ...(genre ? genre.options.map((g) => ({ genre: g })) : [])];
        for (const extra of variants) {
            const result = await addon.get('catalog', catalog.type, catalog.id, extra);
            // Stremio requests /catalog/tv/<id>/genre=<urlencoded>.json; the host decodes it to this file name
            const rel = extra.genre ? `catalog/${catalog.type}/${catalog.id}/genre=${extra.genre}.json` : `catalog/${catalog.type}/${catalog.id}.json`;
            write(rel, result);
            result.metas.forEach((m) => ids.add(m.id));
        }
        console.log(`[build] ${catalog.id}: ${variants.length} catalog files`);
    }

    let streams = 0;
    for (const id of ids) {
        if (id.split('.').length !== 4) throw new Error(`channel id contains a dot: ${id}`);
        write(`meta/tv/${id}.json`, await addon.get('meta', 'tv', id));
        const stream = await addon.get('stream', 'tv', id);
        write(`stream/tv/${id}.json`, stream);
        streams += stream.streams.length ? 1 : 0;
    }
    console.log(`[build] ${ids.size} channels, ${streams} with streams`);

    write('.nojekyll', '');
    write('index.html', fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    console.log(`[build] wrote ${OUT}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
