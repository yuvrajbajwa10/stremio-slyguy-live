const { addonBuilder } = require('stremio-addon-sdk');
const { providers, getChannel } = require('./providers');
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
    const catalogs = [];
    for (const provider of Object.values(providers)) {
        // A static host can't answer arbitrary searches, so the static build only offers genres
        const extra = staticMode ? [] : [{ name: 'search' }, { name: 'skip' }];
        try {
            const regions = await provider.load();
            if (provider.genreMode === 'region') {
                const codes = Object.keys(regions).filter((c) => !staticMode || !provider.staticRegions || provider.staticRegions.includes(c)).sort((a, b) => regions[a].name.localeCompare(regions[b].name));
                const def = codes.includes(provider.defaultRegion) ? provider.defaultRegion : codes[0];
                provider.regionOptions = Object.fromEntries(codes.map((c) => [regions[c].name, c]));
                provider.regionDefault = regions[def].name;
                extra.push({ name: 'genre', options: [regions[def].name, ...codes.filter((c) => c !== def).map((c) => regions[c].name)] });
            } else {
                const groups = new Set();
                for (const ch of regions.all.channels) (ch.groups || [ch.group]).filter(Boolean).forEach((g) => groups.add(g));
                if (groups.size) extra.push({ name: 'genre', options: [...groups].sort() });
            }
        } catch (err) {
            console.error(`[manifest] ${provider.id}: ${err.message}`);
        }
        catalogs.push({ type: 'tv', id: `slyguy-${provider.id}`, name: provider.name, extra });
    }

    return {
        id: staticMode ? 'community.slyguy.livetv.pages' : 'community.slyguy.livetv',
        version: pkg.version,
        name: 'SlyGuy Live TV',
        description: 'Free live TV channels from Pluto TV, Samsung TV Plus, Plex, The Roku Channel and AU/NZ Freeview, using the channel sources of the SlyGuy Kodi addons.',
        logo: 'https://raw.githubusercontent.com/matthuisman/slyguy.addons/master/repository.slyguy/icon.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        idPrefixes: [ID_PREFIX],
        catalogs,
        behaviorHints: { configurable: false },
    };
}

// staticMode: build for a static host (GitHub Pages). Streams then point straight at the
// upstream URL and rely on Stremio's streaming server to send the provider headers.
async function createAddon(baseUrl, { staticMode = false } = {}) {
    const builder = new addonBuilder(await buildManifest(staticMode));

    builder.defineCatalogHandler(async ({ id, extra }) => {
        const provider = providers[id.replace(/^slyguy-/, '')];
        if (!provider) return { metas: [] };
        const regions = await provider.load();

        let region = 'all';
        let channels;
        if (provider.genreMode === 'region') {
            const regionName = extra.genre || provider.regionDefault;
            region = (provider.regionOptions || {})[regionName] || provider.defaultRegion;
            channels = regions[region] ? regions[region].channels : [];
        } else {
            channels = regions.all.channels;
            if (extra.genre) channels = channels.filter((ch) => (ch.groups || [ch.group]).includes(extra.genre));
        }

        if (extra.search) {
            const q = extra.search.toLowerCase();
            channels = channels.filter((ch) => `${ch.name} ${ch.chno ?? ''} ${ch.group ?? ''}`.toLowerCase().includes(q));
        }

        const skip = Number(extra.skip) || 0;
        const sorted = sortChannels(channels);
        const page = staticMode ? sorted : sorted.slice(skip, skip + PAGE_SIZE);
        return { metas: page.map((ch) => toMetaPreview(provider.id, region, ch)), cacheMaxAge: 5 * 60 };
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

        const { url, headers } = await found.provider.direct(region, found.ch);
        return {
            streams: [{
                url,
                name: found.provider.name,
                title: `${found.ch.name}\nLive`,
                behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } },
            }, {
                ...proxied,
                name: `${found.provider.name}\nLocal`,
                title: `${found.ch.name}\nVia local proxy (npm start)`,
            }],
        };
    });

    return builder.getInterface();
}

module.exports = { createAddon };
