/**
 * Resize an image file to a max dimension while preserving aspect ratio.
 * Returns a high-quality JPEG Blob optimized for avatar display.
 */
export async function resizeImageForAvatar(
    file: File,
    maxSize = 800,
    quality = 0.95
): Promise<File> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            let { width: currentW, height: currentH } = img;

            // Calculate target dimensions
            let targetW = currentW;
            let targetH = currentH;

            if (currentW > maxSize || currentH > maxSize) {
                if (currentW > currentH) {
                    targetH = Math.round((currentH * maxSize) / currentW);
                    targetW = maxSize;
                } else {
                    targetW = Math.round((currentW * maxSize) / currentH);
                    targetH = maxSize;
                }
            }

            // High-quality step-down scaling to prevent pixelation (aliasing) on large photos
            let canvas = document.createElement("canvas");
            let ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("No canvas 2D context"));

            canvas.width = currentW;
            canvas.height = currentH;
            ctx.drawImage(img, 0, 0);

            // Step down by half each time until we get close to target size
            while (currentW * 0.5 > targetW) {
                currentW *= 0.5;
                currentH *= 0.5;
                const stepCanvas = document.createElement("canvas");
                stepCanvas.width = currentW;
                stepCanvas.height = currentH;
                const stepCtx = stepCanvas.getContext("2d");
                stepCtx?.drawImage(canvas, 0, 0, stepCanvas.width, stepCanvas.height);
                canvas = stepCanvas;
            }

            // Final resize to exact target dimensions
            const finalCanvas = document.createElement("canvas");
            finalCanvas.width = targetW;
            finalCanvas.height = targetH;
            const finalCtx = finalCanvas.getContext("2d");

            if (finalCtx) {
                finalCtx.imageSmoothingEnabled = true;
                finalCtx.imageSmoothingQuality = "high";
                finalCtx.drawImage(canvas, 0, 0, currentW, currentH, 0, 0, targetW, targetH);
            }

            finalCanvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error("Canvas toBlob failed"));
                        return;
                    }
                    const resizedFile = new File([blob], file.name, {
                        type: "image/jpeg",
                        lastModified: Date.now(),
                    });
                    resolve(resizedFile);
                },
                "image/jpeg",
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image"));
        };

        img.src = url;
    });
}
