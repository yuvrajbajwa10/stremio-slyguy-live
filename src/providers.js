// Channel sources, ported from the SlyGuy Kodi addons (github.com/matthuisman/slyguy.addons).
// Each provider loads Matt Huisman's i.mjh.nz channel feed and normalises it into:
//   { id, name, logo, background, description, group, chno, programs, headers }
// plus a resolve() that returns the upstream playback URL and headers for a channel.

const zlib = require('zlib');
const { randomUUID } = require('crypto');

const CACHE_TTL = 15 * 60 * 1000;
const AU_REGIONS = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Darwin', 'Hobart', 'Canberra'];

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

// --- Pluto TV (slyguy.pluto.tv.provider) ---------------------------------

async function plutoSession(regionHeaders) {
    // Same boot request the Kodi addon makes in _get_jwt()
    const params = new URLSearchParams({
        clientID: randomUUID(),
        clientTime: new Date().toISOString().replace(/\.\d+Z$/, '.000Z'),
        appName: 'web',
        appVersion: '8.0.0-111b2b9dc00bd0bea9030b30662159ed9e7c8bc6',
        deviceMake: 'chrome',
        deviceType: 'web',
        deviceModel: 'web',
        deviceVersion: '122.0.0',
        clientModelNumber: '1.0.0',
        serverSideAds: 'false',
        drmCapabilities: '',
        blockingMode: '',
        notificationVersion: '1',
        appLaunchCount: '',
        lastAppLaunchDate: '',
        DNT: '0',
    });
    const res = await fetch(`https://boot.pluto.tv/v4/start?${params}`, { headers: regionHeaders });
    if (!res.ok) throw new Error(`Pluto boot -> ${res.status}`);
    const data = await res.json();
    return { stitcherParams: data.stitcherParams, token: data.sessionToken };
}

const pluto = {
    id: 'pluto',
    name: 'Pluto TV',
    genreMode: 'region',
    defaultRegion: 'us',
    // jmp2.uk resolves Pluto streams with a US session, so the static build only lists US channels
    staticRegions: ['us'],
    async load() {
        const data = await fetchJson('https://i.mjh.nz/PlutoTV/.channels.json.gz');
        const regions = {};
        for (const [code, region] of Object.entries(data.regions)) {
            regions[code] = {
                name: region.name,
                channels: Object.entries(region.channels).filter(([, ch]) => playable(ch)).map(([id, ch]) => ({
                    id,
                    name: ch.name,
                    logo: ch.logo,
                    background: ch.art,
                    description: ch.description,
                    group: ch.group,
                    chno: ch.chno,
                    programs: ch.programs,
                    headers: mergeHeaders(data.headers, region.headers, ch.headers),
                })),
            };
        }
        return regions;
    },
    async resolve(region, ch) {
        const session = await cached(`pluto-session-${region}`, 30 * 60 * 1000, () => plutoSession(ch.headers));
        return {
            url: `https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/v2/stitch/hls/channel/${ch.id}/master.m3u8`
                + `?${session.stitcherParams}&jwt=${session.token}&masterJWTPassthrough=true&includeExtendedEvents=true`,
            headers: ch.headers,
        };
    },
    // A static host can't mint a session token, so use the jmp2.uk redirector instead
    async direct(region, ch) {
        return { url: `https://jmp2.uk/plu-${ch.id}.m3u8`, headers: ch.headers };
    },
};

// --- Samsung TV Plus (slyguy.samsung.tv.plus) ----------------------------

const samsung = {
    id: 'samsung',
    name: 'Samsung TV Plus',
    genreMode: 'region',
    defaultRegion: 'us',
    async load() {
        const data = await fetchJson('https://i.mjh.nz/SamsungTVPlus/.channels.json.gz');
        const regions = {};
        for (const [code, region] of Object.entries(data.regions)) {
            regions[code] = {
                name: region.name,
                channels: Object.entries(region.channels).filter(([, ch]) => playable(ch)).map(([id, ch]) => ({
                    id,
                    name: ch.name,
                    logo: ch.logo,
                    description: ch.description,
                    group: ch.group,
                    chno: ch.chno,
                    programs: ch.programs,
                    headers: mergeHeaders(data.headers, ch.headers),
                    url: `https://jmp2.uk/${data.slug.replace('{id}', id)}`,
                })),
            };
        }
        return regions;
    },
    async resolve(region, ch) {
        return { url: ch.url, headers: ch.headers };
    },
};

// --- Roku (slyguy.roku) --------------------------------------------------

const roku = {
    id: 'roku',
    name: 'The Roku Channel',
    genreMode: 'group',
    async load() {
        const data = await fetchJson('https://i.mjh.nz/Roku/.channels.json.gz');
        return {
            all: {
                name: 'All',
                channels: Object.entries(data.channels).filter(([, ch]) => playable(ch)).map(([id, ch]) => ({
                    id,
                    name: ch.name.trim(),
                    logo: ch.logo,
                    background: ch.fanart,
                    description: ch.description,
                    group: (ch.groups || []).join(' / '),
                    groups: ch.groups || [],
                    chno: ch.chno,
                    programs: ch.programs,
                    headers: mergeHeaders(data.headers, ch.headers),
                })),
            },
        };
    },
    async resolve(region, ch) {
        return { url: `https://jmp2.uk/rok-${ch.id}.m3u8`, headers: ch.headers };
    },
};

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
    genreMode: 'region',
    defaultRegion: 'Melbourne',
    async load() {
        const regions = {};
        await Promise.all(AU_REGIONS.map(async (code) => {
            try {
                const data = await fetchJson(`https://i.mjh.nz/au/${code}/tv.json.gz`);
                regions[code] = { name: code, channels: mjhChannels(data) };
            } catch (err) {
                console.error(`[au] ${code}: ${err.message}`);
            }
        }));
        if (!Object.keys(regions).length) throw new Error('no AU regions loaded');
        return regions;
    },
    async resolve(region, ch) {
        return { url: ch.url, headers: ch.headers };
    },
};

// --- NZ Freeview (plugin.video.nz.freeview) ------------------------------

const nz = {
    id: 'nz',
    name: 'NZ Freeview',
    genreMode: 'group',
    async load() {
        const data = await fetchJson('https://i.mjh.nz/nz/tv.json');
        return { all: { name: 'All', channels: mjhChannels(data).map((ch) => ({ ...ch, group: '' })) } };
    },
    async resolve(region, ch) {
        return { url: ch.url, headers: ch.headers };
    },
};

// --- Plex Live TV (slyguy.plex.live) -------------------------------------

const plex = {
    id: 'plex',
    name: 'Plex Live TV',
    genreMode: 'region',
    defaultRegion: 'au',
    async load() {
        const data = await fetchJson('https://i.mjh.nz/Plex/.channels.json.gz');
        const regions = {};
        for (const [code, region] of Object.entries(data.regions)) {
            regions[code] = { name: region.name, channels: [] };
        }
        for (const [id, ch] of Object.entries(data.channels)) {
            for (const code of ch.regions || []) {
                if (!regions[code]) continue;
                regions[code].channels.push({
                    id,
                    name: ch.name,
                    logo: ch.logo,
                    description: ch.description,
                    group: ch.group,
                    programs: ch.programs,
                    // region headers (X-Forwarded-For) pick the Plex lineup, as in the Kodi addon
                    headers: mergeHeaders(data.headers, data.regions[code].headers),
                });
            }
        }
        return regions;
    },
    async resolve(region, ch) {
        return { url: `https://jmp2.uk/plex-${ch.id}.m3u8`, headers: ch.headers };
    },
    // jmp2.uk adds its own Plex token, so keep the feed's token out of the published files
    async direct(region, ch) {
        const { 'x-plex-token': token, ...headers } = ch.headers;
        return { url: `https://jmp2.uk/plex-${ch.id}.m3u8`, headers };
    },
};

const providers = { pluto, samsung, plex, roku, au, nz };

// Normalised channel lists are cached per provider; see cached() for refresh behaviour.
for (const provider of Object.values(providers)) {
    provider.direct = provider.direct || provider.resolve;
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

module.exports = { providers, getChannel, AU_REGIONS };
