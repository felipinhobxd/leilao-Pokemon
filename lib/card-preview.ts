// Local previews only. Original Files remain untouched for publication.
export const CARD_PREVIEW_CONCURRENCY = 2;
export const CARD_PREVIEW_MAX_SIDE = 560;
export type PreviewProgress = { completed: number; total: number; remaining: number };
type PreviewItem = { id: string; file: File };
type Job = PreviewItem & { cancelled: boolean };

export async function makeCardPreview(file: File): Promise<string> {
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, CARD_PREVIEW_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("preview_canvas_unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "medium";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    bitmap = undefined;
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) throw new Error("preview_encoding_failed");
    return URL.createObjectURL(blob);
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

// One queue per wizard, shared across selections. Yield before each decode so
// progress, typing and removals can paint even during a 200-photo import.
export function createCardPreviewQueue(options: {
  onPreview: (id: string, url: string) => boolean;
  onError: (id: string) => void;
  onProgress: (progress: PreviewProgress) => void;
  prepare?: (file: File) => Promise<string>;
  release?: (url: string) => void;
  yieldToUI?: () => Promise<void>;
}) {
  const prepare = options.prepare ?? makeCardPreview;
  const release = options.release ?? (url => URL.revokeObjectURL(url));
  const yieldToUI = options.yieldToUI ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  const jobs = new Map<string, Job>();
  let waiting: Job[] = [];
  let active = 0;
  let completed = 0;
  let total = 0;
  let disposed = false;
  const notify = () => {
    if (!disposed) options.onProgress({ completed, total, remaining: waiting.length + active });
  };
  async function run(job: Job) {
    let url: string | undefined;
    try {
      await yieldToUI();
      if (disposed || job.cancelled) return;
      url = await prepare(job.file);
      if (!disposed && !job.cancelled && options.onPreview(job.id, url)) url = undefined;
    } catch {
      if (!disposed && !job.cancelled) options.onError(job.id);
    } finally {
      if (url) release(url);
      jobs.delete(job.id);
      active--;
      completed++;
      notify();
      pump();
    }
  }
  function pump() {
    while (!disposed && active < CARD_PREVIEW_CONCURRENCY && waiting.length) {
      const job = waiting.shift()!;
      active++;
      void run(job);
    }
  }
  return {
    get busy() { return active > 0 || waiting.length > 0; },
    enqueue(items: PreviewItem[]) {
      if (disposed) return;
      if (!active && !waiting.length) { total = 0; completed = 0; }
      for (const item of items) {
        if (jobs.has(item.id)) continue;
        const job = { ...item, cancelled: false };
        jobs.set(job.id, job);
        waiting.push(job);
        total++;
      }
      notify();
      pump();
    },
    cancel(id: string) {
      const job = jobs.get(id);
      if (!job) return;
      job.cancelled = true;
      const index = waiting.indexOf(job);
      if (index >= 0) { waiting.splice(index, 1); jobs.delete(id); completed++; }
      notify();
    },
    dispose() {
      disposed = true;
      for (const job of jobs.values()) job.cancelled = true;
      waiting = [];
      jobs.clear();
    },
  };
}

export type CardPreviewQueue = ReturnType<typeof createCardPreviewQueue>;
