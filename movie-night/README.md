# 🎬 Movie Night

Watch movies together from different places. Your laptop does all the heavy work; her tablet just plays.

- **Your laptop converts each movie ahead of time** into several qualities, up to 4K, using its graphics card.
- **Her tablet picks the sharpest version its screen and connection can handle.** On a Galaxy Tab A8 (1920×1200 screen) that's full 1080p, the most that screen can display, using an extra-sharp 1080p HQ version sized for her ~7.75 Mbps.
- **She does nothing.** After the first visit she just opens the link, with no name screen and no settings. Picking quality, buffering and syncing all happen automatically.
- **Up to two minutes buffered ahead**, so short Wi-Fi dips never show on screen.
- **If her connection really drops, both screens pause together**, then resume together once she has a bigger buffer. Nobody falls behind.
- **Picture comes back sharp quickly.** After a dip, blurry buffered video is swapped for the sharp version as soon as her Wi-Fi recovers.
- **Synced to within a fraction of a second.** Either of you can play, pause or skip, and it happens on both screens.
- Subtitles, emoji reactions, full screen, and the screen stays awake while playing.

## What her connection can handle

Her speed test in bed showed **7.75 Mbps**. Here's what each quality needs, on average:

| Quality | HEVC (her tablet) | H.264 (fallback) |
|---|---|---|
| 2160p (4K) | ~9 Mbps | – |
| 1440p | ~5 Mbps | – |
| **1080p HQ** | **~4.5 Mbps** | – |
| 1080p | ~3.2 Mbps | ~5 Mbps |
| 720p | ~1.6 Mbps | ~2.5 Mbps |
| 480p | ~0.8 Mbps | ~1.1 Mbps |

At 7.75 Mbps she gets **1080p HQ** most of the time, stepping down to regular 1080p (still sharp) when her Wi-Fi is busy. On a 4K device with 10+ Mbps, the 4K versions get used automatically.

**Your upload speed matters too**: you're sending her the stream. You need about **6+ Mbps upload** for her 1080p. Run a speed test on your laptop to check.

---

## One-time setup (your Windows laptop)

1. **Install the tools.** Open *Terminal* or *PowerShell* and run:
   ```bash
   winget install OpenJS.NodeJS.LTS
   ```
   ```bash
   winget install Gyan.FFmpeg
   ```
   Close and reopen the terminal afterwards.

2. **Get this folder onto the laptop.** Download it from GitHub (green **Code** button → *Download ZIP*) and unzip it somewhere like `C:\MovieNight`.

3. **Install Tailscale on both devices.** Tailscale is a free private connection between your laptop and her tablet: no router setup, and it works from anywhere.
   - Laptop: <https://tailscale.com/download/windows>. Sign in.
   - Her tablet: install **Tailscale** from the Play Store.
   - Easiest: she signs into Tailscale with her own account, and you **share your laptop with her**. In the Tailscale admin console, open *Machines*, then your laptop's **⋯** menu, then *Share…*, and send her the invite.
   - Your laptop and her tablet connect directly, so the video doesn't pass through anyone else's servers.

4. **Allow her through Windows Firewall.** Run this once in *PowerShell as Administrator*. It only lets in devices on your Tailscale network:
   ```bash
   New-NetFirewallRule -DisplayName "Movie Night" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -RemoteAddress 100.64.0.0/10
   ```

5. **Stop the laptop sleeping while plugged in.** *Settings → System → Power* → set sleep to *Never* when plugged in.

## Adding movies

**Drag a movie file onto `prepare-movie.bat`.** That's it.

- **Grainy film?** (older films, or dark, noisy scenes) Run `node prepare.js "Film.mkv" --denoise`. Your laptop cleans the grain first, so the bitrate goes into real detail and her picture looks sharper.
- To get subtitles, put a matching `.srt` next to the movie, for example `Film.mkv` and `Film.srt`. It's picked up automatically.
- With the laptop's GPU, a 2-hour 4K film takes very roughly **30–60 minutes**. A 1080p film takes less.
- If you stop it partway, run it again. It skips the qualities it already finished.
- It needs disk space: about **15–20 GB per 4K film** or **5 GB per 1080p film**, in the `library` folder.
- It only works with movie files you have. Netflix and other paid services lock their video so it can't be converted or re-sent.

Advanced (from a terminal in this folder):

```bash
node prepare.js "C:\Movies\Film.mkv" --title "The Film" --max 1080
```

Run `node prepare.js --help` for all options: audio track choice, embedded subtitles, encoder choice, and more.

## Movie night

1. **Double-click `start-movie-night.bat`.** It prints two links:
   - **You (on this laptop)**: open it in your browser.
   - **Send this to her**: an address starting with `http://100.…`. Send it to her once, and she can bookmark it.
2. She opens the link in **Chrome** on her tablet, with Tailscale switched on, and taps **Join**.
3. Either of you picks a movie, and it opens on both screens.
4. Press ▶. It waits a few seconds until both of you have enough loaded, then starts on both screens at the same moment.
5. Tap ⛶ for full screen. The bubbles at the top show each person's quality and how many seconds are buffered.

Talk over a phone or WhatsApp call alongside the movie. A voice call uses very little data.

## Troubleshooting

| Problem | Fix |
|---|---|
| Her link won't load | Is Tailscale on (connected) on both devices? Is `start-movie-night.bat` still running? Did you do the firewall step? |
| "This link is missing its key" | Use the full link the server prints. It ends in `?key=…` |
| It keeps pausing for her | Check her bubble's Mbps number. Moving closer to the router, or switching the router to 5 GHz Wi-Fi, helps most. Each stall makes the app wait for a bigger buffer next time, so it settles down. |
| Picture looks soft for her | Look at the quality bubble. If it reads 720p or lower, her Wi-Fi is the limit at that moment. It climbs back up on its own. She can also lock a quality in the menu, which uses the buffer instead of switching. |
| Colours look washed out (HDR/4K films) | Use the full FFmpeg build (`winget install Gyan.FFmpeg`), delete the movie's folder in `library`, then prepare it again |
| Converting is very slow | It printed `Encoder: cpu`. Update your NVIDIA/AMD graphics driver so the GPU encoder can be used. |

## How it works

```
 Your laptop                                              Her tablet
 ┌─────────────────────────────┐                      ┌───────────────────────┐
 │ prepare.js (FFmpeg + GPU)   │                      │ Chrome                │
 │  movie.mkv → 4K/1440/1080/… │  4-second chunks     │  plays the best       │
 │  HEVC + H.264 HLS chunks    │ ───────────────────▶ │  quality that fits,   │
 │                             │  (over Tailscale)    │  ~2 min buffered      │
 │ server.js                   │                      │                       │
 │  serves chunks              │  sync messages       │  reports buffer &     │
 │  sync: play/pause/seek  ◀───┼──────────────────────┼─▶ health every second │
 │  pauses all if one stalls   │  (a few bytes/sec)   │                       │
 └─────────────────────────────┘                      └───────────────────────┘
```

- **Converting ahead of time**, rather than live, allows slow high-quality GPU settings, so you get a better picture per megabit than live screen-sharing.
- **HEVC** gives the same picture as H.264 with about 40% less data. Devices that can't decode it get H.264 automatically.
- Each device only offers qualities its screen and decoder can actually show smoothly, using the browser's Media Capabilities API.
- **Sync**: the laptop's server is the clock. Each player measures its clock offset to the server, then nudges its speed by ±4% to stay within ~0.1 s, or jumps if it's more than 1.5 s off.
- **Buffering protection**: if anyone's buffer runs dry, the server pauses everyone and waits until all viewers have 20 s buffered (40 s, 60 s… after repeated stalls) before resuming together.
- The link contains a random secret key, created on first run and stored in `config.json`. Without it the server refuses every request.
