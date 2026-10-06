document.addEventListener("DOMContentLoaded", function () {

    document.querySelectorAll(".back-icon").forEach(function (button) {

        button.addEventListener("click", function () {
            window.history.back();
        });

    });

});