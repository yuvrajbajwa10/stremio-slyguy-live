const { addonBuilder } = require('stremio-addon-sdk');
const { providers, catalogs, getChannel } = require('./providers');
const pkg = require('../package.json');

const PAGE_SIZE = 100;
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

function sortChannels(channels) {
    return [...channels].sort((a, b) => (a.chno ?? Infinity) - (b.chno ?? Infinity) || a.name.localeCompare(b.name));
}

async function buildManifest(staticMode) {
    return {
        id: staticMode ? 'community.slyguy.livetv.pages' : 'community.slyguy.livetv',
        version: pkg.version,
        name: 'SlyGuy Live TV',
        description: 'Free Australian and New Zealand live TV (Freeview and Plex), using the channel sources of the SlyGuy Kodi addons.',
        logo: 'https://raw.githubusercontent.com/matthuisman/slyguy.addons/master/repository.slyguy/icon.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        idPrefixes: [ID_PREFIX],
        catalogs: catalogs.map((catalog) => ({
            type: 'tv',
            id: catalog.id,
            name: catalog.name,
            // A static host can't answer arbitrary searches, so the static build only offers genres
            extra: [
                { name: 'genre', options: catalog.sources.map(([, , label]) => label) },
                ...(staticMode ? [] : [{ name: 'search' }, { name: 'skip' }]),
            ],
        })),
        behaviorHints: { configurable: false },
    };
}

// staticMode: build for a static host (GitHub Pages). Streams then point straight at the
// upstream URL and rely on Stremio's streaming server to send the provider headers.
async function createAddon(baseUrl, { staticMode = false } = {}) {
    const builder = new addonBuilder(await buildManifest(staticMode));

    builder.defineCatalogHandler(async ({ id, extra }) => {
        const catalog = catalogs.find((c) => c.id === id);
        if (!catalog) return { metas: [] };

        const metas = [];
        for (const [providerId, region, label] of catalog.sources) {
            if (extra.genre && extra.genre !== label) continue;
            let channels;
            try {
                const regions = await providers[providerId].load();
                channels = regions[region] ? regions[region].channels : [];
            } catch (err) {
                console.error(`[catalog] ${providerId}/${region}: ${err.message}`);
                continue;
            }
            if (extra.search) {
                const q = extra.search.toLowerCase();
                channels = channels.filter((ch) => `${ch.name} ${ch.chno ?? ''} ${ch.group ?? ''}`.toLowerCase().includes(q));
            }
            metas.push(...sortChannels(channels).map((ch) => toMetaPreview(providerId, region, ch)));
        }

        const skip = Number(extra.skip) || 0;
        return { metas: staticMode ? metas : metas.slice(skip, skip + PAGE_SIZE), cacheMaxAge: 5 * 60 };
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
        const proxied = {
            url: `${baseUrl}/hls/${providerId}/${encodeURIComponent(region)}/${encodeURIComponent(channelId)}/index.m3u8`,
            name: found.provider.name,
            title: `${found.ch.name}\nLive`,
        };
        if (!staticMode) return { streams: [proxied] };

        // The local proxy is the stream that plays in web Stremio; the direct one relies on the
        // streaming server's proxyHeaders, which web Stremio can't use for live HLS.
        const { url, headers } = await found.provider.direct(region, found.ch);
        return {
            streams: [{
                ...proxied,
                title: `${found.ch.name}\nLive (needs npm start)`,
            }, {
                url,
                name: `${found.provider.name}\nDirect`,
                title: `${found.ch.name}\nDirect (Stremio desktop app only)`,
                behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
            }],
        };
    });

    return builder.getInterface();
}

module.exports = { createAddon };
