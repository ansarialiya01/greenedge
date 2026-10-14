(function () {
 
    // Script do baar load ho jaye to do mic na chalein
    if (window.__greenedgeVoiceLoaded) return;
    window.__greenedgeVoiceLoaded = true;
 
    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
 
    if (!SpeechRecognition) {
        console.warn("Speech Recognition API not supported in this browser.");
 
        window.addEventListener("DOMContentLoaded", () => {
            const note = document.createElement("div");
 
            note.textContent =
                "Voice assistant is not supported in this browser. Please open this page in Chrome.";
 
            Object.assign(note.style, {
                position: "fixed",
                top: "0",
                left: "0",
                right: "0",
                padding: "8px 10px",
                background: "#b91c1c",
                color: "#fff",
                fontSize: "13px",
                zIndex: "10001"
            });
 
            document.body.appendChild(note);
        });
 
        return;
    }
 
 
    let recognition = null;
    let isListening = false;
    let isSpeaking = false;
 
    let isDocumentReading = false;
 
 
    // Results ek ke baad ek process hon
    let queue = Promise.resolve();
 
 
    // Emergency contacts badalne ka page
    const GUARDIAN_PAGE = "/change-guardian";
 
 
    // Phone hai ya laptop
    const IS_MOBILE =
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.userAgentData &&
            navigator.userAgentData.mobile === true) ||
        (
            navigator.maxTouchPoints > 1 &&
            Math.min(window.screen.width, window.screen.height) < 900
        );
 
 
    // Mic permission block
    let micBlocked = false;
 
 
    // Status dikhane ke liye
    function setStatus(message) {
 
        console.log("[assistant]", message);
 
        const onVoicePage =
            window.location.pathname === "/login" ||
            window.location.pathname === GUARDIAN_PAGE;
 
        if (!(IS_MOBILE || onVoicePage) || !document.body) return;
 
        let bar = document.getElementById("voice-status");
 
        if (!bar) {
            bar = document.createElement("div");
 
            bar.id = "voice-status";
 
            Object.assign(bar.style, {
                position: "fixed",
                top: "0",
                left: "0",
                right: "0",
                padding: "6px 10px",
                background: "rgba(0,0,0,0.75)",
                color: "#ffffff",
                fontSize: "13px",
                fontFamily: "monospace",
                zIndex: "10001"
            });
 
            document.body.appendChild(bar);
        }
 
        bar.textContent = message;
    }
 
 
    // Persist active state across page loads
    let isAssistantActive =
        sessionStorage.getItem("voice_assistant_active") === "true";
 
 
    // Session state
    let sessionState = {};
 
 
    // =====================================================
    // HOME MENU: say 1-5 to open that page directly
    // (browser par hi check hota hai, Python tak jaane ki zarurat nahi)
    // =====================================================
 
    const HOME_MENU_PAGES = {
        1: { url: "/Snavigation?camera=true", say: "Navigation." },
        2: { url: "/documentR?camera=true",   say: "Document reader." },
        3: { url: "/location",    say: "Location." },
        4: { url: "/sos",         say: "SOS." },
        5: { url: "/setting",     say: "Settings." }
    };
 
    // Spoken words (English, Hindi, common mis-hearings) -> number
    const SPOKEN_MENU_NUMBERS = {
        one: 1, won: 1, wan: 1, ek: 1,
        two: 2, to: 2, too: 2, tu: 2, do: 2,
        three: 3, tree: 3, free: 3, teen: 3, tin: 3,
        four: 4, for: 4, fore: 4, char: 4, chaar: 4,
        five: 5, fife: 5, panch: 5, paanch: 5
    };
 
    const MENU_FILLER_WORDS = [
        "number", "option", "press", "select", "choose",
        "open", "please", "say", "card", "menu", "tap", "go"
    ];
 
    function spokenMenuNumber(text) {
 
        const words = String(text || "")
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter(Boolean)
            .filter(w => !MENU_FILLER_WORDS.includes(w));
 
        // Sirf ek number word hona chahiye, taaki "go to settings" ko 2 na samjhe
        if (words.length !== 1) return null;
 
        const w = words[0];
 
        if (/^[1-5]$/.test(w)) return Number(w);
 
        return SPOKEN_MENU_NUMBERS[w] || null;
    }
 
    function isHomePage() {
        return window.location.pathname.replace(/\/$/, "") === "/home";
    }
 
    // "back", "go back", "wapas", "peeche" etc.
    function isGoBackCommand(text) {
 
        const t = String(text || "")
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
 
        return (
            /^(please )?(go )?back$/.test(t) ||
            /\b(go|come|take me|move) back\b/.test(t) ||
            /\b(wapas|vapas|peeche|piche|previous)\b/.test(t)
        );
    }
 
    // Contacts change page par hain ya nahi
    // (path ya contact-flow ke step se pata chalta hai, taaki URL alag ho to bhi chale)
    function isGuardianPage() {
 
        const path = window.location.pathname
            .replace(/\/$/, "")
            .toLowerCase();
 
        const step = String((sessionState && sessionState.step) || "");
 
        return (
            path === GUARDIAN_PAGE ||
            /guardian|emergency|contact/.test(path) ||
            step.startsWith("ec_")
        );
    }
 
 
    // "change emergency contact", "change contact", "change guardian number" etc.
    function isChangeContactCommand(text) {
 
        const t = String(text || "")
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
 
        return /\bchange\b.*\b(emergency|guardian|contact|contacts|number|numbers)\b/.test(t);
    }
 
 
    // =====================================================
    // DOCUMENT READER PAGE: "read document" browser par hi pakdo
    // (Python tak jaane ki zarurat nahi, isliye 1 baar bolne par kaam karega)
    // =====================================================
 
    function isDocumentPage() {
        return (
            window.location.pathname
                .replace(/\/$/, "")
                .toLowerCase() === "/documentr"
        );
    }
 
    function isReadDocumentCommand(text) {
 
        const t = String(text || "")
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
 
        if (!t) return false;
 
        return (
            /\b(read|red|reed)\b.*\b(document|doc|documents|it|text|aloud|this)\b/.test(t) ||
            /^(read|red|reed)$/.test(t) ||
            /\bpadho\b|\bpadh do\b|\bpad do\b/.test(t)
        );
    }
 
 
    // =====================================================
    // SPEECH RECOGNITION
    // =====================================================
 
    function initRecognition() {
 
        recognition = new SpeechRecognition();
 
        recognition.lang = "en-IN";
        recognition.continuous = false;
        recognition.interimResults = false;
 
        // Kai options milte hain, taaki "1" jaise chhote bol ke liye
        // koi bhi sahi option mil jaye
        recognition.maxAlternatives = 3;
 
 
        recognition.onstart = () => {
 
            isListening = true;
 
            updateIndicator(true);
 
            setStatus(
                "🎤 Listening... " +
                (isAssistantActive
                    ? "(active)"
                    : "(say: Hey GreenEdge)")
            );
        };
 
 
        recognition.onend = () => {
 
            isListening = false;
 
            updateIndicator(false);
 
            if (!isSpeaking && !isDocumentReading && !micBlocked) {
                setTimeout(startListening, 300);
            }
        };
 
 
        recognition.onerror = (event) => {
 
            isListening = false;
 
            updateIndicator(false);
 
 
            if (
                event.error === "not-allowed" ||
                event.error === "service-not-allowed"
            ) {
 
                micBlocked = true;
 
                setStatus(
                    "❌ Mic blocked (" +
                    event.error +
                    "). Allow mic in Chrome and tap the screen."
                );
 
                return;
            }
 
 
            if (
                event.error !== "no-speech" &&
                event.error !== "aborted"
            ) {
                setStatus("⚠️ Mic error: " + event.error);
            }
 
 
            if (
                event.error !== "no-speech" &&
                event.error !== "aborted" &&
                !isSpeaking
            ) {
                setTimeout(startListening, 1000);
            }
        };
 
 
        recognition.onresult = (event) => {
 
            if (isSpeaking || isDocumentReading) return;
 
            for (
                let i = event.resultIndex;
                i < event.results.length;
                i++
            ) {
 
                if (!event.results[i].isFinal) continue;
 
                const result = event.results[i];
 
                let transcript = result[0].transcript.trim();
 
                // Home page par: agar koi bhi option menu number hai to wahi lo
                if (isHomePage()) {
 
                    for (let a = 0; a < result.length; a++) {
 
                        const alt = result[a].transcript.trim();
 
                        if (spokenMenuNumber(alt)) {
                            transcript = alt;
                            break;
                        }
                    }
                }
 
                // Document page par: koi bhi option "read document" jaisa ho to wahi lo
                if (isDocumentPage()) {
 
                    for (let a = 0; a < result.length; a++) {
 
                        const alt = result[a].transcript.trim();
 
                        if (isReadDocumentCommand(alt)) {
                            transcript = alt;
                            break;
                        }
                    }
                }
 
                if (!transcript) continue;
 
                console.log("🗣 User said:", transcript);
 
                setStatus("🗣 Heard: " + transcript);
 
                queue = queue.then(() => handleCommand(transcript));
            }
        };
    }
 
 
    function startListening() {
 
        // Document read ho raha hai to mic bilkul start nahi hoga
        if (isDocumentReading) {
            return;
        }
 
        if (
            micBlocked ||
            isListening ||
            isSpeaking ||
            !recognition
        ) {
            return;
        }
 
        try {
 
            // Hamesha ek baar mein ek bol (continuous band).
            // Phone number lete waqt har bol ke baad assistant digits wapas bolta hai,
            // isliye mic har baar naya start hota hai.
            recognition.continuous = false;
 
            recognition.start();
 
        } catch (e) {
            // Already running
        }
    }
 
    // =====================================================
    // DOCUMENT READING MODE
    // (assistant ko sula do / jaga do)
    // =====================================================
 
    window.startDocumentReading = function (message) {
 
        console.log("📖 Document mode: assistant sleeping.");
 
        isDocumentReading = true;
 
        // Mic stop
        stopListening();
 
        // Current assistant speech bhi stop
        window.speechSynthesis.cancel();
 
        updateIndicator(false);
 
        setStatus(
            message ||
            "🔇 Voice assistant sleeping while document is being read."
        );
    };
 
 
    window.endDocumentReading = function () {
 
        console.log("📖 Document mode finished: assistant waking up.");
 
        isDocumentReading = false;
 
        setStatus("🎤 Listening... say your command");
 
        updateIndicator(false);
 
        // Mic turant start karo. Agar abort() abhi poora na hua ho to
        // start() fail ho sakta hai, isliye kuch baar retry.
        const tryStart = (attempt) => {
 
            if (
                isDocumentReading ||
                micBlocked ||
                isSpeaking ||
                isListening
            ) {
                return;
            }
 
            startListening();
 
            if (attempt < 4) {
                setTimeout(() => tryStart(attempt + 1), 300);
            }
        };
 
        setTimeout(() => tryStart(0), 50);
    };
 
 
    function stopListening() {
 
        if (!isListening || !recognition) return;
 
        try {
            recognition.abort();
        } catch (e) {}
 
        isListening = false;
 
        updateIndicator(false);
    }
 
 
    // =====================================================
    // TEXT TO SPEECH
    // opts.rate = bolne ki raftaar (digits ke liye dheere)
    // =====================================================
 
    function speak(text, callback = null, opts = {}) {
 
        if (!text) {
 
            if (callback) callback();
 
            return;
        }
 
 
        isSpeaking = true;
 
        stopListening();
 
        window.speechSynthesis.cancel();
 
 
        const rate = opts.rate || 1.0;
 
        let finished = false;
 
        let safetyTimer = null;
 
 
        const finish = () => {
 
            if (finished) return;
 
            finished = true;
 
            clearTimeout(safetyTimer);
 
            isSpeaking = false;
 
            if (callback) callback();
 
            setTimeout(startListening, 400);
        };
 
 
        // Dheere bolne par zyada time lagta hai
        safetyTimer = setTimeout(
            finish,
            Math.max(2500, (text.length * 90) / rate + 1500)
        );
 
 
        const utterance = new SpeechSynthesisUtterance(text);
 
        utterance.rate = rate;
        utterance.volume = 1.0;
        utterance.lang = "en-US";
        utterance.onend = finish;
        utterance.onerror = finish;
 
 
        setTimeout(
            () => window.speechSynthesis.speak(utterance),
            80
        );
    }
 
 
    // =====================================================
    // SEND COMMAND TO PYTHON / NODE
    // =====================================================
 
    async function handleCommand(commandText) {
 
        console.log(
            "[assistant] command:", commandText,
            "| page:", window.location.pathname,
            "| step:", sessionState && sessionState.step
        );
 
        // Home page: menu number bolne par seedha wo page khulta hai
        if (isHomePage() && isAssistantActive) {
 
            const n = spokenMenuNumber(commandText);
 
            console.log("🔢 Home menu check:", commandText, "->", n);
 
            if (n && HOME_MENU_PAGES[n]) {
 
                const target = HOME_MENU_PAGES[n];
 
                speak(
                    target.say,
                    () => { window.location.href = target.url; }
                );
 
                return;
            }
        }
 
 
        // Emergency contacts page: "back" bolne par seedha Home (Settings nahi)
        if (isGuardianPage() && isGoBackCommand(commandText)) {
 
            console.log("⬅️ Back from contacts page -> Home");
 
            sessionState = { step: "idle" };
 
            setStatus("⬅️ Going to Home...");
 
            speak(
                "Home.",
                () => { window.location.href = "/home"; }
            );
 
            return;
        }
 
 
        // Home page: "change emergency contact" seedha contacts page kholta hai
        if (
            isHomePage() &&
            isAssistantActive &&
            isChangeContactCommand(commandText)
        ) {
 
            console.log("📞 Change emergency contact:", commandText);
 
            speak(
                "Emergency contacts.",
                () => { window.location.href = GUARDIAN_PAGE; }
            );
 
            return;
        }
 
 
        // Document page: "read document" seedha Read Aloud button dabata hai
        if (
            isDocumentPage() &&
            isAssistantActive &&
            isReadDocumentCommand(commandText)
        ) {
 
            const readBtn = document.getElementById("readAloudBtn");
 
            console.log("📖 Read document command:", commandText);
 
            if (readBtn) {
                readBtn.click();
                return;
            }
        }
 
 
        try {
 
            const res = await fetch(
                "/api/voice-command",
                {
                    method: "POST",
 
                    headers: {
                        "Content-Type": "application/json"
                    },
 
                    body: JSON.stringify({
 
                        command: commandText,
 
                        is_active: isAssistantActive,
 
                        current_page: window.location.pathname,
 
                        session_state: sessionState,
 
                        is_mobile: IS_MOBILE,
 
                        login_mode:
                            (
                                document.body &&
                                document.body.dataset.loginMode
                            ) || ""
                    })
                }
            );
 
 
            const data = await res.json();
 
 
            // Update activity state
            if (typeof data.is_active !== "undefined") {
 
                isAssistantActive = data.is_active;
 
                sessionStorage.setItem(
                    "voice_assistant_active",
                    isAssistantActive
                );
            }
 
 
            // Update session state
            if (data.session_state) {
                sessionState = data.session_state;
            }
 
 
            // Naam / digits field mein turant dikhao
            if (
                data.action === "fill_and_listen" &&
                data.target
            ) {
 
                const liveFields =
                    document.getElementsByName(data.target);
 
                if (liveFields.length > 0) {
                    liveFields[0].value = data.val;
                }
            }
 
 
            // Phone number ke digits: dheere aur poori awaaz mein wapas bolo
            const isDigitEcho =
                data.action === "fill_and_listen" &&
                /phone/i.test(data.target || "");
 
            if (isDigitEcho && data.val) {
                setStatus("🔢 Number: " + data.val);
            }
 
 
            // Speak and execute
            if (data.message) {
 
                speak(
                    data.message,
                    () => executeAction(data),
                    isDigitEcho ? { rate: 0.85 } : {}
                );
 
            } else {
 
                executeAction(data);
            }
 
        } catch (err) {
 
            console.error("Assistant Error:", err);
 
            setStatus("❌ Cannot reach server: " + err.message);
 
            speak("Network error.");
        }
    }
 
 
    // =====================================================
    // PHONE CALL
    // =====================================================
 
    function toTelNumber(raw) {
 
        const digits =
            String(raw || "").replace(/[^\d+]/g, "");
 
 
        if (/^\d{10}$/.test(digits)) {
            return "+91" + digits;
        }
 
 
        if (/^0\d{10}$/.test(digits)) {
            return "+91" + digits.slice(1);
        }
 
 
        if (
            !digits.startsWith("+") &&
            digits.length >= 11
        ) {
            return "+" + digits;
        }
 
 
        return digits;
    }
 
 
    function showCallButton(number, label) {
 
        const old = document.getElementById("voice-call-btn");
 
        if (old) old.remove();
 
 
        const btn = document.createElement("a");
 
        btn.id = "voice-call-btn";
        btn.href = "tel:" + number;
        btn.textContent = "📞 Tap to call " + label;
        btn.setAttribute("role", "button");
 
 
        Object.assign(btn.style, {
            position: "fixed",
            left: "10px",
            right: "10px",
            bottom: "60px",
            padding: "28px 12px",
            background: "#16a34a",
            color: "#ffffff",
            fontSize: "24px",
            fontWeight: "700",
            textAlign: "center",
            borderRadius: "16px",
            zIndex: "10000",
            textDecoration: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)"
        });
 
 
        btn.addEventListener(
            "click",
            () => setTimeout(() => btn.remove(), 500)
        );
 
 
        document.body.appendChild(btn);
 
 
        setTimeout(() => btn.remove(), 30000);
    }
 
 
    const NAME_SYNONYMS = {
        mother: "mom",
        mummy: "mom",
        mama: "mom",
        maa: "mom",
        mum: "mom",
        father: "dad",
        papa: "dad",
        daddy: "dad",
        pappa: "dad"
    };
 
 
    function normName(name) {
 
        return String(name || "")
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .map(word => NAME_SYNONYMS[word] || word)
            .join(" ");
    }
 
 
    const FIRST_CONTACT_WORDS = [
        "",
        "guardian",
        "emergency contact",
        "contact one",
        "contact 1",
        "first contact"
    ];
 
 
    const SECOND_CONTACT_WORDS = [
        "contact two",
        "contact 2",
        "second contact"
    ];
 
 
    function editDistance(a, b) {
 
        const dp = Array.from(
            { length: a.length + 1 },
            (_, i) => [i]
        );
 
 
        for (let j = 1; j <= b.length; j++) {
            dp[0][j] = j;
        }
 
 
        for (let i = 1; i <= a.length; i++) {
 
            for (let j = 1; j <= b.length; j++) {
 
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] +
                    (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
        }
 
 
        return dp[a.length][b.length];
    }
 
 
    function closeEnough(a, b) {
 
        if (!a || !b) return false;
 
        const limit =
            Math.max(a.length, b.length) <= 5 ? 1 : 2;
 
        return editDistance(a, b) <= limit;
    }
 
 
    function pickContact(contacts, spokenName) {
 
        const wanted = normName(spokenName);
 
 
        if (FIRST_CONTACT_WORDS.includes(wanted)) {
            return contacts[0] || null;
        }
 
 
        if (SECOND_CONTACT_WORDS.includes(wanted)) {
            return contacts[1] || null;
        }
 
 
        return (
 
            contacts.find(
                c => normName(c.name) === wanted
            ) ||
 
            contacts.find(c => {
 
                const n = normName(c.name);
 
                return (
                    n &&
                    (
                        n.includes(wanted) ||
                        wanted.includes(n)
                    )
                );
            }) ||
 
            contacts.find(
                c => closeEnough(normName(c.name), wanted)
            ) ||
 
            null
        );
    }
 
 
    async function dialNumber(data) {
 
        let number = data.number;
 
        let label = data.label || "contact";
 
 
        if (
            !number &&
            (
                data.target === "contact" ||
                data.target === "guardian"
            )
        ) {
 
            try {
 
                const res = await fetch("/api/emergency-contact");
 
                const info = await res.json();
 
 
                if (!info.success) {
 
                    speak(
                        info.message ||
                        "Contact not found."
                    );
 
                    return;
                }
 
 
                const contacts =
                    (info.contacts && info.contacts.length)
                        ? info.contacts
                        : [
                            {
                                name: info.guardianName,
                                phone: info.guardianPhone
                            }
                        ];
 
 
                const match = pickContact(contacts, data.name);
 
 
                if (!match) {
 
                    const names =
                        contacts.map(c => c.name).join(" or ");
 
                    speak(
                        `No ${data.name}. Try ${names}.`
                    );
 
                    return;
                }
 
 
                number = match.phone;
 
                label = match.name || "your contact";
 
            } catch (err) {
 
                console.error("Emergency contact error:", err);
 
                speak("Could not get contacts.");
 
                return;
            }
        }
 
 
        number = toTelNumber(number);
 
 
        showCallButton(number, label);
 
 
        speak(
            `Calling ${label}.`,
            () => {
                window.location.href = "tel:" + number;
            }
        );
    }
 
 
    // =====================================================
    // SAVE TWO EMERGENCY CONTACTS (after "Done" / "Save and continue")
    // contacts = Python se aaya [{name, phone}, {name, phone}]
    // =====================================================
 
    async function saveEmergencyContacts(contacts) {
 
        // Login page par naya user abhi logged in nahi hai.
        // Fields pehle se bhare hain, isliye form submit karo.
        if (window.location.pathname === "/login") {
 
            const form = document.querySelector("form");
 
            if (form) {
                speak("Creating account.", () => form.submit());
            }
 
            return;
        }
 
 
        if (
            !Array.isArray(contacts) ||
            contacts.length !== 2
        ) {
 
            speak("Add both contacts first.");
 
            return;
        }
 
 
        try {
 
            const response = await fetch(
                "/api/update-emergency-contacts",
                {
                    method: "POST",
 
                    headers: {
                        "Content-Type": "application/json"
                    },
 
                    body: JSON.stringify({ contacts: contacts })
                }
            );
 
 
            // Server JSON na bheje to bhi HTTP status se decide karo
            let data = {};
 
            try {
                data = await response.json();
            } catch (e) {
                data = { success: response.ok };
            }
 
 
            if (!response.ok || data.success === false) {
 
                speak(
                    data.message ||
                    "Could not save contacts."
                );
 
                return;
            }
 
 
            // Save ho gaya: seedha home page
            speak(
                "Contacts saved.",
                () => {
                    window.location.href = "/home";
                }
            );
 
 
            // Safety: bolne ka callback na chale to bhi home chale jao
            setTimeout(() => {
                if (window.location.pathname === GUARDIAN_PAGE) {
                    window.location.href = "/home";
                }
            }, 6000);
 
        } catch (error) {
 
            console.error("Save emergency contacts error:", error);
 
            speak("Could not save contacts.");
        }
    }
 
 
    // =====================================================
    // SOS
    // "emergency" bolne par SOS page khulta hai aur SOS khud trigger hota hai
    // =====================================================
 
    function callTriggerSOS(tries = 0) {
 
        if (typeof window.triggerSOS === "function") {
 
            window.triggerSOS();
 
        } else if (tries < 20) {
 
            // SOS page ka script abhi load ho raha ho sakta hai
            setTimeout(() => callTriggerSOS(tries + 1), 250);
        }
    }
 
 
    function runSOS() {
 
        if (window.location.pathname === "/sos") {
 
            callTriggerSOS();
 
        } else {
 
            sessionStorage.setItem("pending_sos", "true");
 
            window.location.href = "/sos";
        }
    }
 
 
    // =====================================================
    // NAVIGATION CAMERA
    // "navigation camera" bolne par page khulta hai aur camera khud chalta hai
    // =====================================================
 
    function callStartNavigationCamera(tries = 0) {
 
        if (typeof window.startNavigationCamera === "function") {
 
            window.startNavigationCamera();
 
        } else if (tries < 20) {
 
            // Navigation page ka script abhi load ho raha ho sakta hai
            setTimeout(() => callStartNavigationCamera(tries + 1), 250);
 
        } else {
 
            console.error("Navigation camera function not found.");
        }
    }
 
 
    // =====================================================
    // START CHANGE CONTACTS (setting page ke button se)
    // =====================================================
 
    window.startChangeNumber = function () {
 
        isAssistantActive = true;
 
        sessionStorage.setItem("voice_assistant_active", "true");
 
        sessionState = { step: "idle" };
 
        queue = queue.then(
            () => handleCommand("change contact")
        );
    };
 
 
    // =====================================================
    // EXECUTE ACTION
    // =====================================================
 
    function executeAction(data) {
 
        switch (data.action) {
 
 
            case "navigate":
 
                if (
                    data.url &&
                    window.location.pathname !== data.url
                ) {
                    window.location.href = data.url;
                }
 
                break;
 
 
            case "history_back":
 
                // Contacts page se back hamesha Home par jaye
                if (isGuardianPage()) {
                    window.location.href = "/home";
                } else {
                    window.history.back();
                }
 
                break;
 
 
            case "page_action":
 
                if (
                    data.target === "sosBtn" &&
                    typeof window.triggerSOS === "function"
                ) {
 
                    window.triggerSOS();
 
                } else {
 
                    const el =
                        document.getElementById(data.target);
 
                    if (el) el.click();
                }
 
                break;
 
 
            case "trigger_sos":
 
                runSOS();
 
                break;
 
 
            case "start_navigation_camera":
 
                callStartNavigationCamera();
 
                break;
 
 
            case "sleep":
 
                isAssistantActive = false;
 
                sessionStorage.setItem(
                    "voice_assistant_active",
                    "false"
                );
 
                break;
 
 
            // =================================================
            // CONVERSATIONAL ACTIONS
            // =================================================
 
            case "speak_and_listen":
 
                startListening();
 
                break;
 
 
            case "fill_and_listen": {
 
                const inputs =
                    document.getElementsByName(data.target);
 
                if (inputs.length > 0) {
                    inputs[0].value = data.val;
                }
 
                startListening();
 
                break;
            }
 
 
            // "Done" bolne ke baad dono contacts save
            case "save_emergency_contacts":
 
                saveEmergencyContacts(data.contacts);
 
                break;
 
 
            // =================================================
            // OLD FORM SUBMIT SUPPORT
            // =================================================
 
            case "fill_and_submit": {
 
                const fieldInputs =
                    document.getElementsByName(data.target);
 
                if (fieldInputs.length > 0) {
                    fieldInputs[0].value = data.val;
                }
 
                const form = document.querySelector("form");
 
                if (form) {
                    form.submit();
                }
 
                break;
            }
 
 
            // =================================================
            // PHONE ACTIONS
            // =================================================
 
            case "dial":
 
                dialNumber(data);
 
                break;
 
 
            case "open_maps":
 
                if (data.url) {
                    window.location.href = data.url;
                }
 
                break;
        }
    }
 
 
    // =====================================================
    // VOICE INDICATOR
    // =====================================================
 
    function createIndicator() {
 
        const dot = document.createElement("div");
 
        dot.id = "voice-indicator";
 
        Object.assign(dot.style, {
            position: "fixed",
            bottom: "20px",
            right: "20px",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            backgroundColor: "#9ca3af",
            zIndex: "9999",
            boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
            transition: "all 0.3s ease"
        });
 
        document.body.appendChild(dot);
    }
 
 
    function updateIndicator(active) {
 
        const dot = document.getElementById("voice-indicator");
 
        if (!dot) return;
 
 
        if (isSpeaking) {
 
            dot.style.backgroundColor = "#2563eb";
            dot.style.transform = "scale(1.2)";
 
        } else if (active) {
 
            dot.style.backgroundColor =
                isAssistantActive ? "#16a34a" : "#f59e0b";
 
            dot.style.transform = "scale(1.1)";
 
        } else {
 
            dot.style.backgroundColor = "#9ca3af";
            dot.style.transform = "scale(1.0)";
        }
    }
 
 
    // =====================================================
    // SCREEN ANNOUNCEMENT
    // =====================================================
 
    function announceScreen() {
 
        const path = window.location.pathname;
 
 
        // Login page
        if (path === "/login") {
 
            const mode =
                (
                    document.body &&
                    document.body.dataset.loginMode
                ) || "new";
 
 
            const userName =
                (
                    document.body &&
                    document.body.dataset.userName
                ) || "";
 
 
            const errorBox =
                document.querySelector(".login-error");
 
 
            const errorText =
                errorBox
                    ? errorBox.textContent.trim() + ". "
                    : "";
 
 
            let message;
 
 
            if (mode === "known") {
 
                sessionState = { step: "idle" };
 
                message =
                    `Welcome back${userName ? ", " + userName : ""}. ` +
                    "Say continue or new account.";
 
            } else {
 
                sessionState = { step: "ask_name" };
 
                message =
                    `${errorText}Welcome to GreenEdge. Your name?`;
            }
 
 
            isAssistantActive = true;
 
            sessionStorage.setItem("voice_assistant_active", "true");
 
            speak(message);
 
            return true;
        }
 
 
        // Emergency contacts page
        if (path === GUARDIAN_PAGE) {
 
            sessionState = {
                step: "ec_ask_c1_name",
                digits: "",
                temp_phone: ""
            };
 
 
            isAssistantActive = true;
 
            sessionStorage.setItem("voice_assistant_active", "true");
 
 
            speak("Contacts. First contact name?");
 
 
            return true;
        }
 
 
        // Home page: speak the number menu
        if (path === "/home") {
 
            isAssistantActive = true;
 
            sessionStorage.setItem("voice_assistant_active", "true");
 
            sessionState = { step: "idle" };
 
            speak(
                "Say option one for navigation. Option two for document reader. " +
                "Option three for location. Option four for SOS. Option five for settings. " +
                "To change emergency contact, say change contact."
            );
 
            return true;
        }
 
 
        const pageNames = {
            "/setting": "Settings",
            "/documentR": "Document reader",
            "/Snavigation": "Navigation",
            "/documentS": "Document summary",
            "/profile": "Profile",
            "/sos": "SOS"
        };
 
 
        const title = pageNames[path];
 
 
        if (title && isAssistantActive) {
 
            speak(`${title}.`);
 
            return true;
        }
 
 
        return false;
    }
 
 
    // =====================================================
    // DOM CONTENT LOADED
    // =====================================================
 
    window.addEventListener(
        "DOMContentLoaded",
        () => {
 
            createIndicator();
 
            initRecognition();
 
            console.log("[assistant] voice_assistance.js v4 loaded on", window.location.pathname);
 
 
            // Contacts page par kisi bhi tarah ka "back" (voice, page ka button,
            // phone ka back button, history.back()) seedha Home par jaye
            const guardianPath = window.location.pathname
                .replace(/\/$/, "")
                .toLowerCase();
 
            if (
                guardianPath === GUARDIAN_PAGE ||
                /guardian|emergency|contact/.test(guardianPath)
            ) {
 
                // Ek extra history entry: back dabate hi ye hat jayegi aur popstate chalega
                history.pushState({ guardianTrap: true }, "", window.location.href);
 
                window.addEventListener("popstate", () => {
                    window.location.replace("/home");
                });
 
                // Page ke apne Back button (id="backBtn") ko bhi Home par bhejo
                document.addEventListener(
                    "click",
                    (e) => {
 
                        const back = e.target.closest && e.target.closest("#backBtn");
 
                        if (back) {
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            window.location.replace("/home");
                        }
                    },
                    true
                );
            }
 
 
            // "emergency" bolne ke baad SOS page khula hai: SOS trigger karo
            if (
                window.location.pathname === "/sos" &&
                sessionStorage.getItem("pending_sos") === "true"
            ) {
 
                sessionStorage.removeItem("pending_sos");
 
                callTriggerSOS();
            }
 
 
            // "navigation camera" bolne ke baad navigation page khula hai:
            // camera shuru karo
            if (
                window.location.pathname.replace(/\/$/, "").toLowerCase() === "/snavigation" &&
                new URLSearchParams(window.location.search).get("camera") === "true"
            ) {
 
                callStartNavigationCamera();
            }
 
 
            // Emergency contacts page par step set karo
            if (window.location.pathname === GUARDIAN_PAGE) {
 
                sessionState = {
                    step: "ec_ask_c1_name",
                    digits: "",
                    temp_phone: ""
                };
            }
 
 
            const unlockAudio = () => {
 
                if (!isSpeaking && !isDocumentReading) {
 
                    if (!announceScreen()) {
                        startListening();
                    }
                }
 
 
                window.removeEventListener("click", unlockAudio);
                window.removeEventListener("keydown", unlockAudio);
                window.removeEventListener("touchstart", unlockAudio);
            };
 
 
            window.addEventListener("click", unlockAudio);
            window.addEventListener("keydown", unlockAudio);
            window.addEventListener("touchstart", unlockAudio);
 
 
            // Mic block hua ho to tap se retry
            window.addEventListener(
                "click",
                () => {
 
                    if (micBlocked && !isSpeaking) {
 
                        micBlocked = false;
 
                        startListening();
                    }
                }
            );
 
 
            setStatus(
                "Assistant ready. Tap the screen once to start the mic."
            );
 
 
            if (isAssistantActive) {
                setTimeout(startListening, 500);
            }
        }
    );
 
})();
 