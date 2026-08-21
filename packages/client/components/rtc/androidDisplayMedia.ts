/**
 * Android System WebView does not expose getDisplayMedia. The Muchat APK
 * captures via MediaProjection and pushes JPEG frames; we turn those into a
 * canvas MediaStream so LiveKit can keep calling setScreenShareEnabled.
 */

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS = 10;
const DIALOG_TIMEOUT_MS = 60_000;

export type DisplayCaptureProfile = {
  width: number;
  height: number;
  frameRate: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function constrainNumber(
  value: ConstrainULong | ConstrainDouble | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    if (typeof value.ideal === "number") return value.ideal;
    if (typeof value.max === "number") return value.max;
    if (typeof value.exact === "number") return value.exact;
    if (typeof value.min === "number") return value.min;
  }
  return fallback;
}

/** Read LiveKit's getDisplayMedia constraints into a capture size the APK understands. */
export function displayCaptureProfile(
  opts?: DisplayMediaStreamOptions,
): DisplayCaptureProfile {
  const video = opts?.video;
  let width = DEFAULT_WIDTH;
  let height = DEFAULT_HEIGHT;
  let frameRate = DEFAULT_FPS;
  if (video && typeof video === "object") {
    width = constrainNumber(video.width, width);
    height = constrainNumber(video.height, height);
    frameRate = constrainNumber(video.frameRate, frameRate);
  }
  return {
    width: clamp(Math.round(width), 320, 1920),
    height: clamp(Math.round(height), 180, 1080),
    frameRate: clamp(Math.round(frameRate), 5, 15),
  };
}

export function shouldUseAndroidCapture(): boolean {
  return Boolean(
    window.MuchatNative?.startScreenShare && !window.native?.listScreenSources,
  );
}

/**
 * Ask the APK to start MediaProjection and return a canvas stream of the screen.
 */
export function startAndroidDisplayMedia(
  opts?: DisplayMediaStreamOptions,
): Promise<MediaStream> {
  const native = window.MuchatNative;
  if (!native?.startScreenShare || !native.stopScreenShare) {
    return Promise.reject(
      new DOMException(
        "Atualize o app Muchat para compartilhar a tela.",
        "NotSupportedError",
      ),
    );
  }

  const { width, height, frameRate } = displayCaptureProfile(opts);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(
      new DOMException("Não deu para capturar a tela.", "NotSupportedError"),
    );
  }
  ctx.fillStyle = "#141210";
  ctx.fillRect(0, 0, width, height);

  const stream = canvas.captureStream(frameRate);
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    return Promise.reject(
      new DOMException("Não deu para capturar a tela.", "NotSupportedError"),
    );
  }

  const frameImage = new Image();
  let stopped = false;
  let settled = false;

  const stopNative = () => {
    if (stopped) return;
    stopped = true;
    window.__muchatScreenShare = undefined;
    try {
      native.stopScreenShare();
    } catch {
      /* already torn down */
    }
  };

  const originalStop = videoTrack.stop.bind(videoTrack);
  videoTrack.stop = () => {
    stopNative();
    originalStop();
  };
  videoTrack.addEventListener("ended", stopNative);

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      stopNative();
      originalStop();
      reject(
        new DOMException(
          "Tempo esgotado no compartilhamento de tela.",
          "NotAllowedError",
        ),
      );
    }, DIALOG_TIMEOUT_MS);

    const finish = (ok: boolean, error?: DOMException) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (ok) {
        resolve(stream);
        return;
      }
      stopNative();
      originalStop();
      reject(
        error ??
          new DOMException(
            "Não deu para compartilhar a tela.",
            "NotAllowedError",
          ),
      );
    };

    window.__muchatScreenShare = (event, payload) => {
      if (event === "frame" && typeof payload === "string") {
        frameImage.onload = () => {
          ctx.drawImage(frameImage, 0, 0, width, height);
        };
        frameImage.src = "data:image/jpeg;base64," + payload;
        return;
      }
      if (event === "ready") {
        finish(true);
        return;
      }
      if (event === "error") {
        finish(
          false,
          new DOMException(
            payload || "Compartilhamento de tela cancelado.",
            "NotAllowedError",
          ),
        );
        return;
      }
      if (event === "ended") {
        // A defensive stop of a previous FGS can fire before this share is ready.
        if (!settled) return;
        stopNative();
        originalStop();
      }
    };

    try {
      native.startScreenShare(width, height, frameRate);
    } catch (err) {
      finish(
        false,
        err instanceof DOMException
          ? err
          : new DOMException(
              "Não deu para iniciar o compartilhamento de tela.",
              "NotSupportedError",
            ),
      );
    }
  });
}
