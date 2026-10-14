document.addEventListener("DOMContentLoaded", () => {
 
    const scanBtn = document.getElementById("scanBtn");
    const uploadBtn = document.getElementById("uploadBtn");
 
    const cameraInput = document.getElementById("cameraInput");
    const galleryInput = document.getElementById("galleryInput");
 
    const extractedText = document.getElementById("extractedText");
    const statusMsg = document.getElementById("statusMsg");
 
    const copyBtn = document.getElementById("copyBtn");
 
    const readAloudBtn = document.getElementById("readAloudBtn");
    const readBtnText = document.getElementById("readBtnText");
    const readIcon = document.getElementById("readIcon");
 
    const backBtn = document.getElementById("backBtn");
 
 
    // ============================================
    // CAMERA VARIABLES
    // ============================================
 
    let cameraStream = null;
    let cameraVideo = null;
    let cameraCanvas = null;
 
    let cameraRunning = false;
    let detecting = false;
    let capturing = false;
 
    let detectionTimer = null;
 
    // Number of consecutive good frames
    let detectedCount = 0;
    const REQUIRED_DETECTIONS = 2;
 
    // "Hold still" voice message sirf 1 baar
    let holdMessageGiven = false;
 
    let ocrWorker = null;
    let workerReady = false;
 
 
    // ============================================
    // HELPERS
    // ============================================
 
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
 
 
    // Voice assistant ko sula do / jaga do
    // (taaki mic app ki apni awaaz na sune aur beech mein speech cancel na kare)
    let assistantSleeping = false;
 
    function sleepAssistant(message) {
 
        if (assistantSleeping) return;
 
        assistantSleeping = true;
 
        if (typeof window.startDocumentReading === "function") {
            window.startDocumentReading(message);
        }
    }
 
    function wakeAssistant() {
 
        if (!assistantSleeping) return;
 
        assistantSleeping = false;
 
        if (typeof window.endDocumentReading === "function") {
            window.endDocumentReading();
        }
    }
 
 
    // ============================================
    // INITIAL TEXT
    // ============================================
 
    if (extractedText) {
        extractedText.textContent =
            "Point the camera anywhere at a document. The app will automatically detect readable text.";
    }
 
 
    // ============================================
    // STATUS
    // ============================================
 
    function setStatus(message) {
 
        if (statusMsg) {
            statusMsg.textContent = message;
        }
 
        console.log(message);
    }
 
 
    // ============================================
    // SPEAK (Promise - bolna khatam hone par resolve hota hai)
    // ============================================
 
    function speak(message) {
 
        return new Promise(resolve => {
 
            if (!("speechSynthesis" in window)) {
                resolve();
                return;
            }
 
            window.speechSynthesis.cancel();
 
            const speech = new SpeechSynthesisUtterance(message);
 
            speech.lang = "en-IN";
            speech.rate = 0.9;
            speech.pitch = 1;
 
            let done = false;
 
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(safetyTimer);
                resolve();
            };
 
            // Kabhi kabhi mobile par onend fire nahi hota
            const safetyTimer = setTimeout(
                finish,
                Math.max(2500, message.length * 90 + 1500)
            );
 
            speech.onend = finish;
            speech.onerror = finish;
 
            window.speechSynthesis.speak(speech);
        });
    }
 
 
    // ============================================
    // CREATE CAMERA UI
    // ============================================
 
    function createCameraUI() {
 
        const oldCamera = document.getElementById("automaticCamera");
 
        if (oldCamera) {
            oldCamera.remove();
        }
 
        const cameraBox = document.createElement("div");
 
        cameraBox.id = "automaticCamera";
 
        cameraBox.style.position = "fixed";
        cameraBox.style.inset = "0";
        cameraBox.style.background = "#000";
        cameraBox.style.zIndex = "99999";
 
        cameraBox.style.display = "flex";
        cameraBox.style.flexDirection = "column";
        cameraBox.style.alignItems = "center";
        cameraBox.style.justifyContent = "center";
 
 
        // VIDEO
        cameraVideo = document.createElement("video");
 
        cameraVideo.autoplay = true;
        cameraVideo.playsInline = true;
        cameraVideo.muted = true;
 
        cameraVideo.style.width = "100%";
        cameraVideo.style.height = "100%";
        cameraVideo.style.objectFit = "cover";
 
        cameraBox.appendChild(cameraVideo);
 
 
        // STATUS (top)
        const cameraStatus = document.createElement("div");
 
        cameraStatus.id = "cameraStatus";
        cameraStatus.textContent = "Looking for a document...";
 
        cameraStatus.style.position = "absolute";
        cameraStatus.style.top = "25px";
        cameraStatus.style.left = "20px";
        cameraStatus.style.right = "20px";
 
        cameraStatus.style.padding = "14px";
        cameraStatus.style.borderRadius = "12px";
 
        cameraStatus.style.background = "rgba(0,0,0,0.65)";
        cameraStatus.style.color = "white";
 
        cameraStatus.style.textAlign = "center";
        cameraStatus.style.fontSize = "16px";
        cameraStatus.style.fontWeight = "600";
 
        cameraBox.appendChild(cameraStatus);
 
 
        // BIG HOLD MESSAGE (center)
        const holdBanner = document.createElement("div");
 
        holdBanner.id = "holdBanner";
        holdBanner.style.display = "none";
 
        holdBanner.style.position = "absolute";
        holdBanner.style.top = "50%";
        holdBanner.style.left = "50%";
        holdBanner.style.transform = "translate(-50%, -50%)";
 
        holdBanner.style.padding = "22px 30px";
        holdBanner.style.borderRadius = "20px";
        holdBanner.style.background = "rgba(8,120,63,0.9)";
        holdBanner.style.color = "white";
 
        holdBanner.style.textAlign = "center";
        holdBanner.style.fontSize = "26px";
        holdBanner.style.fontWeight = "700";
        holdBanner.style.lineHeight = "1.4";
 
        cameraBox.appendChild(holdBanner);
 
 
        // CLOSE BUTTON
        const closeButton = document.createElement("button");
 
        closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        closeButton.setAttribute("aria-label", "Close camera");
 
        closeButton.style.position = "absolute";
        closeButton.style.right = "20px";
        closeButton.style.bottom = "30px";
 
        closeButton.style.width = "55px";
        closeButton.style.height = "55px";
 
        closeButton.style.border = "none";
        closeButton.style.borderRadius = "50%";
 
        closeButton.style.background = "white";
        closeButton.style.color = "#08783f";
 
        closeButton.style.fontSize = "22px";
 
        closeButton.onclick = () => {
            closeCamera();
            wakeAssistant();
        };
 
        cameraBox.appendChild(closeButton);
 
        document.body.appendChild(cameraBox);
    }
 
 
    // ============================================
    // CAMERA STATUS + HOLD BANNER
    // ============================================
 
    function updateCameraStatus(message) {
 
        const element = document.getElementById("cameraStatus");
 
        if (element) {
            element.textContent = message;
        }
    }
 
    function showHoldBanner(message) {
 
        const banner = document.getElementById("holdBanner");
 
        if (banner) {
            banner.innerHTML = message;
            banner.style.display = "block";
        }
    }
 
    function hideHoldBanner() {
 
        const banner = document.getElementById("holdBanner");
 
        if (banner) {
            banner.style.display = "none";
        }
    }
 
 
    // ============================================
    // CREATE OCR WORKER
    // ============================================
 
    async function createOCRWorker() {
 
        if (workerReady && ocrWorker) {
            return ocrWorker;
        }
 
        setStatus("Preparing document reader...");
 
        try {
 
            ocrWorker = await Tesseract.createWorker("eng", 1, {
                logger: function (message) {
                    if (message.status === "recognizing text") {
                        console.log(
                            "OCR:",
                            Math.round(message.progress * 100) + "%"
                        );
                    }
                }
            });
 
            // Better OCR settings
            await ocrWorker.setParameters({
                tessedit_pageseg_mode: "6",     // ek block of text. Agar layout alag ho to "3" try karo
                preserve_interword_spaces: "1"
            });
 
            workerReady = true;
 
            console.log("OCR worker ready.");
 
            return ocrWorker;
 
        } catch (error) {
 
            console.error("OCR worker error:", error);
 
            setStatus("Unable to start document reader.");
 
            return null;
        }
    }
 
 
    // ============================================
    // OPEN CAMERA
    // ============================================
 
    async function openCamera() {
 
        if (cameraRunning) {
            return;
        }
 
        createCameraUI();
 
        try {
 
            if (
                !navigator.mediaDevices ||
                !navigator.mediaDevices.getUserMedia
            ) {
                throw new Error("Camera API not supported");
            }
 
            // OPEN REAR CAMERA
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: "environment" },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
 
            cameraVideo.srcObject = cameraStream;
 
            await cameraVideo.play();
 
            cameraRunning = true;
            capturing = false;
            detecting = false;
            detectedCount = 0;
            holdMessageGiven = false;
 
            cameraCanvas = document.createElement("canvas");
 
            updateCameraStatus("Looking for a document...");
            setStatus("Camera opened. Looking for a document...");
 
            // Scan ke dauran assistant so jaye
            sleepAssistant("🔇 Scanning document. Assistant paused.");
 
            speak("Camera opened. Looking for a document.");
 
            startAutomaticDetection();
 
        } catch (error) {
 
            console.error("Camera error:", error);
 
            setStatus("Camera could not be opened.");
 
            closeCamera();
            wakeAssistant();
 
            speak("Camera could not be opened.");
        }
    }
 
 
    // ============================================
    // START AUTOMATIC DETECTION
    // ============================================
 
    function startAutomaticDetection() {
 
        if (!cameraRunning) {
            return;
        }
 
        // First detection immediately
        detectTextInCamera();
 
        // Then every 1.2 seconds
        detectionTimer = setInterval(detectTextInCamera, 1200);
    }
 
 
    // ============================================
    // CHECK IMAGE SHARPNESS
    // ============================================
 
    function calculateSharpness(canvas) {
 
        try {
 
            const ctx = canvas.getContext("2d");
 
            const imageData = ctx.getImageData(
                0, 0, canvas.width, canvas.height
            );
 
            const data = imageData.data;
 
            let totalDifference = 0;
            let count = 0;
 
            for (let y = 0; y < canvas.height; y += 4) {
 
                for (let x = 0; x < canvas.width - 4; x += 4) {
 
                    const i = (y * canvas.width + x) * 4;
                    const j = (y * canvas.width + x + 4) * 4;
 
                    const current = (data[i] + data[i + 1] + data[i + 2]) / 3;
                    const next = (data[j] + data[j + 1] + data[j + 2]) / 3;
 
                    totalDifference += Math.abs(current - next);
                    count++;
                }
            }
 
            if (count === 0) {
                return 0;
            }
 
            return totalDifference / count;
 
        } catch (error) {
 
            console.error("Sharpness error:", error);
 
            return 0;
        }
    }
 
 
    // ============================================
    // AUTOMATIC TEXT DETECTION
    // ============================================
 
    async function detectTextInCamera() {
 
        if (!cameraRunning) return;
        if (detecting) return;
        if (capturing) return;
 
        if (!cameraVideo || cameraVideo.readyState < 2) {
            return;
        }
 
        detecting = true;
 
        try {
 
            const videoWidth = cameraVideo.videoWidth;
            const videoHeight = cameraVideo.videoHeight;
 
            if (!videoWidth || !videoHeight) {
                return;
            }
 
            // SMALL FRAME
            const maxWidth = 640;
            const scale = Math.min(1, maxWidth / videoWidth);
 
            cameraCanvas.width = Math.round(videoWidth * scale);
            cameraCanvas.height = Math.round(videoHeight * scale);
 
            const ctx = cameraCanvas.getContext("2d", {
                willReadFrequently: true
            });
 
            ctx.drawImage(
                cameraVideo, 0, 0,
                cameraCanvas.width, cameraCanvas.height
            );
 
            // SHARPNESS CHECK
            const sharpness = calculateSharpness(cameraCanvas);
 
            console.log("Sharpness:", sharpness.toFixed(2));
 
            if (sharpness < 8) {
 
                detectedCount = 0;
                holdMessageGiven = false;
 
                hideHoldBanner();
                updateCameraStatus("Image is blurry. Move camera slowly...");
 
                return;
            }
 
            // OCR (sirf detection ke liye)
            const worker = await createOCRWorker();
 
            if (!worker) {
                return;
            }
 
            const result = await worker.recognize(cameraCanvas);
 
            const text = result.data.text || "";
            const confidence = Number(result.data.confidence || 0);
 
            const cleanedText = text.replace(/\s+/g, " ").trim();
 
            const words = cleanedText
                .split(/\s+/)
                .filter(word => word.length >= 2);
 
            const wordCount = words.length;
 
            console.log("--------------------------------");
            console.log("OCR text:", cleanedText);
            console.log("Words:", wordCount);
            console.log("Confidence:", confidence);
 
            // SMART DOCUMENT CHECK
            const documentCandidate =
                cleanedText.length >= 20 &&
                wordCount >= 3 &&
                confidence >= 30;
 
 
            // ====================================
            // DOCUMENT FOUND
            // ====================================
 
            if (documentCandidate) {
 
                detectedCount++;
 
                // Pehli achhi detection par hi instruction (sirf 1 baar)
                if (!holdMessageGiven) {
 
                    holdMessageGiven = true;
 
                    speak("Document detected. Hold still. Do not move.");
                }
 
                updateCameraStatus("Document detected");
                showHoldBanner("✋ Hold still<br>Do not move");
 
                console.log(
                    "Good document frame:",
                    detectedCount, "/", REQUIRED_DETECTIONS
                );
 
                // STABLE DOCUMENT
                if (detectedCount >= REQUIRED_DETECTIONS) {
 
                    capturing = true;
 
                    // detection band, ab sirf capture
                    if (detectionTimer) {
                        clearInterval(detectionTimer);
                        detectionTimer = null;
                    }
 
                    // Countdown
                    for (let i = 3; i >= 1; i--) {
 
                        if (!cameraRunning) {
                            return;
                        }
 
                        showHoldBanner("✋ Hold still<br>Do not move<br>" + i);
                        updateCameraStatus("Hold still... " + i);
 
                        await wait(800);
                    }
 
                    if (!cameraRunning) {
                        return;
                    }
 
                    showHoldBanner("📸 Capturing...");
                    updateCameraStatus("Capturing...");
 
                    await captureHighQualityImage();
                }
 
            } else {
 
                // Not a document
                detectedCount = 0;
                holdMessageGiven = false;
 
                hideHoldBanner();
                updateCameraStatus("Looking for a document...");
            }
 
        } catch (error) {
 
            console.error("Detection error:", error);
 
        } finally {
 
            detecting = false;
        }
    }
 
 
    // ============================================
    // CAPTURE HIGH QUALITY IMAGE
    // ============================================
 
    function captureHighQualityImage() {
 
        return new Promise(resolve => {
 
            if (!cameraRunning) {
                resolve();
                return;
            }
 
            try {
 
                const width = cameraVideo.videoWidth;
                const height = cameraVideo.videoHeight;
 
                if (!width || !height) {
                    capturing = false;
                    resolve();
                    return;
                }
 
                const canvas = document.createElement("canvas");
 
                canvas.width = width;
                canvas.height = height;
 
                const ctx = canvas.getContext("2d");
 
                ctx.drawImage(cameraVideo, 0, 0, width, height);
 
                canvas.toBlob(
                    async function (blob) {
 
                        if (!blob) {
 
                            capturing = false;
 
                            setStatus("Could not capture image.");
 
                            resolve();
                            return;
                        }
 
                        // Stop camera
                        closeCamera();
 
                        // OCR final image
                        await processImage(blob);
 
                        resolve();
                    },
                    "image/jpeg",
                    0.95
                );
 
            } catch (error) {
 
                console.error("Capture error:", error);
 
                capturing = false;
 
                closeCamera();
                wakeAssistant();
 
                setStatus("Could not capture document.");
 
                resolve();
            }
        });
    }
 
 
    // ============================================
    // IMAGE CLEAN (OCR se pehle)
    // ============================================
 
    async function preprocessImage(file) {
 
        const bitmap = await createImageBitmap(file);
 
        // OCR ke liye ~1800px width achhi rehti hai
        const targetWidth = 1800;
        const scale = targetWidth / bitmap.width;
 
        const canvas = document.createElement("canvas");
 
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
 
        const ctx = canvas.getContext("2d", {
            willReadFrequently: true
        });
 
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
 
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = img.data;
 
        // Grayscale + contrast
        const contrast = 1.6;
 
        for (let i = 0; i < d.length; i += 4) {
 
            let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
 
            gray = (gray - 128) * contrast + 128;
            gray = Math.max(0, Math.min(255, gray));
 
            d[i] = d[i + 1] = d[i + 2] = gray;
        }
 
        ctx.putImageData(img, 0, 0);
 
        return canvas;
    }
 
 
    // ============================================
    // TEXT CLEAN (OCR ke baad)
    // ============================================
 
    // Tesseract ke alag versions mein lines alag jagah hoti hain
    function getOcrLines(data) {
 
        if (data.lines && data.lines.length) {
            return data.lines;
        }
 
        const lines = [];
 
        (data.blocks || []).forEach(block => {
            (block.paragraphs || []).forEach(paragraph => {
                (paragraph.lines || []).forEach(line => lines.push(line));
            });
        });
 
        return lines;
    }
 
    function buildCleanText(data) {
 
        const MIN_WORD_CONFIDENCE = 60;   // kachra zyada aaye to 70, words kat rahe hon to 50
 
        const ocrLines = getOcrLines(data);
 
        let lines = [];
 
        if (ocrLines.length) {
 
            ocrLines.forEach(line => {
 
                const goodWords = (line.words || [])
                    .filter(w => w.confidence >= MIN_WORD_CONFIDENCE)
                    .map(w => w.text);
 
                if (goodWords.length) {
                    lines.push(goodWords.join(" "));
                }
            });
 
        } else {
 
            lines = (data.text || "").split("\n");
        }
 
        return lines
            .map(line =>
                line
                    // sirf letters, numbers aur normal punctuation rakho
                    .replace(/[^\p{L}\p{N}\s.,:;?!'"()\-\/%@&]/gu, "")
                    .replace(/\s+/g, " ")
                    .trim()
            )
            .filter(line => {
 
                if (line.length < 3) return false;
 
                // jis line mein letters/numbers bahut kam hon wo kachra hai
                const good = (line.match(/[\p{L}\p{N}]/gu) || []).length;
 
                return good / line.length >= 0.6;
            })
            .join("\n");
    }
 
 
    // ============================================
    // PROCESS IMAGE WITH OCR
    // ============================================
 
    async function processImage(file) {
 
        setStatus("Reading document...");
 
        if (extractedText) {
            extractedText.textContent = "Reading document...";
        }
 
        // Jab tak processing + bolna chal raha hai assistant so raha hai
        sleepAssistant("🔇 Reading document. Assistant paused.");
 
        try {
 
            const worker = await createOCRWorker();
 
            if (!worker) {
                throw new Error("OCR worker not available");
            }
 
            // Image clean karo
            const cleanImage = await preprocessImage(file);
 
            // blocks:true -> naye Tesseract.js version mein lines milti hain
            const result = await worker.recognize(
                cleanImage,
                {},
                { blocks: true }
            );
 
            const text = buildCleanText(result.data);
 
            console.log("Final OCR:", text);
 
 
            // NO TEXT
            if (text.length < 5) {
 
                if (extractedText) {
                    extractedText.textContent =
                        "No readable text was found. Please try again.";
                }
 
                setStatus("No readable text found.");
 
                await speak("I could not read the document. Please try again.");
 
                return;
            }
 
 
            // SHOW TEXT
            if (extractedText) {
                extractedText.textContent = text;
            }
 
            setStatus("Document uploaded successfully.");
 
            // Bolna khatam hone tak assistant so raha hai
            await speak("Document ready. Say, read the document.");
 
            // Mic ab turant start hoga (finally mein wakeAssistant)
            setStatus("🎤 Say: read the document");
 
        } catch (error) {
 
            console.error("OCR error:", error);
 
            if (extractedText) {
                extractedText.textContent = "Unable to read the document.";
            }
 
            setStatus("Document reading failed.");
 
            await speak("I was unable to read the document. Please try again.");
 
        } finally {
 
            capturing = false;
 
            // Assistant jaag jaye, mic turant sunega
            wakeAssistant();
        }
    }
 
 
    // ============================================
    // CLOSE CAMERA
    // ============================================
 
    function closeCamera() {
 
        cameraRunning = false;
        detecting = false;
        capturing = false;
 
        detectedCount = 0;
        holdMessageGiven = false;
 
        if (detectionTimer) {
            clearInterval(detectionTimer);
            detectionTimer = null;
        }
 
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
 
        if (cameraVideo) {
            cameraVideo.srcObject = null;
        }
 
        const cameraBox = document.getElementById("automaticCamera");
 
        if (cameraBox) {
            cameraBox.remove();
        }
    }
 
 
    // ============================================
    // SCAN BUTTON
    // ============================================
 
    if (scanBtn) {
        scanBtn.addEventListener("click", openCamera);
    }
 
 
    // ============================================
    // GALLERY
    // ============================================
 
    if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
            if (galleryInput) {
                galleryInput.click();
            }
        });
    }
 
    if (galleryInput) {
        galleryInput.addEventListener("change", async event => {
 
            const file = event.target.files[0];
 
            if (!file) {
                return;
            }
 
            await processImage(file);
 
            galleryInput.value = "";
        });
    }
 
 
    // ============================================
    // CAMERA INPUT
    // ============================================
 
    if (cameraInput) {
        cameraInput.addEventListener("change", async event => {
 
            const file = event.target.files[0];
 
            if (!file) {
                return;
            }
 
            await processImage(file);
 
            cameraInput.value = "";
        });
    }
 
 
    // ============================================
    // COPY TEXT
    // ============================================
 
    if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
 
            const text = extractedText.innerText.trim();
 
            if (!text) {
                return;
            }
 
            try {
 
                await navigator.clipboard.writeText(text);
 
                setStatus("Text copied successfully.");
 
            } catch (error) {
 
                console.error("Copy error:", error);
            }
        });
    }
 
 
    // ============================================
    // READ ALOUD
    // ============================================
 
    if (readAloudBtn) {
 
        readAloudBtn.addEventListener("click", () => {
 
            const text = extractedText.innerText.trim();
 
            // NO DOCUMENT
            if (!text || text === "Reading document...") {
 
                speak("There is no document to read.");
 
                return;
            }
 
            // STOP CURRENT SPEECH
            window.speechSynthesis.cancel();
 
            // PUT VOICE ASSISTANT TO SLEEP
            if (typeof window.startDocumentReading === "function") {
                window.startDocumentReading();
            }
 
            const speech = new SpeechSynthesisUtterance(text);
 
            speech.lang = "en-IN";
            speech.rate = 0.85;
            speech.pitch = 1;
 
            speech.onstart = () => {
 
                console.log("🔊 Document reading started.");
 
                if (readBtnText) {
                    readBtnText.textContent = "Reading...";
                }
 
                if (readIcon) {
                    readIcon.className = "fa-solid fa-stop";
                }
            };
 
            const finishReading = () => {
 
                if (readBtnText) {
                    readBtnText.textContent = "Read Aloud";
                }
 
                if (readIcon) {
                    readIcon.className = "fa-solid fa-volume-high";
                }
 
                // WAKE VOICE ASSISTANT
                if (typeof window.endDocumentReading === "function") {
                    window.endDocumentReading();
                }
            };
 
            speech.onend = () => {
                console.log("🔊 Document reading finished.");
                finishReading();
            };
 
            speech.onerror = () => {
                console.log("🔊 Document reading error.");
                finishReading();
            };
 
            window.speechSynthesis.speak(speech);
        });
    }
 
 
    // ============================================
    // BACK BUTTON
    // ============================================
 
    if (backBtn) {
        backBtn.addEventListener("click", () => {
 
            closeCamera();
 
            window.history.back();
        });
    }
 
 
    // ============================================
    // AUTOMATIC CAMERA FROM VOICE ASSISTANT
    // ============================================
 
    const params = new URLSearchParams(window.location.search);
 
    const shouldOpenCamera = params.get("camera") === "true";
 
    if (shouldOpenCamera) {
        setTimeout(() => {
            openCamera();
        }, 700);
    }
 
 
    // ============================================
    // CLEANUP
    // ============================================
 
    window.addEventListener("beforeunload", () => {
 
        closeCamera();
 
        if (ocrWorker) {
            ocrWorker.terminate().catch(() => {});
        }
    });
 
});