const backBtn = document.getElementById("backBtn");
const callBtn = document.getElementById("callBtn");
const contactName = document.getElementById("contactName");
const contactPhone = document.getElementById("contactPhone");
const refreshBtn = document.getElementById("refreshBtn");
const coordinatesText = document.getElementById("coordinatesText");
const sosBtn = document.getElementById("sosBtn");
const instructionText = document.getElementById("sosInstructionText");
 
let holdTimer = null;
let countdownInterval = null;
 
let audioCtx = null;
let sirenInterval = null;
 
let isSosActive = false;
 
// Dono emergency contacts: [{ name, phone }]
let emergencyContacts = [];
 
// Live tracking state
const TRACKING_INTERVAL_MS = 5000;
let trackingToken = null;
let trackingTimer = null;
let watchId = null;
let wakeLock = null;
let latestPosition = null;
 
 
// ==========================================
// CURRENT LOCATION
// ==========================================
 
let currentLatitude = null;
let currentLongitude = null;
 
 
function escapeHTML(text) {
 
    return String(text).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}
 
 
// ==========================================
// GET REAL GPS LOCATION
// ==========================================
 
function getCurrentLocation() {
 
    return new Promise((resolve, reject) => {
 
        if (!navigator.geolocation) {
 
            reject(
                new Error("Geolocation is not supported by this browser.")
            );
 
            return;
        }
 
        navigator.geolocation.getCurrentPosition(
 
            (position) => {
 
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;
 
                currentLatitude = latitude;
                currentLongitude = longitude;
 
                coordinatesText.innerText =
                    `${latitude.toFixed(6)}° N, ${longitude.toFixed(6)}° E`;
 
                resolve({ latitude, longitude });
            },
 
            (error) => {
 
                console.error("GPS Error:", error);
 
                let message = "Unable to get your location.";
 
                if (error.code === 1) message = "Location permission was denied.";
                if (error.code === 2) message = "Your location is currently unavailable.";
                if (error.code === 3) message = "Location request timed out.";
 
                reject(new Error(message));
            },
 
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}
 
 
// Fresh GPS na mile (jaise indoors) to pichli known location use hoti hai
async function getLocationForSOS() {
 
    try {
 
        return await getCurrentLocation();
 
    } catch (error) {
 
        if (currentLatitude !== null && currentLongitude !== null) {
 
            return {
                latitude: currentLatitude,
                longitude: currentLongitude
            };
        }
 
        throw error;
    }
}
 
 
// Dono contacts ke call buttons (SOS ke baad dikhte hain)
function callButtonsHTML() {
 
    if (emergencyContacts.length === 0) return "";
 
    const buttons = emergencyContacts.map((c) => `
        <a href="tel:+${escapeHTML(c.phone)}" style="
            display:inline-block; background:#16a34a; color:#fff;
            padding:12px 20px; border-radius:30px; margin:4px;
            text-decoration:none; font-weight:700;">
            📞 Call ${escapeHTML(c.name || "Contact")}
        </a>`).join("");
 
    return `<br><br>${buttons}`;
}
 
 
// ==========================================
// LIVE TRACKING (SOS ke baad location bhejta rehta hai)
// ==========================================
 
async function sendTrackingUpdate() {
 
    if (!trackingToken || !latestPosition) return;
 
    try {
 
        await fetch("/api/sos/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: trackingToken,
                latitude: latestPosition.latitude,
                longitude: latestPosition.longitude
            })
        });
 
    } catch (error) {
 
        console.warn("Tracking update failed:", error.message);
    }
}
 
 
async function keepScreenAwake() {
 
    try {
 
        if ("wakeLock" in navigator) {
            wakeLock = await navigator.wakeLock.request("screen");
        }
 
    } catch (error) {
 
        console.warn("Wake lock not available:", error.message);
    }
}
 
 
function startLiveTracking(token, firstLocation) {
 
    stopLiveTracking(false);
 
    trackingToken = token;
    latestPosition = firstLocation;
 
    if (navigator.geolocation) {
 
        watchId = navigator.geolocation.watchPosition(
            (position) => {
 
                latestPosition = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
 
                currentLatitude = latestPosition.latitude;
                currentLongitude = latestPosition.longitude;
 
                coordinatesText.innerText =
                    `${currentLatitude.toFixed(6)}° N, ${currentLongitude.toFixed(6)}° E`;
            },
            (error) => console.warn("watchPosition error:", error.message),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
        );
    }
 
    trackingTimer = setInterval(sendTrackingUpdate, TRACKING_INTERVAL_MS);
 
    keepScreenAwake();
}
 
 
function stopLiveTracking(notifyServer = true) {
 
    if (trackingTimer) {
        clearInterval(trackingTimer);
        trackingTimer = null;
    }
 
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
 
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
 
    if (notifyServer && trackingToken) {
 
        fetch("/api/sos/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: trackingToken })
        }).catch(() => {});
    }
 
    if (notifyServer) {
        trackingToken = null;
    }
}
 
 
// Screen dobara on hone par wake lock wapas lo
document.addEventListener("visibilitychange", () => {
 
    if (document.visibilityState === "visible" && trackingToken) {
        keepScreenAwake();
    }
});
 
 
// ==========================================
// LOAD EMERGENCY CONTACTS
// ==========================================
 
async function loadEmergencyContact() {
 
    try {
 
        const response = await fetch("/api/emergency-contact");
        const data = await response.json();
 
        if (!data.success) {
 
            console.error(data.message);
 
            return;
        }
 
        emergencyContacts = Array.isArray(data.contacts) ? data.contacts : [];
 
        contactName.innerText = data.guardianName || "Emergency Contact";
        contactPhone.innerText = "+" + data.guardianPhone;
 
        // Call button pehle contact ko call karta hai
        callBtn.dataset.phone = data.guardianPhone;
        callBtn.dataset.name = data.guardianName || "Emergency Contact";
 
    } catch (error) {
 
        console.error("Emergency contact error:", error);
    }
}
 
 
// ==========================================
// BACK BUTTON
// ==========================================
 
backBtn.addEventListener("click", () => {
 
    stopSiren();
 
    window.history.back();
});
 
 
// ==========================================
// CALL EMERGENCY CONTACT
// ==========================================
 
callBtn.addEventListener("click", () => {
 
    const phone = callBtn.dataset.phone;
 
    if (!phone) {
 
        alert("Emergency contact number is not available.");
 
        return;
    }
 
    window.location.href = `tel:+${phone}`;
});
 
 
// ==========================================
// REFRESH LOCATION
// ==========================================
 
refreshBtn.addEventListener("click", async () => {
 
    refreshBtn.innerText = "Updating...";
 
    try {
 
        await getCurrentLocation();
 
        refreshBtn.innerText = "Refresh";
 
    } catch (error) {
 
        refreshBtn.innerText = "Refresh";
 
        alert(error.message);
    }
});
 
 
// ==========================================
// SIREN
// ==========================================
 
function startSiren() {
 
    if (sirenInterval) return;
 
    if (!audioCtx) {
 
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
 
    if (audioCtx.state === "suspended") {
 
        audioCtx.resume();
    }
 
    let up = true;
    let freq = 400;
 
    sirenInterval = setInterval(() => {
 
        try {
 
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
 
            osc.type = "sawtooth";
 
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
 
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
 
            gain.gain.exponentialRampToValueAtTime(
                0.01,
                audioCtx.currentTime + 0.2
            );
 
            osc.connect(gain);
            gain.connect(audioCtx.destination);
 
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
 
            if (up) {
 
                freq += 60;
 
                if (freq >= 850) up = false;
 
            } else {
 
                freq -= 60;
 
                if (freq <= 400) up = true;
            }
 
        } catch (error) {
 
            console.error(error);
        }
 
    }, 200);
}
 
 
// ==========================================
// STOP SIREN
// ==========================================
 
function stopSiren() {
 
    if (sirenInterval) {
 
        clearInterval(sirenInterval);
 
        sirenInterval = null;
    }
}
 
 
// ==========================================
// SEND SOS TO NODE BACKEND
// ==========================================
 
async function sendSOSLocation() {
 
    try {
 
        instructionText.innerHTML = "Getting your live location...";
 
        const location = await getLocationForSOS();
 
        instructionText.innerHTML = "Sending emergency alert...";
 
        const response = await fetch("/api/sos", {
 
            method: "POST",
 
            headers: { "Content-Type": "application/json" },
 
            body: JSON.stringify({
                latitude: location.latitude,
                longitude: location.longitude
            })
        });
 
        const data = await response.json();
 
        console.log("SOS Backend Response:", data);
 
        if (!response.ok || !data.success) {
 
            throw new Error(data.message || "SOS could not be sent.");
        }
 
        // Live tracking shuru
        if (data.trackingEnabled && data.token) {
 
            startLiveTracking(data.token, location);
        }
 
        const trackingLine = data.trackingEnabled
            ? "📡 Live location is being shared.<br>Keep this screen open."
            : "📍 Current location shared.";
 
        instructionText.innerHTML = `
            <span style="color:#dc2626; font-weight:700;">
                🚨 SOS SENT SUCCESSFULLY 🚨
                <br><br>
                ${escapeHTML(data.message || "Emergency contacts have been notified on WhatsApp.")}
                <br><br>
                ${trackingLine}
                <br><br>
                <small>Tap the SOS button again to cancel.</small>
            </span>
            ${callButtonsHTML()}
        `;
 
    } catch (error) {
 
        console.error("SOS Error:", error);
 
        instructionText.innerHTML = `
            <span style="color:#dc2626; font-weight:700;">
                ⚠️ SOS FAILED
                <br>
                ${escapeHTML(error.message)}
            </span>
            ${callButtonsHTML()}
        `;
 
        isSosActive = false;
 
        stopSiren();
 
        throw error;
    }
}
 
 
// ==========================================
// TRIGGER SOS
// ==========================================
 
async function triggerSOS() {
 
    isSosActive = true;
 
    clearInterval(countdownInterval);
 
    sosBtn.style.background = "#991b1b";
 
    startSiren();
 
    try {
 
        await sendSOSLocation();
 
    } catch (error) {
 
        isSosActive = false;
 
        sosBtn.style.background =
            "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
    }
}
 
 
// ==========================================
// CANCEL SOS
// ==========================================
 
function cancelSOS() {
 
    isSosActive = false;
 
    stopSiren();
 
    stopLiveTracking(true);
 
    clearTimeout(holdTimer);
    clearInterval(countdownInterval);
 
    holdTimer = null;
 
    instructionText.innerHTML =
        `Press and hold to send SOS
        <br>
        Your location will be shared
        <br>
        with your emergency contact.`;
 
    sosBtn.style.background =
        "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
 
    alert("SOS Cancelled. Live location sharing has stopped.");
}
 
 
// ==========================================
// PRESS AND HOLD
// ==========================================
 
function startHold(e) {
 
    e.preventDefault();
 
    if (isSosActive) {
 
        cancelSOS();
 
        return;
    }
 
    let timeLeft = 3;
 
    instructionText.innerHTML = `Hold for ${timeLeft}s to broadcast SOS...`;
 
    countdownInterval = setInterval(() => {
 
        timeLeft--;
 
        if (timeLeft > 0) {
 
            instructionText.innerHTML = `Hold for ${timeLeft}s to broadcast SOS...`;
        }
 
    }, 1000);
 
    holdTimer = setTimeout(() => {
 
        triggerSOS();
 
    }, 3000);
}
 
 
// ==========================================
// CANCEL HOLD
// ==========================================
 
function cancelHold() {
 
    if (!isSosActive && holdTimer) {
 
        clearTimeout(holdTimer);
        clearInterval(countdownInterval);
 
        holdTimer = null;
 
        instructionText.innerHTML =
            `Press and hold to send SOS
            <br>
            Your location will be shared
            <br>
            with your emergency contact.`;
    }
}
 
 
// ==========================================
// MOUSE EVENTS
// ==========================================
 
sosBtn.addEventListener("mousedown", startHold);
sosBtn.addEventListener("mouseup", cancelHold);
sosBtn.addEventListener("mouseleave", cancelHold);
 
 
// ==========================================
// TOUCH EVENTS
// ==========================================
 
sosBtn.addEventListener("touchstart", startHold, { passive: false });
sosBtn.addEventListener("touchend", cancelHold);
sosBtn.addEventListener("touchcancel", cancelHold);
 
 
// ==========================================
// PAGE LOAD
// ==========================================
 
window.addEventListener("load", async () => {
 
    // Load emergency contacts
    await loadEmergencyContact();
 
    // Get initial GPS location
    try {
 
        await getCurrentLocation();
 
    } catch (error) {
 
        console.log("Initial GPS unavailable:", error.message);
 
        coordinatesText.innerText = "Location not available";
    }
});
 