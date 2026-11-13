# 🎬 Movie Night

Watch movies together from different places. Your laptop does all the heavy work; her tablet just plays.

- **Everything happens in the app.** On your laptop: **＋ Add movie**, pick the file, done. It converts in the background with a progress bar.
- **Sharpest picture her tablet can show.** Each movie is made in several qualities, up to 4K. Her Galaxy Tab A8 (1920×1200 screen) gets an extra-sharp 1080p HQ version sized for her ~7.75 Mbps.
- **Wi-Fi dips don't show.** Up to two minutes is loaded ahead. If her connection really drops, both screens pause together and resume together.
- **Either of you can play, pause or skip**, and it happens on both screens within a fraction of a second.
- **Made for the two of you.** Beige and bows, with cartoon versions of you two and the pup acting out movie scenes, your own faces as reactions, and the pup fetching the movie while it loads.
- **🎀 Personalize** (on the laptop): your names, the pup's name and the day you got together. The app shows "Together X days" and counts your movie nights.
- **Your photos as polaroids:** in Personalize, click **Open photos folder** and drop pictures in. They stay on your laptop and are never uploaded to GitHub or anywhere else.
- Subtitles and full screen.

---

## Setup on your laptop (once, about 10 minutes)

1. **Download Movie Night**: <https://github.com/romariobenn19-dev/kraken-trading-bot/archive/refs/heads/claude/sleepy-planck-uv5qqu.zip>
   Extract the ZIP and keep the `movie-night` folder somewhere permanent, such as `C:\Movie Night`.
2. **Double-click `setup.bat`** in that folder and click **Yes** when Windows asks for permission. It:
   - installs Node.js and FFmpeg if they're missing
   - adds a firewall rule that only lets in your Tailscale devices
   - puts a **Movie Night** icon on your desktop and in the Start menu
   - makes Movie Night start by itself whenever Windows starts
   - opens the app
3. **Install Tailscale** (free private connection between your devices): <https://tailscale.com/download/windows>. Sign in.

If Windows says *"Windows protected your PC"*, click **More info**, then **Run anyway**.

## Setup on her tablet (once)

1. You: in the Tailscale admin console (<https://login.tailscale.com/admin/machines>), click **⋯** next to your laptop, then **Share…**, and send her the invite.
2. Her: install **Tailscale** from the Play Store, sign in, accept your invite, and switch it **on**.
3. You: in Movie Night on your laptop, click **Copy** next to **Her link** and send it to her.
4. Her: open the link in Chrome, type her name, and bookmark it (or add it to her home screen).

## Which browser?

Use **Google Chrome** on the laptop and on her tablet. Chrome plays the HEVC versions out of the box on modern graphics. Microsoft Edge can't, unless the "HEVC Video Extensions" app is installed. The desktop icon opens Chrome automatically when it's installed. If a device can't play a movie, it says so on screen instead of waiting forever.

## Every movie night

1. You: click the **Movie Night** icon on your desktop (it's usually already running).
2. Her: tap her bookmark, with Tailscale on.
3. Pick a movie, press ▶, and talk on a WhatsApp call.

## Adding movies

In Movie Night on your laptop, click **＋ Add movie**:
- Pick a place (Downloads, Videos…), then the movie file.
- Check the title. It's tidied automatically, e.g. "Resident.Evil.2026.REPACK.1080p…" becomes "Resident Evil (2026)".
- Optional: **Clean up film grain**, for older or grainy films, so they look sharper.
- Optional: **Skip H.264 backups**, about a third faster. The app checks every device you two use (her tablet, your phone, the laptop's browser) and ticks this for you only when all of them can play HEVC.
- **Quick** (ticked by default): only makes the versions her tablet uses. Untick it if you also want 4K / 1440p versions.
- Click **Prepare movie**. The version she watches is made first, and **the movie appears on both screens as soon as that's done**, roughly 10–15 minutes for a 1h30 film. The backup versions (used if her Wi-Fi dips) keep going in the background; the card says "finishing backups…" until they're done.

Good to know:
- Subtitles: put a matching `.srt` next to the movie (`Film.mkv` and `Film.srt`) and they're picked up automatically.
- Disk space: about 3–5 GB per 1080p film, more for 4K. Delete movies with the 🗑 on their card. Your original file is never touched.
- Only movie files you have work. Netflix and other paid services lock their video so it can't be converted.

## Updating

Click **Check for updates** in the app. If there's a new version, it installs it and restarts by itself.

---

## What her connection can handle

Her speed test showed **7.75 Mbps**. Your 42 Mbps upload is plenty.

| Quality | HEVC (her tablet) | H.264 (backup) |
|---|---|---|
| 2160p (4K) | ~9 Mbps | – |
| 1440p | ~5 Mbps | – |
| **1080p HQ** | **~4.5 Mbps** | – |
| 1080p | ~3.2 Mbps | ~5 Mbps |
| 720p | ~1.6 Mbps | ~2.5 Mbps |
| 480p | ~0.8 Mbps | ~1.1 Mbps |

## Troubleshooting

| Problem | Fix |
|---|---|
| Her link won't load | Is Tailscale on (connected) on both devices? Is your laptop awake? Click the desktop icon to make sure Movie Night is running. |
| "Her link: Tailscale is off" | Open Tailscale on the laptop and connect, then refresh the page |
| It keeps pausing for her | Check her bubble's Mbps number. Moving closer to the router, or switching the router to 5 GHz Wi-Fi, helps most. |
| A movie failed to prepare | The error shows in its progress box. Send a screenshot. |
| Something odd | Movie Night runs in a minimised window called "Movie Night" on your taskbar. Open it to see messages. Closing it stops Movie Night; the desktop icon starts it again. |

Settings → System → Power: set the laptop to never sleep while plugged in, or a movie can stop halfway through.

## How it works

- `server.js` runs on your laptop. It serves the app and the movie chunks, and keeps playback in sync.
- `host.js` holds the laptop-only tools: adding and deleting movies, the conversion queue, and updates. They only answer requests from the laptop itself.
- `prepare.js` converts a movie with FFmpeg and your graphics card into HEVC and H.264 versions in 4-second chunks. The version she watches gets the slowest, sharpest settings; the backups get faster ones.
- Her tablet picks the best quality its screen and connection can handle, keeps up to 2 minutes loaded ahead, and reports its health every second. The server pauses everyone if anyone runs dry.
- Her link contains a random secret key, created on first run and stored in `config.json`. Without it, the server refuses every request.
