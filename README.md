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
> broadcasters' terms of use.

| Catalog | Channels |
|---|---|
| Australia Top 15 | Seven, Nine, ABC TV, 10, SBS, ABC NEWS, 7mate, 7two, 9Gem, 9Go!, 7flix, SBS World Movies, SBS Food, ABC Kids, ABC Family, NITV |
| New Zealand Top 15 | Three, Sky Open, Bravo, Whakaata Māori, Rush, eden, HGTV, Al Jazeera, Te Reo, Trackside 1, Trackside 2, Parliament TV |

The lists live in `src/providers.js` (`catalogs`), matched by channel name. TVNZ 1, TVNZ 2 and
DUKE are left out because they're Widevine (DRM) protected. Set `AU_CITY` (Sydney, Melbourne,
Brisbane, Perth, Adelaide, Darwin, Hobart or Canberra) to use another city's Freeview lineup.

## Install

Open https://yuvrajbajwa10.github.io/stremio-slyguy-live/ and click **Install in Stremio**. Then
open **Discover → TV** and pick **Australia Top 15** or **New Zealand Top 15**.

Nothing has to run on your computer. The addon is a static copy on GitHub Pages, rebuilt hourly
by GitHub Actions, so the now/next guide can be up to an hour old (times in Australia/Melbourne
time). Each channel links straight to the broadcaster's own stream.

GitHub pauses scheduled workflows after 60 days without repository activity. If the guide stops
updating, re-enable the workflow from the Actions tab.

## Development

```sh
npm install
npm start        # local copy at http://127.0.0.1:7000/manifest.json
npm run build    # static copy in dist/
```

Don't install the local and the Pages copy together, or the channels appear twice.

## Known limitations

- It plays in the Stremio desktop, Android and TV apps, not in a browser tab (web.stremio.com).
  The broadcasters' servers don't allow that page to fetch their streams (CORS).
- Channels are geo-restricted by the providers. From Australia, only Whakaata Māori, HGTV,
  Al Jazeera, Te Reo and Parliament TV play from the NZ list; Three, Sky Open, Bravo, Rush, eden
  and Trackside are NZ-only.
