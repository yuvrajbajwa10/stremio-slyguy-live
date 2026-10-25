# AU & NZ Live TV for Stremio (unofficial)

A Stremio addon with the top Freeview channels for Australia and New Zealand. It uses the same
channel sources as the [SlyGuy Kodi addons](https://github.com/matthuisman/slyguy.addons)
(`plugin.video.au.freeview`, `plugin.video.nz.freeview`): Matt Huisman's `i.mjh.nz` feeds, with
now/next EPG.

> **Disclaimer:** This is an unofficial, personal project. It is not affiliated with or endorsed
> by SlyGuy, Matt Huisman, Freeview, Stremio or any broadcaster. Channel names and logos belong to
> their owners. The addon hosts no video. It only links to free-to-air streams that the
> broadcasters publish themselves. DRM-protected channels are left out on purpose, and
> geo-restrictions are not bypassed. You're responsible for using it in line with the
> broadcasters' terms of use. The local proxy is meant for your own devices, not for rebroadcasting
> streams to other people.

| Catalog | Channels |
|---|---|
| Australia Top 15 | Seven, Nine, ABC TV, 10, SBS, ABC NEWS, 7mate, 7two, 9Gem, 9Go!, 7flix, SBS World Movies, SBS Food, ABC Kids, ABC Family, NITV |
| New Zealand Top 15 | Three, Sky Open, Bravo, Whakaata Māori, Rush, eden, HGTV, Al Jazeera, Te Reo, Trackside 1, Trackside 2, Parliament TV |

The lists live in `src/providers.js` (`catalogs`), matched by channel name. TVNZ 1, TVNZ 2 and
DUKE are left out because they're Widevine (DRM) protected. Set `AU_CITY` (Sydney, Melbourne,
Brisbane, Perth, Adelaide, Darwin, Hobart or Canberra) to use another city's Freeview lineup.

## Run the local server (needed for playback)

```sh
npm install
npm start
```

Streams play through a small HLS proxy in this server (see below), so it has to be running while
you watch.

## Install

Either addon URL works, as long as `npm start` is running:

- **Local:** `http://127.0.0.1:7000/manifest.json` (guide is always current).
- **GitHub Pages:** https://yuvrajbajwa10.github.io/stremio-slyguy-live/ (click **Install in
  Stremio**). A static copy rebuilt hourly by GitHub Actions, so the now/next guide can be up to
  an hour old (times in Australia/Melbourne time).

Install only one of them, or the channels appear twice. In Stremio, open **Discover → TV** and
pick **Australia Top 15** or **New Zealand Top 15**.

GitHub pauses scheduled workflows after 60 days without repository activity. If the Pages guide
stops updating, re-enable the workflow from the Actions tab. To build the static copy yourself,
run `npm run build` (output goes to `dist/`).

## How playback works

The Kodi addons send provider-specific headers (such as the user-agent). A browser can't send
these, and several CDNs don't allow web.stremio.com via CORS.
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
HTTPS tunnel (e.g. cloudflared) and to set `BASE_URL` to the tunnel URL. Keep the tunnel URL to
yourself: a publicly shared proxy would relay the broadcasters' streams to other people.

## Known limitations

- Channels are geo-restricted by the providers. From Australia, only Whakaata Māori, HGTV,
  Al Jazeera, Te Reo and Parliament TV play from the NZ list; Three, Sky Open, Bravo, Rush, eden
  and Trackside are NZ-only.
