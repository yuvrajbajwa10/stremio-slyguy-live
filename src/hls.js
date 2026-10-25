// Minimal HLS proxy. Kodi sends each provider's required headers (user-agent, x-forwarded-for, ...)
// itself; a browser can't, and some CDNs (e.g. Pluto) also send CORS headers that block web.stremio.com.
// So every playlist and segment is fetched here with the provider headers and served with open CORS.

const { Readable } = require('stream');
const { getChannel } = require('./providers');

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

function isPlaylist(res, url, firstBytes) {
    const type = (res.headers.get('content-type') || '').toLowerCase();
    return type.includes('mpegurl') || /\.m3u8($|\?)/i.test(url) || firstBytes.startsWith('#EXTM3U');
}

function rewritePlaylist(body, baseUrl, prefix) {
    const wrap = (uri) => {
        const abs = new URL(uri, baseUrl).toString();
        const ext = (new URL(abs).pathname.match(/\.(m3u8|ts|aac|mp4|m4s|vtt|key|webvtt)$/i) || ['', 'bin'])[1];
        return `${prefix}/${b64(abs)}.${ext}`;
    };
    return body.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
            // EXT-X-MEDIA, EXT-X-KEY, EXT-X-MAP, EXT-X-I-FRAME-STREAM-INF ... carry URI="..."
            return line.replace(/URI="([^"]+)"/g, (m, uri) => (uri.startsWith('skd:') || uri.startsWith('data:') ? m : `URI="${wrap(uri)}"`));
        }
        return wrap(trimmed);
    }).join('\n');
}

async function proxy(req, res, upstreamUrl, headers, prefix) {
    const reqHeaders = { ...headers };
    if (req.headers.range) reqHeaders.range = req.headers.range;

    const upstream = await fetch(upstreamUrl, { headers: reqHeaders, redirect: 'follow' });
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-cache');

    if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).send(`Upstream ${upstream.status}`);
        return;
    }

    const finalUrl = upstream.url || upstreamUrl;
    const contentType = upstream.headers.get('content-type') || '';
    const length = Number(upstream.headers.get('content-length') || 0);
    const maybePlaylist = /mpegurl|text|octet-stream|^$/i.test(contentType) && (!length || length < 5 * 1024 * 1024);

    if (maybePlaylist) {
        const buf = Buffer.from(await upstream.arrayBuffer());
        const text = buf.toString('utf8');
        if (isPlaylist(upstream, finalUrl, text.slice(0, 16).replace(/^﻿/, ''))) {
            res.type('application/vnd.apple.mpegurl').send(rewritePlaylist(text, finalUrl, prefix));
            return;
        }
        res.status(upstream.status);
        if (contentType) res.type(contentType);
        res.send(buf);
        return;
    }

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h);
        if (v) res.set(h, v);
    }
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
}

function mount(app) {
    app.options('/hls/*', (req, res) => {
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        }).sendStatus(204);
    });

    // Entry point: /hls/:provider/:region/:id/index.m3u8 -> resolve the channel's live URL
    // Everything else: /hls/:provider/:region/:id/<base64url upstream>.<ext>
    app.get('/hls/:provider/:region/:id/:target', async (req, res) => {
        const { provider: providerId, region, target } = req.params;
        const id = decodeURIComponent(req.params.id);
        try {
            const found = await getChannel(providerId, region, id);
            if (!found) {
                res.status(404).send('Unknown channel');
                return;
            }
            const prefix = `/hls/${providerId}/${encodeURIComponent(region)}/${encodeURIComponent(id)}`;
            let url;
            let headers;
            if (target === 'index.m3u8') {
                ({ url, headers } = await found.provider.resolve(region, found.ch));
            } else {
                url = unb64(target.replace(/\.[a-z0-9]+$/i, ''));
                headers = found.ch.headers;
            }
            await proxy(req, res, url, headers, prefix);
        } catch (err) {
            console.error(`[hls] ${providerId}/${region}/${id}: ${err.message}`);
            if (!res.headersSent) res.status(502).send(err.message);
        }
    });
}

module.exports = { mount };
