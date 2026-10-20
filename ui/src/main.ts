declare class CfxGameViewRenderer {
  constructor(canvas: HTMLCanvasElement);
  resize(width: number, height: number): void;
  destroy(): void;
}

class ScreenshotRequest {
  encoding: "jpg" | "png" | "webp";
  quality: number;
  headers: any;

  correlation: string;

  resultURL: string;

  targetURL: string;
  targetField: string;
}

class ScreenshotUI {
  gameView: CfxGameViewRenderer | null = null;
  queue: Promise<void> = Promise.resolve();

  initialize() {
    window.addEventListener("message", (event) => {
      const request = event.data.request;

      if (request) {
        this.queue = this.queue
          .then(() => this.handleRequest(request))
          .catch((error) =>
            console.error("[screenshot-basic] capture error:", error),
          );
      }
    });

    window.addEventListener("resize", () => {
      this.resize();
    });
  }

  resize() {
    if (this.gameView) {
      this.gameView.resize(window.innerWidth, window.innerHeight);
    }
  }

  async handleRequest(request: ScreenshotRequest) {
    if (typeof CfxGameViewRenderer === "undefined") {
      throw new Error(
        "CfxGameViewRenderer is unavailable; update your FiveM client.",
      );
    }

    let type = "image/png";

    switch (request.encoding) {
      case "jpg":
        type = "image/jpeg";
        break;
      case "png":
        type = "image/png";
        break;
      case "webp":
        type = "image/webp";
        break;
    }

    if (!request.quality) {
      request.quality = 0.92;
    }

    const canvas = document.createElement("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const gameView = new CfxGameViewRenderer(canvas);
    this.gameView = gameView;

    let imageData: string | Blob;

    try {
      gameView.resize(canvas.width, canvas.height);
      // Each new renderer needs frames for the game texture to become available.
      await this.waitForFrames(5);
      imageData = request.targetField
        ? await this.canvasToBlob(canvas, type, request.quality)
        : canvas.toDataURL(type, request.quality);
    } finally {
      gameView.destroy();
      this.gameView = null;

      // destroy() stops rendering but does not release the WebGL context.
      const gl = canvas.getContext("webgl2");
      if (gl && "getExtension" in gl) {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) {
          ext.loseContext();
        }
      }
    }

    const getFormData = () => {
      const formData = new FormData();
      formData.append(
        request.targetField,
        imageData as Blob,
        `screenshot.${request.encoding}`,
      );

      return formData;
    };

    // note: bytes over 1MB will be rejected by the server
    const response = await fetch(request.targetURL, {
      method: "POST",
      mode: "cors",
      headers: request.headers,
      body: request.targetField
        ? getFormData()
        : JSON.stringify({
            data: imageData,
            id: request.correlation,
          }),
    });

    const text = await response.text();

    if (request.resultURL) {
      await fetch(request.resultURL, {
        method: "POST",
        mode: "cors",
        body: JSON.stringify({
          data: text,
          id: request.correlation,
        }),
      });
    }
  }

  canvasToBlob(
    canvas: HTMLCanvasElement,
    type: string,
    quality: number,
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to encode screenshot"));
          }
        },
        type,
        quality,
      );
    });
  }

  // useful as some clients report black images on the first capture from
  // client exports
  // usually not an issue through server exports
  waitForFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
      let framesWaited = 0;

      const waitFrame = () => {
        framesWaited++;

        if (framesWaited >= count) {
          resolve();
        } else {
          requestAnimationFrame(waitFrame);
        }
      };

      requestAnimationFrame(waitFrame);
    });
  }
}

const ui = new ScreenshotUI();
ui.initialize();
