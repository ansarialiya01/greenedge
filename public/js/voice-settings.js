// ================= VOICE & AUDIO SETTINGS =================

// Voice Guidance
const voiceGuidance = document.getElementById("voiceGuidance");

// Voice Type
const voiceType = document.getElementById("voiceType");

// Speech Rate
const speechRate = document.getElementById("speechRate");

// Volume
const volumeSlider = document.querySelector(".volume-control input");
const volumePercentage = document.querySelector(".volume-control span");


// ================= LOAD SAVED SETTINGS =================

document.addEventListener("DOMContentLoaded", function () {

    // Voice Guidance
    const savedVoiceGuidance = localStorage.getItem("voiceGuidance");

    if (savedVoiceGuidance !== null) {
        voiceGuidance.checked = savedVoiceGuidance === "true";
    }


    // Voice Type
    const savedVoiceType = localStorage.getItem("voiceType");

    if (savedVoiceType !== null) {
        voiceType.value = savedVoiceType;
    }


    // Speech Rate
    const savedSpeechRate = localStorage.getItem("speechRate");

    if (savedSpeechRate !== null) {
        speechRate.value = savedSpeechRate;
    }


    // Volume
    const savedVolume = localStorage.getItem("volume");

    if (savedVolume !== null) {
        volumeSlider.value = savedVolume;
    }

    volumePercentage.textContent = volumeSlider.value + "%";
});


// ================= VOICE GUIDANCE =================

voiceGuidance.addEventListener("change", function () {

    localStorage.setItem(
        "voiceGuidance",
        voiceGuidance.checked
    );

});


// ================= VOICE TYPE =================

voiceType.addEventListener("change", function () {

    localStorage.setItem(
        "voiceType",
        voiceType.value
    );

});


// ================= SPEECH RATE =================

speechRate.addEventListener("change", function () {

    localStorage.setItem(
        "speechRate",
        speechRate.value
    );

});


// ================= VOLUME =================

volumeSlider.addEventListener("input", function () {

    // Update percentage on screen
    volumePercentage.textContent = volumeSlider.value + "%";

    // Save volume
    localStorage.setItem(
        "volume",
        volumeSlider.value
    );

});
