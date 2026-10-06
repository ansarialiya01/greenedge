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

    let ocrWorker = null;
    let workerReady = false;


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
    // SPEAK
    // ============================================

    function speak(message) {

        if (!("speechSynthesis" in window)) {
            return;
        }

        window.speechSynthesis.cancel();

        const speech =
            new SpeechSynthesisUtterance(message);

        speech.lang = "en-IN";
        speech.rate = 0.9;
        speech.pitch = 1;

        window.speechSynthesis.speak(speech);
    }


    // ============================================
    // CREATE CAMERA UI
    // ============================================

    function createCameraUI() {

        const oldCamera =
            document.getElementById("automaticCamera");

        if (oldCamera) {
            oldCamera.remove();
        }


        const cameraBox =
            document.createElement("div");

        cameraBox.id = "automaticCamera";

        cameraBox.style.position = "fixed";
        cameraBox.style.inset = "0";
        cameraBox.style.background = "#000";
        cameraBox.style.zIndex = "99999";

        cameraBox.style.display = "flex";
        cameraBox.style.flexDirection = "column";
        cameraBox.style.alignItems = "center";
        cameraBox.style.justifyContent = "center";


        // ========================================
        // VIDEO
        // ========================================

        cameraVideo =
            document.createElement("video");

        cameraVideo.autoplay = true;
        cameraVideo.playsInline = true;
        cameraVideo.muted = true;

        cameraVideo.style.width = "100%";
        cameraVideo.style.height = "100%";
        cameraVideo.style.objectFit = "cover";

        cameraBox.appendChild(cameraVideo);


        // ========================================
        // STATUS
        // ========================================

        const cameraStatus =
            document.createElement("div");

        cameraStatus.id = "cameraStatus";

        cameraStatus.textContent =
            "Looking for a document...";

        cameraStatus.style.position = "absolute";
        cameraStatus.style.top = "25px";
        cameraStatus.style.left = "20px";
        cameraStatus.style.right = "20px";

        cameraStatus.style.padding = "14px";
        cameraStatus.style.borderRadius = "12px";

        cameraStatus.style.background =
            "rgba(0,0,0,0.65)";

        cameraStatus.style.color = "white";

        cameraStatus.style.textAlign = "center";
        cameraStatus.style.fontSize = "16px";
        cameraStatus.style.fontWeight = "600";

        cameraBox.appendChild(cameraStatus);


        // ========================================
        // CLOSE BUTTON
        // ========================================

        const closeButton =
            document.createElement("button");

        closeButton.innerHTML =
            '<i class="fa-solid fa-xmark"></i>';

        closeButton.setAttribute(
            "aria-label",
            "Close camera"
        );

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

        closeButton.onclick = closeCamera;

        cameraBox.appendChild(closeButton);


        document.body.appendChild(cameraBox);
    }


    // ============================================
    // CAMERA STATUS
    // ============================================

    function updateCameraStatus(message) {

        const element =
            document.getElementById("cameraStatus");

        if (element) {
            element.textContent = message;
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

            ocrWorker =
                await Tesseract.createWorker(
                    "eng",
                    1,
                    {
                        logger: function (message) {

                            if (
                                message.status ===
                                "recognizing text"
                            ) {

                                console.log(
                                    "OCR:",
                                    Math.round(
                                        message.progress * 100
                                    ) + "%"
                                );
                            }
                        }
                    }
                );


            workerReady = true;

            console.log("OCR worker ready.");

            return ocrWorker;

        } catch (error) {

            console.error(
                "OCR worker error:",
                error
            );

            setStatus(
                "Unable to start document reader."
            );

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

                throw new Error(
                    "Camera API not supported"
                );
            }


            // ====================================
            // OPEN REAR CAMERA
            // ====================================

            cameraStream =
                await navigator.mediaDevices.getUserMedia({

                    video: {

                        facingMode: {
                            ideal: "environment"
                        },

                        width: {
                            ideal: 1280
                        },

                        height: {
                            ideal: 720
                        }
                    },

                    audio: false
                });


            cameraVideo.srcObject =
                cameraStream;

            await cameraVideo.play();


            cameraRunning = true;
            capturing = false;
            detecting = false;
            detectedCount = 0;


            // ====================================
            // CANVAS
            // ====================================

            cameraCanvas =
                document.createElement("canvas");


            updateCameraStatus(
                "Looking for a document..."
            );


            setStatus(
                "Camera opened. Looking for a document..."
            );


            speak(
                "Camera opened. Looking for a document."
            );


            // ====================================
            // START DETECTION
            // ====================================

            startAutomaticDetection();

        } catch (error) {

            console.error(
                "Camera error:",
                error
            );

            setStatus(
                "Camera could not be opened."
            );

            speak(
                "Camera could not be opened."
            );

            closeCamera();
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
        detectionTimer =
            setInterval(
                detectTextInCamera,
                1200
            );
    }


    // ============================================
    // CHECK IMAGE SHARPNESS
    // ============================================

    function calculateSharpness(canvas) {

        try {

            const ctx =
                canvas.getContext("2d");

            const imageData =
                ctx.getImageData(
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

            const data =
                imageData.data;


            let totalDifference = 0;
            let count = 0;


            // Check horizontal pixel differences
            for (
                let y = 0;
                y < canvas.height;
                y += 4
            ) {

                for (
                    let x = 0;
                    x < canvas.width - 4;
                    x += 4
                ) {

                    const current =
                        (
                            data[
                                (y * canvas.width + x) * 4
                            ] +
                            data[
                                (y * canvas.width + x) * 4 + 1
                            ] +
                            data[
                                (y * canvas.width + x) * 4 + 2
                            ]
                        ) / 3;


                    const next =
                        (
                            data[
                                (y * canvas.width + x + 4) * 4
                            ] +
                            data[
                                (y * canvas.width + x + 4) * 4 + 1
                            ] +
                            data[
                                (y * canvas.width + x + 4) * 4 + 2
                            ]
                        ) / 3;


                    totalDifference +=
                        Math.abs(current - next);

                    count++;
                }
            }


            if (count === 0) {
                return 0;
            }


            return totalDifference / count;

        } catch (error) {

            console.error(
                "Sharpness error:",
                error
            );

            return 0;
        }
    }


    // ============================================
    // AUTOMATIC TEXT DETECTION
    // ============================================

    async function detectTextInCamera() {

        if (!cameraRunning) {
            return;
        }

        if (detecting) {
            return;
        }

        if (capturing) {
            return;
        }

        if (
            !cameraVideo ||
            cameraVideo.readyState < 2
        ) {
            return;
        }


        detecting = true;


        try {

            const videoWidth =
                cameraVideo.videoWidth;

            const videoHeight =
                cameraVideo.videoHeight;


            if (
                !videoWidth ||
                !videoHeight
            ) {

                detecting = false;
                return;
            }


            // ====================================
            // SMALL FRAME
            // ====================================

            const maxWidth = 640;

            const scale =
                Math.min(
                    1,
                    maxWidth / videoWidth
                );


            cameraCanvas.width =
                Math.round(
                    videoWidth * scale
                );

            cameraCanvas.height =
                Math.round(
                    videoHeight * scale
                );


            const ctx =
                cameraCanvas.getContext("2d", {
                    willReadFrequently: true
                });


            ctx.drawImage(
                cameraVideo,
                0,
                0,
                cameraCanvas.width,
                cameraCanvas.height
            );


            // ====================================
            // SHARPNESS CHECK
            // ====================================

            const sharpness =
                calculateSharpness(
                    cameraCanvas
                );


            console.log(
                "Sharpness:",
                sharpness.toFixed(2)
            );


            // Very blurry frame
            if (sharpness < 8) {

                detectedCount = 0;

                updateCameraStatus(
                    "Image is blurry. Move camera slowly..."
                );

                detecting = false;

                return;
            }


            // ====================================
            // OCR
            // ====================================

            const worker =
                await createOCRWorker();


            if (!worker) {

                detecting = false;
                return;
            }


            const result =
                await worker.recognize(
                    cameraCanvas
                );


            const text =
                result.data.text || "";


            const confidence =
                Number(
                    result.data.confidence || 0
                );


            const cleanedText =
                text
                    .replace(/\s+/g, " ")
                    .trim();


            const words =
                cleanedText
                    .split(/\s+/)
                    .filter(
                        word =>
                            word.length >= 2
                    );


            const wordCount =
                words.length;


            console.log(
                "--------------------------------"
            );

            console.log(
                "OCR text:",
                cleanedText
            );

            console.log(
                "Words:",
                wordCount
            );

            console.log(
                "Confidence:",
                confidence
            );


            // ====================================
            // SMART DOCUMENT CHECK
            // ====================================

            /*
                We don't need to detect the
                document edges.

                We check whether the camera
                sees enough readable text.
            */


            const enoughCharacters =
                cleanedText.length >= 20;


            const enoughWords =
                wordCount >= 3;


            const goodConfidence =
                confidence >= 30;


            const documentCandidate =
                (
                    enoughCharacters &&
                    enoughWords &&
                    goodConfidence
                );


            // ====================================
            // DOCUMENT FOUND
            // ====================================

            if (documentCandidate) {

                detectedCount++;


                updateCameraStatus(
                    "Document detected. Hold still..."
                );


                console.log(
                    "Good document frame:",
                    detectedCount,
                    "/",
                    REQUIRED_DETECTIONS
                );


                // =================================
                // STABLE DOCUMENT
                // =================================

                if (
                    detectedCount >=
                    REQUIRED_DETECTIONS
                ) {

                    capturing = true;


                    updateCameraStatus(
                        "Document detected. Capturing..."
                    );


                    speak(
                        "Document detected. Capturing."
                    );


                    // Give camera a small moment
                    // to become stable

                    setTimeout(
                        captureHighQualityImage,
                        600
                    );
                }

            } else {

                // Not a document
                detectedCount = 0;


                updateCameraStatus(
                    "Looking for a document..."
                );
            }


        } catch (error) {

            console.error(
                "Detection error:",
                error
            );

        } finally {

            detecting = false;
        }
    }


    // ============================================
    // CAPTURE HIGH QUALITY IMAGE
    // ============================================

    async function captureHighQualityImage() {

        if (!cameraRunning) {
            return;
        }


        try {

            const width =
                cameraVideo.videoWidth;

            const height =
                cameraVideo.videoHeight;


            if (
                !width ||
                !height
            ) {

                capturing = false;
                return;
            }


            // ====================================
            // FULL QUALITY CANVAS
            // ====================================

            const canvas =
                document.createElement("canvas");


            canvas.width = width;
            canvas.height = height;


            const ctx =
                canvas.getContext("2d");


            ctx.drawImage(
                cameraVideo,
                0,
                0,
                width,
                height
            );


            // ====================================
            // CREATE IMAGE
            // ====================================

            canvas.toBlob(

                async function (blob) {

                    if (!blob) {

                        capturing = false;

                        setStatus(
                            "Could not capture image."
                        );

                        return;
                    }


                    // Stop camera
                    closeCamera();


                    // OCR final image
                    await processImage(blob);
                },

                "image/jpeg",

                0.95
            );


        } catch (error) {

            console.error(
                "Capture error:",
                error
            );


            capturing = false;

            closeCamera();


            setStatus(
                "Could not capture document."
            );
        }
    }


    // ============================================
    // PROCESS IMAGE WITH OCR
    // ============================================

    async function processImage(file) {

        setStatus(
            "Reading document..."
        );


        if (extractedText) {

            extractedText.textContent =
                "Reading document...";
        }


        speak(
            "Reading the document."
        );


        try {

            const worker =
                await createOCRWorker();


            if (!worker) {

                throw new Error(
                    "OCR worker not available"
                );
            }


            // ====================================
            // HIGH QUALITY OCR
            // ====================================

            const result =
                await worker.recognize(
                    file
                );


            let text =
                result.data.text || "";


            text =
                text
                    .replace(/\r/g, "")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim();


            console.log(
                "Final OCR:",
                text
            );


            // ====================================
            // NO TEXT
            // ====================================

            if (text.length < 5) {

                if (extractedText) {

                    extractedText.textContent =
                        "No readable text was found. Please try again.";
                }


                setStatus(
                    "No readable text found."
                );


                speak(
                    "I could not read the document. Please try again."
                );


                capturing = false;

                return;
            }


            // ====================================
            // SHOW TEXT
            // ====================================

            if (extractedText) {

                extractedText.textContent =
                    text;
            }


            setStatus(
                "Document uploaded successfully."
            );


            // ====================================
            // IMPORTANT VOICE MESSAGE
            // ====================================

            speak(
                "Document uploaded successfully. You can say, read the document."
            );


        } catch (error) {

            console.error(
                "OCR error:",
                error
            );


            if (extractedText) {

                extractedText.textContent =
                    "Unable to read the document.";
            }


            setStatus(
                "Document reading failed."
            );


            speak(
                "I was unable to read the document. Please try again."
            );


        } finally {

            capturing = false;
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


        if (detectionTimer) {

            clearInterval(
                detectionTimer
            );

            detectionTimer = null;
        }


        if (cameraStream) {

            cameraStream
                .getTracks()
                .forEach(track => {
                    track.stop();
                });

            cameraStream = null;
        }


        if (cameraVideo) {

            cameraVideo.srcObject = null;
        }


        const cameraBox =
            document.getElementById(
                "automaticCamera"
            );


        if (cameraBox) {

            cameraBox.remove();
        }
    }


    // ============================================
    // SCAN BUTTON
    // ============================================

    if (scanBtn) {

        scanBtn.addEventListener(
            "click",
            openCamera
        );
    }


    // ============================================
    // GALLERY
    // ============================================

    if (uploadBtn) {

        uploadBtn.addEventListener(
            "click",
            () => {

                if (galleryInput) {
                    galleryInput.click();
                }
            }
        );
    }


    if (galleryInput) {

        galleryInput.addEventListener(
            "change",
            async event => {

                const file =
                    event.target.files[0];


                if (!file) {
                    return;
                }


                await processImage(file);


                galleryInput.value = "";
            }
        );
    }


    // ============================================
    // CAMERA INPUT
    // ============================================

    if (cameraInput) {

        cameraInput.addEventListener(
            "change",
            async event => {

                const file =
                    event.target.files[0];


                if (!file) {
                    return;
                }


                await processImage(file);


                cameraInput.value = "";
            }
        );
    }


    // ============================================
    // COPY TEXT
    // ============================================

    if (copyBtn) {

        copyBtn.addEventListener(
            "click",
            async () => {

                const text =
                    extractedText.innerText.trim();


                if (!text) {
                    return;
                }


                try {

                    await navigator.clipboard.writeText(
                        text
                    );


                    setStatus(
                        "Text copied successfully."
                    );

                } catch (error) {

                    console.error(
                        "Copy error:",
                        error
                    );
                }
            }
        );
    }


    // ============================================
    // READ ALOUD
    // ============================================

    if (readAloudBtn) {

    readAloudBtn.addEventListener(
        "click",
        () => {

            const text =
                extractedText.innerText.trim();


            // ========================================
            // NO DOCUMENT
            // ========================================

            if (
                !text ||
                text === "Reading document..."
            ) {

                speak(
                    "There is no document to read."
                );

                return;
            }


            // ========================================
            // STOP CURRENT SPEECH
            // ========================================

            window.speechSynthesis.cancel();


            // ========================================
            // PUT VOICE ASSISTANT TO SLEEP
            // ========================================

            if (
                typeof window.startDocumentReading ===
                "function"
            ) {

                window.startDocumentReading();
            }


            // ========================================
            // CREATE SPEECH
            // ========================================

            const speech =
                new SpeechSynthesisUtterance(
                    text
                );


            speech.lang = "en-IN";
            speech.rate = 0.85;
            speech.pitch = 1;


            // ========================================
            // READING STARTED
            // ========================================

            speech.onstart = () => {

                console.log(
                    "🔊 Document reading started."
                );


                if (readBtnText) {

                    readBtnText.textContent =
                        "Reading...";
                }


                if (readIcon) {

                    readIcon.className =
                        "fa-solid fa-stop";
                }
            };


            // ========================================
            // READING FINISHED
            // ========================================

            speech.onend = () => {

                console.log(
                    "🔊 Document reading finished."
                );


                if (readBtnText) {

                    readBtnText.textContent =
                        "Read Aloud";
                }


                if (readIcon) {

                    readIcon.className =
                        "fa-solid fa-volume-high";
                }


                // ====================================
                // WAKE VOICE ASSISTANT
                // ====================================

                if (
                    typeof window.endDocumentReading ===
                    "function"
                ) {

                    window.endDocumentReading();
                }
            };


            // ========================================
            // IF SPEECH ERROR
            // ========================================

            speech.onerror = () => {

                console.log(
                    "🔊 Document reading error."
                );


                if (readBtnText) {

                    readBtnText.textContent =
                        "Read Aloud";
                }


                if (readIcon) {

                    readIcon.className =
                        "fa-solid fa-volume-high";
                }


                // Wake assistant even if error occurs
                if (
                    typeof window.endDocumentReading ===
                    "function"
                ) {

                    window.endDocumentReading();
                }
            };


            // ========================================
            // START READING
            // ========================================

            window.speechSynthesis.speak(
                speech
            );

        }
    );
}


    // ============================================
    // BACK BUTTON
    // ============================================

    if (backBtn) {

        backBtn.addEventListener(
            "click",
            () => {

                closeCamera();

                window.history.back();
            }
        );
    }


    // ============================================
    // AUTOMATIC CAMERA FROM VOICE ASSISTANT
    // ============================================

    const params =
        new URLSearchParams(
            window.location.search
        );


    const shouldOpenCamera =
        params.get("camera") === "true";


    if (shouldOpenCamera) {

        setTimeout(
            () => {

                openCamera();

            },
            700
        );
    }


    // ============================================
    // CLEANUP
    // ============================================

    window.addEventListener(
        "beforeunload",
        () => {

            closeCamera();


            if (ocrWorker) {

                ocrWorker
                    .terminate()
                    .catch(() => {});
            }
        }
    );

});