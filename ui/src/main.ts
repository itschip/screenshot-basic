import { createGameView } from "./webgl";

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
  gameView: any;
  queue: Promise<void> = Promise.resolve();
  // just to prevent excessive waiting after the first capture
  hasWaitedForInitialFrames = false;

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

    const gameView = createGameView(canvas);
    gameView.resize(canvas.width, canvas.height);
    this.gameView = gameView;

    let imageData: string | Blob;

    try {
      // wait for the FiveM WebGL hook to populate the game framebuffer
      if (!this.hasWaitedForInitialFrames) {
        // value of 5 is random, but hopefully enough for lower spec machines as well
        await this.waitForFrames(5);
        this.hasWaitedForInitialFrames = true;
      }
      imageData = request.targetField
        ? await this.canvasToBlob(canvas, type, request.quality)
        : canvas.toDataURL(type, request.quality);
    } finally {
      gameView.dispose();
      this.gameView = null;
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
