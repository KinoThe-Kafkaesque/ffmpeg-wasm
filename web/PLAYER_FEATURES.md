# FFmpeg WASM Player v2 - Feature Documentation

## Keyboard Shortcuts

### Playback
| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `Escape` | Exit fullscreen or Stop playback |

### Seeking
| Key | Action |
|-----|--------|
| `←` / `→` | Seek -5s / +5s |
| `Shift+←` / `Shift+→` | Seek -30s / +30s |
| `J` / `L` | Seek -10s / +10s |
| `0-9` | Jump to 0%-90% of video |

### Volume
| Key | Action |
|-----|--------|
| `↑` / `↓` | Volume +5% / -5% |
| `M` | Mute / Unmute |

### Display
| Key | Action |
|-----|--------|
| `F` | Toggle fullscreen |
| `S` | Take screenshot (saves as PNG) |

### Frame Control
| Key | Action |
|-----|--------|
| `.` (period) | Step forward one frame |
| `,` (comma) | Step backward one frame (limited) |

### Playback Speed
| Key | Action |
|-----|--------|
| `[` | Decrease speed |
| `]` | Increase speed |
| `\` | Reset speed to 1x |

Available speeds: 0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 1.75x, 2x

### A-B Loop
| Key | Action |
|-----|--------|
| `A` | Set loop start point |
| `B` | Set loop end point |
| `P` | Toggle loop on/off |
| `C` | Clear loop points |

### Audio/Subtitle Sync
| Key | Action |
|-----|--------|
| `Shift+J` | Audio delay -100ms |
| `Shift+L` | Audio delay +100ms |
| `Z` | Subtitle delay -100ms |
| `X` | Subtitle delay +100ms |

---

## UI Controls

### Source Panel
- **Local File**: Select MKV/MP4/WebM files from disk
- **Stream URL**: Enter direct video URL (requires CORS)
- **Start Playback**: Begin playing selected source

### Settings Panel
- **Container Hint**: Auto / MP4 / Matroska format detection
- **Render Mode**: Canvas 2D or WebGL
- **Video Track**: Select video stream
- **Audio Track**: Select audio stream or disable
- **Initial Buffer**: Buffer size in MB before playback starts
- **Master Volume**: 0-100% volume slider

### Playback Panel
- **Speed**: Dropdown for playback speed selection
- **Aspect Ratio**: Auto / 16:9 / 4:3 / Fill / Stretch
- **A-B Loop**: Set start/end points with buttons, toggle loop

### Sync Panel
- **Audio Delay**: -5000ms to +5000ms slider
- **Subtitle Track**: Select embedded subtitle stream
- **Subtitle Delay**: -5000ms to +5000ms slider

### Filters Panel
- **Brightness**: 0-200% (default 100%)
- **Contrast**: 0-200% (default 100%)
- **Saturation**: 0-200% (default 100%)
- **Reset**: Restore all filters to defaults

---

## Player Overlay Controls

- **Play/Pause** button
- **Stop** button
- **Mute** button + volume slider
- **Time display**: Current / Total duration
- **Seek bar**: Click or drag to seek
- **Speed display**: Shows current playback speed
- **Screenshot** button
- **Fullscreen** button

---

## Statistics Panel

- **Resolution**: Video width x height
- **Frames**: Total decoded frames
- **Buffered**: Data buffered in memory
- **PTS**: Current presentation timestamp
- **Audio Format**: Sample rate / channels
- **Audio Clock**: Audio playback position

---

## On-Screen Display (OSD)

Visual feedback appears center-screen for:
- Volume changes
- Seek actions
- Speed changes
- Mute/unmute
- Screenshot capture
- Loop point setting
- Audio/subtitle delay adjustments

---

## Notes

- **Screenshot**: Saves as PNG with timestamp filename
- **Frame stepping**: Forward works reliably; backward is limited due to streaming architecture
- **Subtitle support**: Track selection UI ready; actual rendering requires WASM subtitle decoder
- **Audio delay**: Shifts audio timing relative to video
- **Video filters**: Applied via CSS, works on container element
- **A-B Loop**: Automatically seeks back to start point when end is reached
