# Production Prompt: Comic Commander — 60-Second YouTube Product Trailer

## Role

Act as a senior motion designer, product-marketing creative director, and Remotion/React video engineer. Plan and implement a polished, exactly 60-second YouTube product trailer for **Comic Commander**, using the real product, its website design language, and the released v1.0.1 build.

## Product and source of truth

- Product page: https://krocon.de/products/comiccommander/
- GitHub repository: https://github.com/krocon/comic-commander-tauri
- Released version: https://github.com/krocon/comic-commander-tauri/releases/tag/v1.0.1
- Brand / publisher website: https://krocon.de/

**The product has been released.** Do not describe it as unreleased, upcoming, or merely a project preview. The call to action should invite viewers to download or explore the released version.

Before writing the final script or implementing scenes:
1. Inspect the product page and the v1.0.1 release notes/assets.
2. Inspect the repository README and available screenshots.
3. Verify every feature, platform, file format, licence claim, and download destination against the current sources.
4. Use the actual interface and real screenshots or screen recordings wherever possible.
5. Do not invent features. If a detail cannot be verified, omit it or flag it for the product owner.

## Objective

Create a visually memorable, professional **60-second, English-language product trailer** for YouTube. It should feel like the Comic Commander product page has come to life: consistent typography, colours, contrast, spacing, shapes, and overall visual character.

The video should communicate the product's real value quickly, show the actual application in use, and finish with a clear path to the released download.

## Recommended technology stack

- **Remotion + React + TypeScript** for composition, animation, timing, preview, and rendering.
- **ElevenLabs** for the English voice-over.
- **Real product screenshots and screen recordings** captured from Comic Commander v1.0.1.
- **CSS transforms and Remotion animation primitives** for zooms, pans, reveals, callouts, and transitions.
- **FFmpeg** only where useful for final encoding, audio mixing, or post-processing.
- **OBS Studio** optionally, to capture real app interactions cleanly.
- No paid video editor is required.

Official references:
- Remotion: https://www.remotion.dev/
- ElevenLabs: https://elevenlabs.io/
- FFmpeg: https://ffmpeg.org/
- OBS Studio: https://obsproject.com/

Prefer a code-driven, repeatable workflow. Keep the project easy to maintain and re-render for future releases.

## Visual direction

1. **Derive the visual system from the live product page.** Inspect the page instead of guessing colours or fonts. Record the exact colours, typography, logo usage, background treatment, spacing, borders, and other distinctive details in a central theme file.
2. Use the real Comic Commander UI as the hero. Do not replace real interface screenshots with fabricated software mock-ups.
3. Build visual interest through controlled motion: slow camera moves, purposeful zooms, animated highlights, layered screenshots, restrained parallax, crisp typography, and clean transitions.
4. Keep text short and legible. Avoid clutter, generic stock-video aesthetics, excessive particles, and flashy transitions that compete with the product.
5. Use a restrained instrumental soundtrack under the voice-over. Ensure the voice is always clear.
6. Use only assets whose use is authorised. Comic covers and characters may be copyrighted; do not imply that Comic Commander owns them. Use suitable authorised screenshots/assets and, where needed, covers that the producer has permission to show.
7. Do not display unsupported claims, invented ratings, fake user counts, or unverified performance promises.

## Video format

- Duration: exactly **60 seconds**.
- Canvas: **1920 × 1080**, 16:9.
- Frame rate: **30 fps**.
- Output: high-quality H.264 MP4 with AAC audio, suitable for YouTube.
- Language: English (voice-over and on-screen copy).
- Audio: intelligible narration, balanced background music, clean beginning and end.
- Leave comfortable safe margins for text and important UI.
- Use a final timing check to ensure the rendered video is exactly 60 seconds.

## Story structure and timing

Treat the following as a creative starting point, not as permission to assume features. Adapt the sequence to the actual v1.0.1 product and only include verified functionality.

### Scene 1 — Hook (0–6 seconds)
Open with an immediate, visually striking view of the real Comic Commander experience. Reveal the product name and one short, benefit-led line. Establish the visual identity of the website from the first frame.

Possible voice-over direction:
> “Your comic collection deserves a better way to browse and read.”

### Scene 2 — Discover the collection (6–18 seconds)
Show the real collection interface. Use a smooth push-in or pan across actual cover thumbnails and highlight the relevant browsing experience. Only mention collection-management or organisation capabilities if verified.

Possible voice-over direction:
> “Bring your collection into one place and find the next story you want to read.”

Rewrite this line if the verified product behaviour does not support the implication.

### Scene 3 — Make the interface tangible (18–32 seconds)
Show the product's most visually distinctive verified feature. If the bookshelf view is present in v1.0.1, reveal it with a tasteful transformation from the actual interface. Otherwise, feature the strongest real UI interaction available.

Possible voice-over direction:
> “Explore your library in an interface designed around the joy of comics.”

Do not include a bookshelf, wall-of-covers, series recognition, or any other feature unless it exists in the released build.

### Scene 4 — Show reading in action (32–44 seconds)
Capture a real reading workflow: opening a supported item, moving between pages, zooming, or another verified interaction. Use deliberate zooms and restrained callouts to show what matters. Mention only formats confirmed by the project documentation or release.

Possible voice-over direction:
> “Open a book and settle into the story, with the controls and workflow the app actually provides.”

### Scene 5 — Release and call to action (44–60 seconds)
Make the released status unmistakable. End on a clean brand card using the real logo and website styling. Include the exact, verified download destination. A QR code may be added if it is tested and remains scannable at the final display size.

Preferred CTA:
> “Comic Commander is available now. Get version 1.0.1 from GitHub, and find out more at krocon dot de.”

Verify the release URL before final export:
https://github.com/krocon/comic-commander-tauri/releases/tag/v1.0.1

If the project has a more suitable official download page, use that instead, but do not invent a URL. Mention supported operating systems, open-source status, or licence only after verifying them from the current project sources.

## Voice-over workflow with ElevenLabs

1. Finalise the factual script before generating audio.
2. Aim for approximately **115–130 words** at a clear, natural pace; adjust to fit the actual timing rather than forcing the word count.
3. Choose a confident, warm, natural English voice suited to a polished indie software product.
4. Avoid an overdramatic announcer style. The narration should feel clear, approachable, and technically credible.
5. Generate the voice-over in ElevenLabs and export the audio.
6. Use the final audio duration and phrase boundaries to time the scenes, titles, and cuts.
7. Keep music below the narration and avoid clipping or abrupt endings.
8. Confirm that the selected voice and generated audio are licensed for the intended use.

## Suggested project structure

```text
comic-commander-promo/
├── public/
│   ├── screenshots/
│   ├── recordings/
│   ├── logo.svg
│   ├── voiceover.mp3
│   └── music.mp3
├── src/
│   ├── Root.tsx
│   ├── ComicCommanderPromo.tsx
│   ├── theme.ts
│   ├── script.ts
│   ├── scenes/
│   │   ├── Hook.tsx
│   │   ├── Collection.tsx
│   │   ├── FeatureHighlight.tsx
│   │   ├── Reader.tsx
│   │   └── EndCard.tsx
│   └── components/
│       ├── AppFrame.tsx
│       ├── Callout.tsx
│       └── AnimatedText.tsx
├── package.json
└── README.md
```

Adapt the structure to the actual implementation. Do not create empty abstractions just to match this example.

## Implementation requirements

- Build each scene as a reusable Remotion component.
- Keep brand colours, fonts, and common animation values in `theme.ts`.
- Keep narration copy and scene timing in a central script/timing definition where practical.
- Use deterministic frame-based animation; avoid timing that depends on real-time browser behaviour.
- Use actual captured UI and assets from the released product.
- Provide a preview composition and a reproducible render command.
- Avoid unnecessary dependencies.
- Do not hardcode unverified product claims or a download link other than the verified official destination.
- Check for black frames, text clipping, inconsistent UI scaling, audio clipping, and abrupt transitions.
- Render and inspect the final MP4 before declaring the task complete.

## Deliverables

Produce the following:

1. A concise creative concept and a scene-by-scene storyboard with timecodes.
2. The final English voice-over script, checked against verified product features.
3. An asset checklist specifying which screenshots, recordings, logo files, and audio files are needed.
4. The Remotion project source code and package scripts.
5. Instructions for generating the ElevenLabs voice-over and placing the resulting audio in the project.
6. A reproducible command to render the final 60-second MP4.
7. A final QA checklist covering timing, factual accuracy, visual consistency, audio, and YouTube export settings.

## Acceptance criteria

The result is successful only if:

- It is exactly 60 seconds long and exports as a 1920 × 1080, 30 fps MP4.
- The look is recognisably consistent with the live Comic Commander website.
- The real released application is shown, not merely generic mock-ups.
- Every feature and claim is supported by the current product/repository/release information.
- The English ElevenLabs narration is synchronised with the visuals and clearly audible.
- The video clearly communicates that Comic Commander is available now.
- The ending includes a working, verified route to the release/download.
- The project can be rendered again from source with documented steps.

Start by inspecting the product page, repository, and v1.0.1 release. Then produce the storyboard and factual script before implementing the video.
