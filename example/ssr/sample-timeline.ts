/**
 * A self-contained demo {@link TimelineSpec} — text + shapes only, so it needs
 * no external assets and renders in an offline sandbox. Used by the SSR worker's
 * `--demo` mode and as a fixture in tests.
 */
import type { TimelineSpec } from './timeline';

export function sampleTimeline(): TimelineSpec {
  const W = 320;
  const H = 180;
  return {
    width: W,
    height: H,
    fps: 30,
    background: 0x101014,
    range: [0, 2],
    tracks: [
      // Background: a full-frame teal rectangle.
      {
        zIndex: 0,
        clips: [
          {
            type: 'shape',
            shape: { kind: 'rect', width: W, height: H, fill: 0x0f766e },
            start: 0,
            end: 2,
            transform: { anchor: [0, 0], position: [0, 0] },
          },
        ],
      },
      // Foreground: a circle sliding left→right while the title fades in.
      {
        zIndex: 1,
        clips: [
          {
            type: 'shape',
            shape: { kind: 'ellipse', width: 48, height: 48, fill: 0xf59e0b },
            start: 0,
            end: 2,
            transform: {
              anchor: [0.5, 0.5],
              position: {
                keyframes: [
                  { time: 0, value: [40, H / 2] },
                  { time: 2, value: [W - 40, H / 2], easing: 'easeInOutCubic' },
                ],
              },
            },
            // A filter (shader) — renders on the server only via Route B's WebGPU backend.
            effects: [{ type: 'blur', strength: 4 }],
          },
          {
            type: 'text',
            text: 'Server-Side Render',
            fontSize: 26,
            fill: 0xffffff,
            start: 0,
            end: 2,
            transform: { anchor: [0.5, 0.5], position: [W / 2, 40] },
            opacity: {
              keyframes: [
                { time: 0, value: 0 },
                { time: 0.6, value: 1, easing: 'easeOutQuad' },
              ],
            },
          },
        ],
      },
    ],
    export: { container: 'mp4', videoCodec: 'avc', bitrate: 2_000_000 },
  };
}
