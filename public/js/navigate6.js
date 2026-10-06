const voiceGuidanceBtn = document.getElementById("voiceGuidanceBtn");
const voiceIcon = document.getElementById("voiceIcon");
const voiceText = document.getElementById("voiceText");
 
let voiceGuidanceOn = false;
 
voiceGuidanceBtn.addEventListener("click", async () => {
 
    if (!voiceGuidanceOn) {
 
        try {
 
            const response = await fetch("/start-voice-navigation", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                }
            });
 
            const data = await response.json();
 
            if (data.success) {
 
                voiceGuidanceOn = true;
 
                voiceGuidanceBtn.classList.remove("off");
                voiceGuidanceBtn.classList.add("on");
 
                voiceIcon.className = "fa-solid fa-volume-high";
                voiceText.textContent = "Voice Guidance ON";
 
                console.log(data.message);
            }
 
        } catch (error) {
 
            console.error("Navigation error:", error);
 
            alert("Unable to start voice navigation.");
        }
 
    } else {
 
        voiceGuidanceOn = false;
 
        voiceGuidanceBtn.classList.remove("on");
        voiceGuidanceBtn.classList.add("off");
 
        voiceIcon.className = "fa-solid fa-volume-xmark";
        voiceText.textContent = "Voice Guidance OFF";
    }
});
// ===============================
// YOLO NAVIGATION DATA
// ===============================
 
const FLASK_URL =
    `${window.location.protocol}//${window.location.hostname}:5000`;
 
async function updateNavigationData() {
    try {
        const response = await fetch(
            `${FLASK_URL}/api/navigation_data`
        );
 
        const data = await response.json();
 
        // Closest obstacle
        document.getElementById("obs1-name").textContent =
            data.closest?.name || "None";
 
        document.getElementById("obs1-dist").textContent =
            data.closest?.name
                ? `${data.closest.distance} meters`
                : "0 meters";
 
        // Other objects
        const others = data.others || [];
 
        document.getElementById("obs2-name").textContent =
            others[0]?.name || "None";
 
        document.getElementById("obs2-dist").textContent =
            others[0]
                ? `${others[0].distance} meters`
                : "0 meters";
 
        document.getElementById("obs3-name").textContent =
            others[1]?.name || "None";
 
        document.getElementById("obs3-dist").textContent =
            others[1]
                ? `${others[1].distance} meters`
                : "0 meters";
 
        // Safe path
        document.getElementById("safe-title").textContent =
            data.path || "Path is clear";
 
        document.getElementById("safe-desc").textContent =
            data.description || "No obstacle detected";
 
    } catch (error) {
        console.error("YOLO navigation data error:", error);
    }
}
 
// ===============================
// SEND CAMERA FRAMES TO FLASK (YOLO)
// Pehle camera sirf screen par dikhta tha, frames Flask ko kabhi
// bheje hi nahi jaate the, isliye detection hota hi nahi tha.
// ===============================
 
let navFrameTimer = null;
let navFrameBusy = false;
const navCanvas = document.createElement("canvas");
 
function startNavigationFrameSending(video) {
 
    // Dobara start na ho
    if (navFrameTimer) return;
 
    navFrameTimer = setInterval(async () => {
 
        // Pichla frame abhi process ho raha hai to skip
        if (navFrameBusy) return;
 
        // Video abhi ready nahi
        if (!video.videoWidth) return;
 
        navFrameBusy = true;
 
        try {
 
            const width = 640;
            const height = Math.round(
                video.videoHeight * width / video.videoWidth
            );
 
            navCanvas.width = width;
            navCanvas.height = height;
 
            navCanvas
                .getContext("2d")
                .drawImage(video, 0, 0, width, height);
 
            const blob = await new Promise(resolve =>
                navCanvas.toBlob(resolve, "image/jpeg", 0.7)
            );
 
            if (!blob) return;
 
            const form = new FormData();
            form.append("frame", blob, "frame.jpg");
 
            await fetch(`${FLASK_URL}/api/process_frame`, {
                method: "POST",
                body: form
            });
 
        } catch (error) {
 
            console.error("Frame send error:", error);
 
        } finally {
 
            navFrameBusy = false;
        }
 
    }, 500);
}
 
// ===============================
// CAMERA START
// ===============================
 
async function startNavigationCamera() {
    try {
        // Agar camera already running hai
        if (window.navigationCameraStream) {
            console.log("Camera already running.");
 
            const runningVideo = document.getElementById("navigationCamera");
 
            if (runningVideo) {
                startNavigationFrameSending(runningVideo);
            }
 
            return;
        }
 
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: {
                    ideal: "environment"
                }
            },
            audio: false
        });
 
        window.navigationCameraStream = stream;
 
        // Camera video element
        let video = document.getElementById("navigationCamera");
 
        if (!video) {
            video = document.createElement("video");
            video.id = "navigationCamera";
 
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
 
            Object.assign(video.style, {
                position: "fixed",
                bottom: "20px",
                right: "20px",
                width: "250px",
                height: "180px",
                objectFit: "cover",
                borderRadius: "12px",
                zIndex: "9999",
                background: "#000"
            });
 
            document.body.appendChild(video);
        }
 
        video.srcObject = stream;
 
        // Kuch phones par autoplay apne aap nahi chalta
        try {
            await video.play();
        } catch (playError) {
            console.warn("Video play warning:", playError);
        }
 
        console.log("Navigation camera started.");
 
        // Ab frames Flask ko bhejna shuru karo
        startNavigationFrameSending(video);
 
        // Optional voice confirmation
        const speech = new SpeechSynthesisUtterance(
            "Camera started."
        );
 
        speech.lang = "en-US";
        speech.rate = 0.9;
 
        window.speechSynthesis.speak(speech);
 
    } catch (error) {
        console.error("Camera error:", error);
 
        const speech = new SpeechSynthesisUtterance(
            "Unable to start the camera. Please allow camera permission."
        );
 
        speech.lang = "en-US";
        window.speechSynthesis.speak(speech);
    }
}
 
// Voice assistant (voice_assistance.js) isi naam se function dhoondhta hai.
// Script module ho ya kisi wrapper mein ho, tab bhi ye global rahega.
window.startNavigationCamera = startNavigationCamera;
 
setInterval(updateNavigationData, 500);
 
updateNavigationData();
 