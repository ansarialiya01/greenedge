// ================= GENERAL SETTINGS =================

// Language
const language = document.getElementById("language");

// Theme
const theme = document.getElementById("theme");

// Text Size
const textSize = document.getElementById("textSize");

// High Contrast Mode
const highContrast = document.getElementById("highContrast");


// ================= APPLY SAVED SETTINGS =================

document.addEventListener("DOMContentLoaded", function () {

    // ---------------- LANGUAGE ----------------

    const savedLanguage = localStorage.getItem("language");

    if (savedLanguage !== null) {
        language.value = savedLanguage;
    }


    // ---------------- THEME ----------------

    const savedTheme = localStorage.getItem("theme");

    if (savedTheme !== null) {
        theme.value = savedTheme;
    }

    applyTheme(theme.value);


    // ---------------- TEXT SIZE ----------------

    const savedTextSize = localStorage.getItem("textSize");

    if (savedTextSize !== null) {
        textSize.value = savedTextSize;
    }

    applyTextSize(textSize.value);


    // ---------------- HIGH CONTRAST ----------------

    const savedHighContrast = localStorage.getItem("highContrast");

    if (savedHighContrast !== null) {
        highContrast.checked = savedHighContrast === "true";
    }

    applyHighContrast(highContrast.checked);

});


// ================= LANGUAGE =================

language.addEventListener("change", function () {

    localStorage.setItem(
        "language",
        language.value
    );

});


// ================= THEME =================

theme.addEventListener("change", function () {

    localStorage.setItem(
        "theme",
        theme.value
    );

    applyTheme(theme.value);

});


// ================= APPLY THEME =================

function applyTheme(selectedTheme) {

    if (selectedTheme === "dark") {
        document.body.classList.add("dark-theme");
    } 
    else {
        document.body.classList.remove("dark-theme");
    }

}


// ================= TEXT SIZE =================

textSize.addEventListener("change", function () {

    localStorage.setItem(
        "textSize",
        textSize.value
    );

    applyTextSize(textSize.value);

});


// ================= APPLY TEXT SIZE =================

function applyTextSize(selectedSize) {

    document.body.classList.remove(
        "text-small",
        "text-medium",
        "text-large"
    );

    if (selectedSize === "small") {
        document.body.classList.add("text-small");
    }

    else if (selectedSize === "medium") {
        document.body.classList.add("text-medium");
    }

    else if (selectedSize === "large") {
        document.body.classList.add("text-large");
    }

}


// ================= HIGH CONTRAST MODE =================

highContrast.addEventListener("change", function () {

    localStorage.setItem(
        "highContrast",
        highContrast.checked
    );

    applyHighContrast(highContrast.checked);

});


// ================= APPLY HIGH CONTRAST =================

function applyHighContrast(isEnabled) {

    if (isEnabled) {
        document.body.classList.add("high-contrast");
    } 
    else {
        document.body.classList.remove("high-contrast");
    }

}