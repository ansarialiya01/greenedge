// ================= NAVIGATION SETTINGS =================

// Navigation Mode
const navigationMode = document.getElementById("navigationMode");

// Obstacle Alerts
const obstacleAlerts = document.getElementById("obstacleAlerts");

// Distance Unit
const distanceUnit = document.getElementById("distanceUnit");

// Haptic Feedback
const hapticFeedback = document.getElementById("hapticFeedback");


// ================= LOAD SAVED SETTINGS =================

document.addEventListener("DOMContentLoaded", function () {

    // Navigation Mode
    const savedNavigationMode = localStorage.getItem("navigationMode");

    if (savedNavigationMode !== null) {
        navigationMode.value = savedNavigationMode;
    }


    // Obstacle Alerts
    const savedObstacleAlerts = localStorage.getItem("obstacleAlerts");

    if (savedObstacleAlerts !== null) {
        obstacleAlerts.checked = savedObstacleAlerts === "true";
    }


    // Distance Unit
    const savedDistanceUnit = localStorage.getItem("distanceUnit");

    if (savedDistanceUnit !== null) {
        distanceUnit.value = savedDistanceUnit;
    }


    // Haptic Feedback
    const savedHapticFeedback = localStorage.getItem("hapticFeedback");

    if (savedHapticFeedback !== null) {
        hapticFeedback.checked = savedHapticFeedback === "true";
    }

});


// ================= NAVIGATION MODE =================

navigationMode.addEventListener("change", function () {

    localStorage.setItem(
        "navigationMode",
        navigationMode.value
    );

});


// ================= OBSTACLE ALERTS =================

obstacleAlerts.addEventListener("change", function () {

    localStorage.setItem(
        "obstacleAlerts",
        obstacleAlerts.checked
    );

});


// ================= DISTANCE UNIT =================

distanceUnit.addEventListener("change", function () {

    localStorage.setItem(
        "distanceUnit",
        distanceUnit.value
    );

});


// ================= HAPTIC FEEDBACK =================

hapticFeedback.addEventListener("change", function () {

    localStorage.setItem(
        "hapticFeedback",
        hapticFeedback.checked
    );

});
