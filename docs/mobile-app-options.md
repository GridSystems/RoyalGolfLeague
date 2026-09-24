# Turning the Saturday League app into Android / iOS apps — notes

_Notes captured 2026-07-20. Decision deferred — revisit when there's appetite/demand._

## TL;DR

The app is already a single hosted `index.html` + Supabase, so **nothing gets rewritten**. Two real options:

1. **PWA** — make it installable ("Add to Home Screen"). Free, no store, no Mac, no review.
2. **Capacitor wrapper** — wrap the existing HTML in a thin native shell and publish to the stores.

A full native rewrite (Flutter/React Native) is **not worth it** here.

**Suggested sequencing:** PWA (free) → Google Play via Windows ($25 once) → iOS via cloud CI ($99/yr, no Mac) only if there's demand.

## The three paths

| Path | What it is | Store listing | Cost | Effort |
|---|---|---|---|---|
| **1. PWA** | manifest.json + service worker + icons; users install from browser | No | £0 | ~½ day |
| **2. Wrapper (Capacitor / TWA)** ⭐ | Wrap `index.html` in a native shell; publish both stores | Yes | Store fees only | ~1 week first time |
| **3. Native rewrite** | Rebuild in Flutter/RN | Yes | High | Weeks — skip |

## Costs / licences

| Item | Cost | Notes |
|---|---|---|
| **Apple Developer Program** | **$99/year (~700 DKK)** | Recurring — stop paying, app is pulled. A registered nonprofit/*forening* may qualify for Apple's **fee waiver** — check if the club is a formal association. |
| **Google Play Developer** | **$25 one-time** | Pay once, ever. |
| **Capacitor / Android Studio / Xcode** | Free | Open-source / free tooling. |
| **Supabase** | Unchanged | Existing setup carries over. |

True licence cost = **$99/yr (Apple) + $25 once (Google)**. Everything else is free tooling.

## The Mac question (important)

- iOS builds **must** be compiled + signed on **macOS** (Xcode only runs there). Every cross-platform tool hits this wall.
- **You do NOT need to own a Mac** — macOS just has to be *somewhere in the pipeline*.

| Route | How | Cost | Own a Mac? |
|---|---|---|---|
| **Cloud CI build** ⭐ | Push code → service spins up macOS, builds/signs/uploads. Never see a Mac. | Free tier → modest | No |
| **Rented cloud Mac** | Remote into real macOS by hour/month | ~$1/hr or ~$20–30/mo | No (rent) |
| **Used Mac mini (M1)** | One-time buy, easiest first-time path | ~$400–500 once | Yes |

Cloud-CI options for a **Capacitor** app:
- **GitHub Actions** macOS runners — **free on public repos** (ours is public). Fully scriptable build+sign+upload.
- **Codemagic** — free tier (~500 macOS build min/mo), built for Capacitor/Flutter. Easiest.
- **Ionic Appflow** — Capacitor's own cloud build service, free tier for low volume.

Still need the **$99 Apple account** (App Store Connect is web-based, no Mac) and **signing certificate** management — **Fastlane** on the CI runner automates the fiddly cert/provisioning part.

**Trade-off:** cloud CI = no Mac hardware but first-time iOS *signing* config is more painful headless than clicking through Xcode once. If iOS builds will be maintained for years, a used Mac mini often pays for itself in saved setup pain.

Android has **none** of this — build + sign entirely on Windows.

## Implications that actually bite

1. **Apple Guideline 4.2 ("minimum functionality").** Apple often rejects thin web wrappers as "just a website." Biggest risk. Mitigation: add something native — **push notifications** (e.g. Saturday sign-up reminders) or offline scoring — genuinely useful and helps it pass. Google Play is far more relaxed.
2. **Updates stay instant IF the shell wraps the live URL.** Capacitor/TWA pointing at the GitHub Pages URL means normal `git push` still updates app content immediately, **no store re-review**. Only native-shell changes need resubmission. Preserves current zero-friction deploy.
3. **Privacy policy + data declarations mandatory.** Both stores require a published privacy policy URL + data-safety / privacy-nutrition-label form (we collect names, scores, handicaps via Supabase). Small but non-optional.
4. **New ongoing maintenance:** signing certs (Apple certs expire yearly), store listings, multi-size screenshots, the $99 renewal you must not forget.
5. **Doesn't change security.** Store presence doesn't touch the anon-key / RLS situation — real auth is still a separate future item.

## Bottoms-up effort estimate (Path 2, both stores, first time)

**Shared foundation**
- PWA baseline (manifest, service worker, icons): 3–5h
- Privacy policy doc + hosting: 2–3h

**Android (~17–23h)**
- Capacitor init + Android platform: 1–2h · Icons/splash/config: 2h · Signing key + build AAB: 2h · Play Console setup, listing, screenshots, data-safety form: 4–6h · Device testing + fixes: 3–4h · Submit + iterate: 2h

**iOS (~18–25h)** _(needs macOS in the pipeline)_
- Capacitor iOS platform: 2h · Icons/splash: 2h · Certs/provisioning/App IDs: 3–4h · App Store Connect listing, screenshots, privacy labels: 4–6h · TestFlight device testing: 3h · Submit + review iteration (4.2 buffer): 4–8h

**Total ≈ 40–56 hours** first time (~1–1½ weeks focused), plus light ongoing upkeep. Android alone is ~half that with no Mac/annual-fee burden.

## Recommendation

Start as a **PWA** (half a day, £0, no Mac, no fees) and see if "add to home screen" is enough. If store discoverability or push notifications are needed, do **Capacitor → Google Play first** ($25, no Mac), and take on **iOS** ($99/yr + cloud CI or Mac + review risk) only if there's real demand. The PWA foundation work is reusable if we later go Capacitor.

## Next concrete step when we return

- Spec the PWA path: `manifest.json`, service worker, icon set for the existing `index.html` (free, reusable).
- Optionally: sketch the GitHub Actions iOS build workflow to see how involved the "no Mac" path really is.
