(function () {

    const form = document.getElementById("loginForm");
    const userInput = document.getElementById("userIdInput");
    const box = document.getElementById("contactsBox");
    const hint = document.getElementById("contactsHint");
    const fields = document.getElementById("contactFields");
    const changeBtn = document.getElementById("changeContactsBtn");
    const contactInputs = fields.querySelectorAll("input");

    let mode = "unknown";      // unknown | new | existing
    let editing = false;       // existing user contacts badal raha hai
    let requestCounter = 0;
    let timer = null;

    function clearContacts() {
        contactInputs.forEach(i => { i.value = ""; });
    }

    function setRequired(flag) {
        contactInputs.forEach(i => { i.required = flag; });
    }

    function render() {

        if (mode === "unknown") {
            box.style.display = "none";
            setRequired(false);
            return;
        }

        box.style.display = "block";

        if (mode === "new") {
            hint.textContent = "New user: please enter both contacts (required).";
            changeBtn.style.display = "none";
            fields.style.display = "block";
            setRequired(true);
            return;
        }

        // existing user
        changeBtn.style.display = "block";

        if (editing) {
            hint.textContent = "Enter both new contacts. They will replace your old ones.";
            changeBtn.textContent = "KEEP MY CURRENT CONTACTS";
            fields.style.display = "block";
            setRequired(true);
        } else {
            hint.textContent = "Welcome back! Just continue, or change your contacts.";
            changeBtn.textContent = "CHANGE CONTACTS";
            fields.style.display = "none";
            clearContacts();
            setRequired(false);
        }
    }

    function setMode(newMode) {
        if (newMode !== mode) {
            mode = newMode;
            editing = false;
            clearContacts();
        }
        render();
    }

    async function checkUser() {

        const id = userInput.value.trim().toLowerCase();
        const thisRequest = ++requestCounter;

        if (!/^[a-z0-9_.-]{3,30}$/.test(id)) {
            setMode("unknown");
            return;
        }

        try {
            const res = await fetch("/api/check-user?userId=" + encodeURIComponent(id));
            const data = await res.json();

            // Purana response aaye to ignore karo
            if (thisRequest !== requestCounter) return;

            setMode(data.exists ? "existing" : "new");
        } catch (err) {
            if (thisRequest === requestCounter) setMode("unknown");
        }
    }

    userInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(checkUser, 400);
    });

    userInput.addEventListener("blur", checkUser);

    changeBtn.addEventListener("click", () => {
        editing = !editing;
        clearContacts();
        render();
    });

    // Submit se pehle ek baar check, taaki naye user ko contacts dikh jayein
    let ready = false;

    form.addEventListener("submit", async (event) => {

        if (ready) return;

        event.preventDefault();

        await checkUser();

        if (!form.reportValidity()) return;

        ready = true;
        form.submit();
    });

    // Server error ke baad page dobara khule aur ID bhari ho
    if (userInput.value) checkUser();

})();
