function toggleRegisterPassword() {
    const password = document.getElementById("register-password");

    if (password.type === "password") {
        password.type = "text";
    } else {
        password.type = "password";
    }
}

function toggleConfirmPassword() {
    const password = document.getElementById("confirm-password");

    if (password.type === "password") {
        password.type = "text";
    } else {
        password.type = "password";
    }
}