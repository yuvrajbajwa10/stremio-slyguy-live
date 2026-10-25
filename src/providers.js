// Channel sources, ported from the SlyGuy Kodi addons (github.com/matthuisman/slyguy.addons).
// Australian and New Zealand Freeview live TV.
// Each provider loads Matt Huisman's i.mjh.nz channel feed and normalises it into:
//   { id, name, logo, background, description, group, chno, programs, headers }
// plus a resolve() that returns the upstream playback URL and headers for a channel.

const zlib = require('zlib');

const CACHE_TTL = 15 * 60 * 1000;
// AU Freeview lineup to use: Sydney, Melbourne, Brisbane, Perth, Adelaide, Darwin, Hobart or Canberra
const AU_CITY = process.env.AU_CITY || 'Melbourne';

const cache = new Map();

async function fetchJson(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return JSON.parse(text);
}

// Stale-while-revalidate cache: once a value exists it is always returned immediately, and an
// expired entry is refreshed in the background (keeping the old value if the refresh fails), so
// playlist/segment requests never wait on a feed download mid-stream.
function cached(key, ttl, loader) {
    const hit = cache.get(key);
    if (hit) {
        if (hit.expires <= Date.now() && !hit.refreshing) {
            hit.refreshing = true;
            loader().then((value) => {
                cache.set(key, { promise: Promise.resolve(value), expires: Date.now() + ttl });
            }).catch((err) => {
                console.error(`[cache] refresh ${key}: ${err.message}`);
                hit.refreshing = false;
                hit.expires = Date.now() + 60 * 1000;
            });
        }
        return hit.promise;
    }
    const promise = loader().catch((err) => {
        cache.delete(key);
        throw err;
    });
    cache.set(key, { promise, expires: Date.now() + ttl });
    return promise;
}

function mergeHeaders(...sets) {
    const out = {};
    for (const set of sets) {
        for (const [k, v] of Object.entries(set || {})) {
            // the feeds use a blank referer (" ") to mean "send no referer"
            if (v && String(v).trim()) out[k.toLowerCase()] = String(v);
            else delete out[k.toLowerCase()];
        }
    }
    return out;
}

function playable(ch) {
    return !ch.license_url && ch.manifest !== 'mpd';
}

// --- AU Freeview (plugin.video.au.freeview) ------------------------------

function mjhChannels(channels) {
    return Object.entries(channels).filter(([, ch]) => playable(ch) && ch.mjh_master).map(([id, ch]) => ({
        id,
        name: ch.name,
        logo: ch.logo,
        background: ch.fanart,
        description: ch.description,
        group: ch.network || 'Other',
        chno: ch.chno,
        programs: ch.programs || (ch.epg_id && channels[ch.epg_id] ? channels[ch.epg_id].programs : []),
        headers: mergeHeaders(ch.headers),
        url: ch.mjh_master,
    }));
}

const au = {
    id: 'au',
    name: 'AU Freeview',
    async load() {
        const data = await fetchJson(`https://i.mjh.nz/au/${AU_CITY}/tv.json.gz`);
        return { [AU_CITY]: { name: AU_CITY, channels: mjhChannels(data) } };
    },
    async resolve(region, ch) {
        return { url: ch.url, headers: ch.headers };
    },
};

// --- NZ Freeview (plugin.video.nz.freeview) ------------------------------

const nz = {
    id: 'nz',
    name: 'NZ Freeview',
    async load() {
        const data = await fetchJson('https://i.mjh.nz/nz/tv.json');
        return { all: { name: 'All', channels: mjhChannels(data).map((ch) => ({ ...ch, group: '' })) } };
    },
    async resolve(region, ch) {
        return { url: ch.url, headers: ch.headers };
    },
};

const providers = { au, nz };

// The two Stremio catalogs: a curated Freeview top 15 per country, in this order.
// Channels are matched by their name in the i.mjh.nz feed, so they survive ID changes
// and a different AU_CITY. TVNZ 1, TVNZ 2 and DUKE are Widevine-protected, so they can't
// be included.
const catalogs = [
    {
        id: 'slyguy-australia',
        name: 'Australia Top 15',
        provider: 'au',
        region: AU_CITY,
        channels: ['Seven', 'Channel 9', 'ABC TV', '10', 'SBS', 'ABC NEWS', '7mate', '7two', '9Gem', '9Go!',
            '7flix', 'SBS World Movies', 'SBS Food', 'ABC Kids', 'ABC Family', 'NITV'],
    },
    {
        id: 'slyguy-nz',
        name: 'New Zealand Top 15',
        provider: 'nz',
        region: 'all',
        channels: ['Three', 'Sky Open', 'Bravo', 'Whakaata Māori', 'RUSH', 'eden', 'HGTV', 'Al Jazeera',
            'Te Reo', 'Trackside 1', 'Trackside 2', 'Parliament TV'],
    },
];

// Normalised channel lists are cached per provider; see cached() for refresh behaviour.
for (const provider of Object.values(providers)) {
    const load = provider.load.bind(provider);
    provider.load = () => cached(`load-${provider.id}`, CACHE_TTL, load);
}

async function getChannel(providerId, region, id) {
    const provider = providers[providerId];
    if (!provider) return null;
    const regions = await provider.load();
    const channels = regions[region] ? regions[region].channels : [];
    const ch = channels.find((c) => c.id === id);
    return ch ? { provider, ch } : null;
}

module.exports = { providers, catalogs, getChannel };
