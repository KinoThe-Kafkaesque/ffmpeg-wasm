subs don't work 
Subtitle type mismatch: track may be bitmap-based (PGS/VobSub). Our decoder only feeds ASS/TEXT rects into libass; image rects are ignored, so events never turn into drawable images.
Font attachment handling: if the stream relies on embedded fonts, we never load attachments from the container—only a hardcoded Inter font—so libass may refuse to render (e.g., missing style overrides).
Libass still not producing images: even with events present, ass_render_frame returning null suggests the renderer can’t synthesize an image (font fallback failure or style parsing failure). Verify by checking ass_track->styles and whether styles reference unavailable fonts.
PTS alignment: the render call uses state.api.pts (frame PTS) + delay; if that PTS lags or leaps relative to subtitle times (e.g., wrong base PTS after seeks), libass may consider the current time outside any event window.
Subtitle selection persistence: if selectSubtitle is applied before open and the decoder later reopens without reapplying, the active track could be wrong despite logs; double-check pendingStreamSelection propagation and that selectSubtitleStream is called after open with the desired index.
Renderer path overwrite: if we ever re-copy a fresh video frame after rendering (e.g., WebGL path re-upload after a blend), the subtitle overlay could be wiped; ensure subtitle blending happens immediately before the final copy/upload for both 2D and WebGL paths.
Libass frame size mismatch: if video size changes (e.g., after seeking) and we don’t refresh ass_set_frame_size, render could silently fail; verify width/height are non-zero and current when calling ass_render_frame.

random speedups during playback/ unpausing

some videos don't play

fix mkv container parsing

review chunking and correction logic

