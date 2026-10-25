# SlyGuy Live TV for Stremio

A Stremio addon with free Australian and New Zealand live TV. It uses the same channel sources as
the [SlyGuy Kodi addons](https://github.com/matthuisman/slyguy.addons): Matt Huisman's `i.mjh.nz`
feeds, with now/next EPG.

| Catalog | Sources (genre filter) | Ported from |
|---|---|---|
| Australia | Freeview (Melbourne lineup: ABC, SBS, 7, 9, 10 and their FAST channels) and Plex Australia | `plugin.video.au.freeview`, `slyguy.plex.live` |
| New Zealand | Freeview (TVNZ, Three, Whakaata Māori, ...) and Plex New Zealand | `plugin.video.nz.freeview`, `slyguy.plex.live` |

DRM (Widevine) and DASH-only channels are skipped. Set `AU_CITY` (Sydney, Melbourne, Brisbane,
Perth, Adelaide, Darwin, Hobart or Canberra) to use another city's Freeview lineup.

## Run the local server (needed for playback)

```sh
npm install
npm start
```

Streams play through a small HLS proxy in this server (see below), so it has to be running while
you watch.

## Install

Either addon URL works, as long as `npm start` is running:

- **Local:** `http://127.0.0.1:7000/manifest.json` (has search, guide is always current).
- **GitHub Pages:** https://yuvrajbajwa10.github.io/stremio-slyguy-live/ (click **Install in
  Stremio**). A static copy rebuilt hourly by GitHub Actions. No search, and the now/next guide
  can be up to an hour old (times in Australia/Melbourne time).

Install only one of them, or the channels appear twice. In Stremio, open **Discover → TV** and
pick **Australia** or **New Zealand**.

Each channel's first stream ("Live") uses the local proxy. The Pages build also lists a "Direct"
stream that relies on the Stremio desktop app's streaming server to send the provider headers; it
does not play in web.stremio.com.

GitHub pauses scheduled workflows after 60 days without repository activity. If the Pages guide
stops updating, re-enable the workflow from the Actions tab. To build the static copy yourself,
run `npm run build` (output goes to `dist/`).

## How playback works

The Kodi addons send provider-specific headers (user-agent, `x-forwarded-for` for the Plex
region, ...). A browser can't send these, and several CDNs don't allow web.stremio.com via CORS.
So every stream goes through the proxy (`/hls/...`), which fetches playlists and segments with the
right headers, rewrites the playlist URIs and serves everything with
`Access-Control-Allow-Origin: *`.

Two details make it work in web Stremio:

- The playlist is served as exactly `application/vnd.apple.mpegurl` (no charset). Stremio's web
  player only uses hls.js when the content type matches exactly.
- If the Stremio app's streaming server is running, the web player probes streams with ffmpeg and
  sends playable ones through its converter, which rejects live streams. The proxy refuses that
  probe (user-agent `Lavf/...`) so the player falls back to hls.js.

## Other devices

To use the addon from a phone or TV on your network:

```sh
HOST=0.0.0.0 BASE_URL=http://<your-pc-lan-ip>:7000 npm start
```

Stremio only allows non-HTTPS addon URLs on localhost, so for other devices you may need an
HTTPS tunnel (e.g. cloudflared) and to set `BASE_URL` to the tunnel URL.

## Known limitations

- Channels are geo-restricted by the providers. From Australia, most NZ Freeview channels play,
  but Three, Bravo, Sky Open, eden and Trackside are NZ-only.
- Plex rate-limits heavy use (HTTP 429).
