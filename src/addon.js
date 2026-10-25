const { addonBuilder } = require('stremio-addon-sdk');
const { providers, catalogs, getChannel } = require('./providers');
const pkg = require('../package.json');

const ID_PREFIX = 'slyguy.';

// Dot-separated so the IDs are also valid file names for the static (GitHub Pages) build
const metaId = (providerId, region, id) => `${ID_PREFIX}${providerId}.${encodeURIComponent(region)}.${encodeURIComponent(id)}`;

function parseMetaId(value) {
    const [, providerId, region, id] = value.split('.');
    return { providerId, region: decodeURIComponent(region), id: decodeURIComponent(id) };
}

function formatTime(seconds) {
    return new Date(seconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Same now/next listing the Kodi addons put in the plot
function guide(programs, count = 5) {
    const now = Date.now() / 1000;
    const lines = [];
    (programs || []).forEach(([start, title], i) => {
        const stop = programs[i + 1] ? programs[i + 1][0] : start + 3600;
        if (lines.length < count && stop > now) lines.push(`[${formatTime(start)}] ${title}`);
    });
    return lines;
}

function nowPlaying(programs) {
    const [first] = guide(programs, 1);
    return first ? first.replace(/^\[[^\]]+\]\s*/, '') : undefined;
}

function toMetaPreview(providerId, region, ch) {
    return {
        id: metaId(providerId, region, ch.id),
        type: 'tv',
        name: ch.name,
        poster: ch.logo,
        posterShape: 'square',
        logo: ch.logo,
        background: ch.background,
        description: nowPlaying(ch.programs) ? `Now: ${nowPlaying(ch.programs)}` : ch.description,
        genres: ch.group ? [ch.group] : [],
    };
}

async function buildManifest(staticMode) {
    return {
        id: staticMode ? 'community.slyguy.livetv.pages' : 'community.slyguy.livetv',
        version: pkg.version,
        name: 'AU & NZ Live TV (unofficial)',
        description: 'Unofficial. Top 15 free-to-air channels for Australia and New Zealand, from the broadcasters\' public streams. Not affiliated with SlyGuy, Matt Huisman or any broadcaster.',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        idPrefixes: [ID_PREFIX],
        catalogs: catalogs.map((catalog) => ({ type: 'tv', id: catalog.id, name: catalog.name, extra: [] })),
        behaviorHints: { configurable: false },
    };
}

// staticMode: build for a static host (GitHub Pages). Only the manifest ID differs; streams
// still point at the local proxy, which has to be running for playback.
async function createAddon(baseUrl, { staticMode = false } = {}) {
    const builder = new addonBuilder(await buildManifest(staticMode));

    builder.defineCatalogHandler(async ({ id }) => {
        const catalog = catalogs.find((c) => c.id === id);
        if (!catalog) return { metas: [] };
        const regions = await providers[catalog.provider].load();
        const channels = regions[catalog.region] ? regions[catalog.region].channels : [];
        const metas = [];
        for (const name of catalog.channels) {
            const ch = channels.find((c) => c.name === name);
            if (ch) metas.push(toMetaPreview(catalog.provider, catalog.region, ch));
            else console.warn(`[catalog] ${catalog.id}: no channel named ${JSON.stringify(name)}`);
        }
        return { metas, cacheMaxAge: 5 * 60 };
    });

    builder.defineMetaHandler(async ({ id }) => {
        const { providerId, region, id: channelId } = parseMetaId(id);
        const found = await getChannel(providerId, region, channelId);
        if (!found) return { meta: null };
        const { provider, ch } = found;
        const lines = guide(ch.programs);
        const regions = await provider.load();
        const header = [provider.name, region !== 'all' && regions[region] ? regions[region].name : null, ch.group].filter(Boolean).join(' · ');
        return {
            meta: {
                ...toMetaPreview(providerId, region, ch),
                description: [header, lines.join('\n') || null, ch.description].filter(Boolean).join('\n\n'),
                videos: [],
            },
            cacheMaxAge: 5 * 60,
        };
    });

    builder.defineStreamHandler(async ({ id }) => {
        const { providerId, region, id: channelId } = parseMetaId(id);
        const found = await getChannel(providerId, region, channelId);
        if (!found) return { streams: [] };
        return {
            streams: [{
                url: `${baseUrl}/hls/${providerId}/${encodeURIComponent(region)}/${encodeURIComponent(channelId)}/index.m3u8`,
                name: found.provider.name,
                title: `${found.ch.name}\nLive`,
            }],
        };
    });

    return builder.getInterface();
}

module.exports = { createAddon };
