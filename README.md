# SlyGuy Live TV for Stremio

A Stremio addon that adds free live TV channels. It uses the same channel sources as the
[SlyGuy Kodi addons](https://github.com/matthuisman/slyguy.addons): Matt Huisman's `i.mjh.nz`
feeds, with now/next EPG.

| Catalog | Ported from | Filter (genre dropdown) |
|---|---|---|
| Pluto TV | `slyguy.pluto.tv.provider` | Country (default USA) |
| Samsung TV Plus | `slyguy.samsung.tv.plus` | Country (default United States) |
| Plex Live TV | `slyguy.plex.live` | Country (default Australia) |
| The Roku Channel | `slyguy.roku` | Category |
| AU Freeview | `plugin.video.au.freeview` | City (default Melbourne) |
| NZ Freeview | `plugin.video.nz.freeview` | – |

DRM (Widevine) and DASH-only channels are skipped, as are the Samsung channels the Kodi addon
also skips.

## Install (GitHub Pages)

Open https://yuvrajbajwa10.github.io/stremio-slyguy-live/ and click **Install in Stremio**, or
paste `https://yuvrajbajwa10.github.io/stremio-slyguy-live/manifest.json` into Stremio's addon
search box.

The Pages copy is a static build that a GitHub Actions workflow regenerates every hour. Because
there's no server behind it:

- Streams go straight to the provider, and Stremio's streaming server sends the headers they need
  (`proxyHeaders`). Keep the **Stremio desktop app** running, also when using web.stremio.com.
- There's no search, Pluto TV lists US channels only, and the now/next guide can be up to an hour
  old (times are shown in Australia/Melbourne time).
- Each channel also offers a "Local" stream that uses the local server below, if it's running.
- GitHub pauses scheduled workflows after 60 days without repository activity. If the guide stops
  updating, re-enable the workflow from the Actions tab.

To build the static copy yourself, run `npm run build` (output goes to `dist/`).

## Run locally (full version, with search)

```sh
npm install
npm start
```

Then in Stremio (desktop app or https://web.stremio.com in Chrome) go to **Addons**, paste
`http://127.0.0.1:7000/manifest.json` into the search/addon URL box, and press **Install**.
The channels appear under **Discover → TV**.

The server has to keep running while you watch.

## How playback works

The Kodi addons send provider-specific headers (user-agent, `x-forwarded-for` for the Pluto
region, ...). A browser can't send these, and some CDNs (e.g. Pluto) return CORS headers that
block web.stremio.com. So every stream goes through a small HLS proxy in this server
(`/hls/...`). It fetches playlists and segments with the right headers, rewrites the playlist
URIs and serves everything with `Access-Control-Allow-Origin: *`.

## Other devices

To use the addon from a phone or TV on your network:

```sh
HOST=0.0.0.0 BASE_URL=http://<your-pc-lan-ip>:7000 npm start
```

Stremio only allows non-HTTPS addon URLs on localhost, so for other devices you may need an
HTTPS tunnel (e.g. cloudflared) and to set `BASE_URL` to the tunnel URL.

## Known limitations

- Channels are geo-restricted by the providers. NZ Freeview only works from NZ, AU Freeview
  from AU, and many Samsung TV Plus channels return 403 outside their country.
- Pluto TV and Plex choose the lineup with the `x-forwarded-for` header, as the Kodi addons
  do. From Australia, Pluto USA and Plex Australia were tested and play. Samsung TV Plus has
  no Australian lineup, so only some of its foreign channels play.
