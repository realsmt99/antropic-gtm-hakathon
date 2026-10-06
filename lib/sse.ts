import type { SseEvent } from './types';

/** Build a single SSE data frame. */
export function sseFrame(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * A simple controller that writes SSE frames to a ReadableStream.
 * Pass `null` for fire-and-forget (async) runs with no live stream —
 * emit/close become no-ops while the pipeline still updates the store.
 */
export class SseController {
  private controller: ReadableStreamDefaultController<Uint8Array> | null;
  private encoder = new TextEncoder();

  constructor(controller: ReadableStreamDefaultController<Uint8Array> | null) {
    this.controller = controller;
  }

  emit(event: SseEvent): void {
    if (!this.controller) return;
    const frame = sseFrame(event);
    try {
      this.controller.enqueue(this.encoder.encode(frame));
    } catch {
      // client disconnected — keep the pipeline running silently
      this.controller = null;
    }
  }

  close(): void {
    try {
      this.controller?.close();
    } catch {
      // already closed
    }
  }
}
