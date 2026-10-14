import re
from urllib.parse import quote
from flask import Flask, request, jsonify
from flask_cors import CORS
 
app = Flask(__name__)
CORS(app)
 
 
# =====================================================
# HELPERS
# =====================================================
 
def contains_any(command, phrases):
    """True if the command contains any of the phrases as whole words."""
    clean = re.sub(r'[^\w\s]', ' ', command.lower())
    clean = " ".join(clean.split())
 
    for phrase in phrases:
        pattern = r'\b' + re.escape(phrase.lower()) + r'\b'
 
        if re.search(pattern, clean):
            return True
 
    return False
 
 
def extract_call_target(command):
    """
    Pulls the contact name out of a call command.
    Examples: "call mom", "call my guardian", "make a call to dad"
    """
 
    text = re.sub(r"[^\w\s]", " ", command.lower())
 
    text = re.sub(
        r"\b(please|can you|could you|make a|make|call|dial|ring|to|a|an|the|my|ko|karo|kar do|now)\b",
        " ",
        text
    )
 
    target = " ".join(text.split())
 
    if target in (
        "contact",
        "contacts",
        "someone",
        "somebody",
        "anyone",
        "phone call"
    ):
        return ""
 
    return target
 
 
def reply(message, session_state, action="speak_and_listen", **extra):
    """Builds a standard JSON response for the frontend."""
 
    payload = {
        "success": True,
        "action": action,
        "message": message,
        "session_state": session_state,
        "is_active": True
    }
 
    payload.update(extra)
 
    return jsonify(payload)
 
 
# =====================================================
# EMERGENCY NUMBERS
# =====================================================
 
EMERGENCY_NUMBERS = {
    "police": "100",
    "ambulance": "102",
    "emergency": "112",
    "women helpline": "1091"
}
 
 
def phone_call_response(target, session_state):
    """
    Emergency services are dialed directly by number.
    Any other name is sent to the frontend, which looks up the contact.
    """
 
    if target in EMERGENCY_NUMBERS:
 
        return jsonify({
            "success": True,
            "action": "dial",
            "number": EMERGENCY_NUMBERS[target],
            "label": target,
            "message": f"Calling {target}.",
            "session_state": session_state,
            "is_active": True
        })
 
    return jsonify({
        "success": True,
        "action": "dial",
        "target": "contact",
        "name": target,
        "message": "",
        "session_state": session_state,
        "is_active": True
    })
 
 
# =====================================================
# PHONE NUMBER DIGITS
# =====================================================
 
# Spoken words (English and Hindi, plus common mis-hearings) mapped to digits
SPOKEN_DIGITS = {
    "zero": "0", "oh": "0", "o": "0", "shunya": "0", "jero": "0", "sifar": "0",
    "one": "1", "won": "1", "ek": "1", "van": "1",
    "two": "2", "to": "2", "too": "2", "do": "2", "tu": "2",
    "three": "3", "teen": "3", "tin": "3", "tree": "3", "free": "3",
    "four": "4", "for": "4", "fore": "4", "char": "4", "chaar": "4",
    "five": "5", "paanch": "5", "panch": "5", "pach": "5", "fife": "5",
    "six": "6", "chhe": "6", "che": "6", "chah": "6", "chhah": "6",
    "cheh": "6", "sex": "6", "sicks": "6",
    "seven": "7", "saat": "7", "sat": "7", "sath": "7",
    "eight": "8", "ate": "8", "aath": "8", "ath": "8", "aat": "8",
    "nine": "9", "nau": "9", "no": "9", "now": "9", "nein": "9", "naine": "9",
}
 
REPEAT_WORDS = {
    "double": 2,
    "triple": 3
}
 
 
def extract_digits(text):
    """
    Converts speech into digits.
    Examples: "9 5 0", "95037", "nine five zero", "double nine"
    """
 
    out = ""
    mult = 1
 
    for token in re.findall(r"[a-z]+|\d+", text.lower()):
 
        if token in REPEAT_WORDS:
            mult = REPEAT_WORDS[token]
            continue
 
        if token.isdigit():
 
            if len(token) == 1:
                out += token * mult
            else:
                out += token
 
        elif token in SPOKEN_DIGITS:
            out += SPOKEN_DIGITS[token] * mult
 
        mult = 1
 
    return out
 
 
def spaced(digits):
    return " ".join(digits)
 
 
def collect_phone(cmd, session_state, field, confirm_step):
    """
    Collects a phone number a few digits at a time.
    Once 10 digits are complete, asks the user to confirm.
    For the second contact, rejects a number equal to the first contact's.
    """
 
    digits = session_state.get("digits", "")
 
    # Clear everything
    if contains_any(cmd, ["clear", "start over", "reset"]):
 
        session_state["digits"] = ""
 
        return reply(
            "Cleared. Say the number again.",
            session_state,
            "fill_and_listen",
            target=field,
            val=""
        )
 
    # Delete the last digit
    if contains_any(cmd, ["delete", "undo", "remove"]):
 
        digits = digits[:-1]
 
        session_state["digits"] = digits
 
        return reply(
            f"Removed. {len(digits)} digits.",
            session_state,
            "fill_and_listen",
            target=field,
            val=digits
        )
 
    # Read back what has been collected
    if contains_any(cmd, ["repeat", "read", "what did i say"]):
 
        if not digits:
            return reply("No digits yet.", session_state)
 
        return reply(spaced(digits), session_state)
 
    # New digits
    new = extract_digits(cmd)
 
    if not new:
        return reply("", session_state)
 
    combined = digits + new
 
    # Mobile numbers cannot start with zero
    combined = combined.lstrip("0")
 
    if not combined:
        return reply("Not zero. Next digit.", session_state)
 
    # Accept a +91 prefix followed by 10 digits
    if len(combined) == 12 and combined.startswith("91"):
        combined = combined[2:]
 
    if len(combined) > 10:
 
        return reply(
            "Too many digits. Say delete or clear.",
            session_state
        )
 
    session_state["digits"] = combined
 
    # 10 digits complete
    if len(combined) == 10:
 
        # Second contact must differ from the first
        if (
            field in ("contact2_phone", "contactPhone2")
            and combined == session_state.get("c1_phone", "")[-10:]
        ):
 
            session_state["digits"] = ""
 
            return reply(
                "Same as first. Say another number.",
                session_state,
                "fill_and_listen",
                target=field,
                val=""
            )
 
        session_state["temp_phone"] = combined
        session_state["step"] = confirm_step
 
        return reply(
            f"{spaced(combined)}. Correct?",
            session_state,
            "fill_and_listen",
            target=field,
            val=combined
        )
 
    # Still incomplete: read back what was just heard
    return reply(
        spaced(new),
        session_state,
        "fill_and_listen",
        target=field,
        val=combined
    )
 
 
# =====================================================
# NAME CLEANING
# =====================================================
 
def clean_name(text):
    """
    Strips filler words from a spoken name.
    Examples: "my name is Riya", "her name is Papa", "I am Riya"
    """
 
    text = re.sub(r"[^\w\s]", " ", text.lower())
 
    text = re.sub(
        r"^\s*(my name is|name is|his name is|her name is|it is|it's|i am|i m|this is)\s+",
        "",
        text
    )
 
    return " ".join(text.split()).title()
 
 
# =====================================================
# WORD LISTS
# =====================================================
 
YES_WORDS = [
    "yes",
    "yeah",
    "yep",
    "correct",
    "right",
    "it is",
    "sure"
]
 
NO_WORDS = [
    "no",
    "incorrect",
    "wrong",
    "change"
]
 
# The user must say one of these before contacts are saved
DONE_WORDS = [
    "done",
    "finish",
    "finished",
    "save",
    "save and continue",
    "continue",
    "submit"
]
 
# Saying any of these triggers SOS immediately
SOS_WORDS = [
    "sos",
    "trigger sos",
    "trigger emergency sos",
    "emergency sos",
    "activate sos",
    "activate emergency",
    "start sos",
    "send sos",
    "send emergency",
    "emergency",
    "help me",
    "danger",
    "sound siren"
]
 
CHANGE_NUMBER_PHRASES = [
    "change number",
    "change numbers",
    "change phone number",
    "change my number",
    "change my phone number",
 
    "change contact",
    "change contacts",
    "change emergency contact",
    "change emergency contacts",
 
    "update number",
    "update phone number",
    "update my number",
 
    "update contact",
    "update contacts",
    "update emergency contact",
    "update emergency contacts",
 
    "edit number",
    "edit phone number",
    "edit contact",
    "edit contacts",
    "edit emergency contact",
    "edit emergency contacts",
 
    "change guardian",
    "change guardian number",
    "update guardian number"
]
 
 
# =====================================================
# HOME MENU (say a number 1-5)
# =====================================================
 
HOME_MENU_TEXT = (
    "Say option one for navigation. Option two for document reader. "
    "Option three for location. Option four for SOS. Option five for settings."
)
 
HOME_MENU = {
    "1": ("/Snavigation?camera=true", "Navigation."),
    "2": ("/documentR?camera=true", "Document reader."),
    "3": ("/location", "Location."),
    "4": ("/sos", "SOS."),
    "5": ("/setting", "Settings."),
}
 
 
MENU_FILLERS = (
    "number", "option", "press", "select", "choose", "open",
    "please", "say", "go", "card", "menu", "pressed", "tap"
)
 
 
def menu_choice(cmd):
    """
    Returns '1'..'5' for things like: "1", "one", "two", "number three",
    "say four", "option 5", "1.", "won", "to", "for".
    """
 
    words = re.sub(r"[^\w\s]", " ", cmd.lower()).split()
 
    words = [w for w in words if w not in MENU_FILLERS]
 
    # Pick the tokens that are menu digits (1-5)
    digits = []
 
    for w in words:
        d = extract_digits(w)
 
        if d in HOME_MENU:
            digits.append(d)
 
    # Exactly one menu number in the whole phrase
    if len(digits) == 1 and len(words) <= 2:
        return digits[0]
 
    # Same number repeated ("one one") still means that number
    if digits and len(set(digits)) == 1 and len(words) == len(digits):
        return digits[0]
 
    return None
 
 
# =====================================================
# CAMERA COMMANDS (navigation and document are separate)
# =====================================================
 
# Generic phrases: only meaningful on the page that owns the camera
GENERIC_CAMERA = [
    "open camera",
    "start camera",
    "turn on camera",
    "camera on",
    "activate camera"
]
 
# Said from ANY page -> goes straight to the navigation camera
NAV_CAMERA_NAMED = [
    "open navigation camera",
    "start navigation camera",
    "turn on navigation camera",
    "navigation camera"
]
 
# Only on the navigation page
NAV_PAGE_ONLY = [
    "start navigation",
    "start detection",
    "start walking"
]
 
# Said from ANY page -> goes straight to the document camera
DOC_CAMERA_NAMED = [
    "open document camera",
    "start document camera",
    "turn on document camera",
    "document camera",
    "scan document"
]
 
 
# =====================================================
# WELCOME MESSAGE FOR NEW USERS
# =====================================================
 
WELCOME_MESSAGE = "Welcome to GreenEdge. " + HOME_MENU_TEXT
 
 
# =====================================================
# MAIN VOICE API
# =====================================================
 
@app.route("/voice", methods=["POST"])
def process_voice():
 
    data = request.get_json() or {}
 
    raw_command = data.get("command", "").lower().strip()
 
    is_active = data.get("is_active", False)
 
    current_page = data.get("current_page", "")
 
    is_mobile = bool(data.get("is_mobile", False))
 
    # Conversation state sent back and forth with the frontend
    session_state = data.get("session_state", {})
 
    step = session_state.get("step", "idle")
 
    # -------------------------------------------------
    # WELCOME EVENT
    # The frontend sends this once when a new user lands on the home page.
    # -------------------------------------------------
 
    if data.get("event") == "welcome":
 
        if data.get("is_new_user") and current_page == "/home":
 
            return jsonify({
                "success": True,
                "action": "speak_only",
                "message": WELCOME_MESSAGE,
                "session_state": session_state,
                "is_active": is_active
            })
 
        return jsonify({
            "success": False,
            "action": "none",
            "message": ""
        })
 
    if not raw_command:
 
        return jsonify({
            "success": False,
            "action": "none",
            "message": ""
        })
 
    print(
        f"🎤 Heard: '{raw_command}' | "
        f"Active: {is_active} | "
        f"Page: {current_page} | "
        f"Step: {step}"
    )
 
    wake_words = [
        "hey greenedge",
        "hey green edge",
        "greenedge",
        "green edge",
        "hey assistant",
        "wakeup",
        "wake up",
        "hello",
        "hey"
    ]
 
    stop_words = [
        "stop listening",
        "go quiet",
        "sleep",
        "shut up",
        "turn off assistant",
        "mute",
        "stop"
    ]
 
    help_words = [
        "help",
        "what can i say",
        "commands",
        "how to use"
    ]
 
    # =================================================
    # 1. STOP / SLEEP
    # =================================================
 
    if contains_any(raw_command, stop_words):
 
        return jsonify({
            "success": True,
            "action": "sleep",
            "message": "Sleeping.",
            "is_active": False
        })
 
    # =================================================
    # 2. WAKE-UP
    # =================================================
 
    woke_up = contains_any(raw_command, wake_words)
 
    cmd = raw_command
 
    # Remove the wake word so only the actual command remains
    if woke_up:
 
        for w in sorted(wake_words, key=len, reverse=True):
 
            cmd = re.sub(
                r'\b' + re.escape(w) + r'\b',
                '',
                cmd
            ).strip()
 
    # =================================================
    # 3. SLEEPING STATE
    # =================================================
 
    if not is_active:
 
        if woke_up:
 
            valid_intents = [
                "navigate",
                "navigation",
                "read",
                "scan",
                "location",
                "where",
                "setting",
                "settings",
                "profile",
                "sos",
                "emergency",
                "home",
                "back",
                "login",
                "log in",
                "call",
                "dial",
                "change number",
                "change contact",
                "change emergency contact",
                "change emergency contacts"
            ]
 
            # Wake word alone, or with an unrelated phrase
            if not cmd or not contains_any(cmd, valid_intents):
 
                return jsonify({
                    "success": True,
                    "action": "activated",
                    "message": "Listening.",
                    "is_active": True
                })
 
            else:
                is_active = True
 
        else:
 
            return jsonify({
                "success": True,
                "action": "ignored",
                "message": "",
                "is_active": False
            })
 
    else:
 
        if woke_up and not cmd:
 
            return jsonify({
                "success": True,
                "action": "activated",
                "message": "Listening.",
                "is_active": True
            })
 
    # =================================================
    # 4. LOGIN / SIGN-UP FLOW
    # =================================================
 
    if current_page == "/login" and is_active:
 
        login_mode = data.get("login_mode", "")
 
        # New user: own name
        if step == "ask_name":
 
            name = clean_name(cmd)
 
            if not name:
                return reply("Say your name.", session_state)
 
            session_state["user_name"] = name
            session_state["step"] = "ask_c1_name"
 
            return reply(
                f"Hello {name}. First contact name?",
                session_state,
                "fill_and_listen",
                target="name",
                val=name
            )
 
        # Contact 1: name
        if step == "ask_c1_name":
 
            name = clean_name(cmd)
 
            if not name:
                return reply("First contact name?", session_state)
 
            session_state["contact1_name"] = name
            session_state["step"] = "ask_c1_phone"
            session_state["digits"] = ""
 
            return reply(
                f"{name}'s number?",
                session_state,
                "fill_and_listen",
                target="contact1_name",
                val=name
            )
 
        # Contact 1: phone
        if step == "ask_c1_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contact1_phone",
                "confirm_c1_phone"
            )
 
        # Contact 1: confirm phone
        if step == "confirm_c1_phone":
 
            if contains_any(cmd, YES_WORDS):
 
                session_state["c1_phone"] = session_state.get("temp_phone", "")
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ask_c2_name"
 
                return reply(
                    "Saved. Second contact name?",
                    session_state,
                    "fill_and_listen",
                    target="contact1_phone",
                    val=session_state["c1_phone"]
                )
 
            if contains_any(cmd, NO_WORDS):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ask_c1_phone"
 
                return reply(
                    "Say the number again.",
                    session_state,
                    "fill_and_listen",
                    target="contact1_phone",
                    val=""
                )
 
            return reply("Yes or no?", session_state)
 
        # Contact 2: name
        if step == "ask_c2_name":
 
            name = clean_name(cmd)
 
            if not name:
                return reply("Second contact name?", session_state)
 
            session_state["contact2_name"] = name
            session_state["step"] = "ask_c2_phone"
            session_state["digits"] = ""
 
            return reply(
                f"{name}'s number?",
                session_state,
                "fill_and_listen",
                target="contact2_name",
                val=name
            )
 
        # Contact 2: phone
        if step == "ask_c2_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contact2_phone",
                "confirm_c2_phone"
            )
 
        # Contact 2: confirm phone
        if step == "confirm_c2_phone":
 
            if contains_any(cmd, YES_WORDS):
 
                session_state["contact2_phone"] = session_state.get("temp_phone", "")
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "awaiting_contacts_done"
 
                return reply("Say Done to save.", session_state)
 
            if contains_any(cmd, NO_WORDS):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ask_c2_phone"
 
                return reply(
                    "Say the number again.",
                    session_state,
                    "fill_and_listen",
                    target="contact2_phone",
                    val=""
                )
 
            return reply("Yes or no?", session_state)
 
        # Wait for "Done" before saving
        if step == "awaiting_contacts_done":
 
            if contains_any(cmd, DONE_WORDS):
 
                contact1_name = session_state.get("contact1_name", "")
                contact1_phone = session_state.get("c1_phone", "")
                contact2_name = session_state.get("contact2_name", "")
                contact2_phone = session_state.get("contact2_phone", "")
 
                if not all([
                    contact1_name,
                    contact1_phone,
                    contact2_name,
                    contact2_phone
                ]):
 
                    return reply("Details missing. Start again.", session_state)
 
                if contact1_phone == contact2_phone:
 
                    session_state["step"] = "ask_c2_phone"
                    session_state["digits"] = ""
 
                    return reply(
                        "Same number. Say a different one.",
                        session_state,
                        "fill_and_listen",
                        target="contact2_phone",
                        val=""
                    )
 
                session_state["step"] = "idle"
 
                return reply(
                    "Saving.",
                    session_state,
                    "save_emergency_contacts",
                    contacts=[
                        {"name": contact1_name, "phone": contact1_phone},
                        {"name": contact2_name, "phone": contact2_phone}
                    ]
                )
 
            return reply("Say Done to save.", session_state)
 
        # Returning user on the login page
        if login_mode == "known":
 
            if contains_any(
                cmd,
                [
                    "new account",
                    "new user",
                    "create account",
                    "create new account",
                    "make new account",
                    "register",
                    "sign up"
                ]
            ):
 
                session_state["step"] = "ask_name"
 
                return reply(
                    "Your name?",
                    session_state,
                    "page_action",
                    target="newAccountBtn"
                )
 
            if contains_any(
                cmd,
                [
                    "continue",
                    "login",
                    "log in",
                    "sign in",
                    "start login"
                ]
            ):
 
                return reply(
                    "Logging in.",
                    session_state,
                    "page_action",
                    target="continueBtn"
                )
 
            return reply("Say continue or new account.", session_state)
 
    # =================================================
    # 5. CHANGE EMERGENCY CONTACTS
    # =================================================
 
    # Open the emergency contacts page from any other page
    if (
        is_active
        and step == "idle"
        and current_page not in ("/login", "/change-guardian")
        and contains_any(cmd, CHANGE_NUMBER_PHRASES)
    ):
 
        session_state["step"] = "ec_ask_c1_name"
        session_state["digits"] = ""
        session_state["temp_phone"] = ""
 
        return reply(
            "Contacts. First contact name?",
            session_state,
            "navigate",
            url="/change-guardian"
        )
 
    # Voice flow on the emergency contacts page
    if current_page == "/change-guardian" and is_active:
 
        if contains_any(
            cmd,
            ["cancel", "go back", "back", "never mind", "nevermind"]
        ):
 
            session_state["step"] = "idle"
            session_state["digits"] = ""
            session_state["temp_phone"] = ""
 
            return reply(
                "Settings.",
                session_state,
                "navigate",
                url="/setting"
            )
 
        # Contact 1: name
        if step == "ec_ask_c1_name":
 
            name = clean_name(cmd)
 
            if not name:
                return reply("First contact name?", session_state)
 
            session_state["contact1_name"] = name
            session_state["step"] = "ec_ask_c1_phone"
            session_state["digits"] = ""
 
            return reply(
                f"{name}'s number?",
                session_state,
                "fill_and_listen",
                target="contactName1",
                val=name
            )
 
        # Contact 1: phone
        if step == "ec_ask_c1_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contactPhone1",
                "ec_confirm_c1_phone"
            )
 
        # Contact 1: confirm phone
        if step == "ec_confirm_c1_phone":
 
            if contains_any(cmd, YES_WORDS):
 
                session_state["c1_phone"] = session_state.get("temp_phone", "")
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ec_ask_c2_name"
 
                return reply(
                    "Saved. Second contact name?",
                    session_state,
                    "fill_and_listen",
                    target="contactPhone1",
                    val=session_state["c1_phone"]
                )
 
            if contains_any(cmd, NO_WORDS):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ec_ask_c1_phone"
 
                return reply(
                    "Say the number again.",
                    session_state,
                    "fill_and_listen",
                    target="contactPhone1",
                    val=""
                )
 
            return reply("Yes or no?", session_state)
 
        # Contact 2: name
        if step == "ec_ask_c2_name":
 
            name = clean_name(cmd)
 
            if not name:
                return reply("Second contact name?", session_state)
 
            session_state["contact2_name"] = name
            session_state["step"] = "ec_ask_c2_phone"
            session_state["digits"] = ""
 
            return reply(
                f"{name}'s number?",
                session_state,
                "fill_and_listen",
                target="contactName2",
                val=name
            )
 
        # Contact 2: phone
        if step == "ec_ask_c2_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contactPhone2",
                "ec_confirm_c2_phone"
            )
 
        # Contact 2: confirm phone
        if step == "ec_confirm_c2_phone":
 
            if contains_any(cmd, YES_WORDS):
 
                session_state["contact2_phone"] = session_state.get("temp_phone", "")
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ec_awaiting_done"
 
                return reply("Say Done to save.", session_state)
 
            if contains_any(cmd, NO_WORDS):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ec_ask_c2_phone"
 
                return reply(
                    "Say the number again.",
                    session_state,
                    "fill_and_listen",
                    target="contactPhone2",
                    val=""
                )
 
            return reply("Yes or no?", session_state)
 
        # Wait for "Done" before saving
        if step == "ec_awaiting_done":
 
            if contains_any(cmd, DONE_WORDS):
 
                contact1_name = session_state.get("contact1_name", "")
                contact1_phone = session_state.get("c1_phone", "")
                contact2_name = session_state.get("contact2_name", "")
                contact2_phone = session_state.get("contact2_phone", "")
 
                if not all([
                    contact1_name,
                    contact1_phone,
                    contact2_name,
                    contact2_phone
                ]):
 
                    return reply("Details missing. Start again.", session_state)
 
                if contact1_phone == contact2_phone:
 
                    session_state["step"] = "ec_ask_c2_phone"
                    session_state["digits"] = ""
 
                    return reply(
                        "Same number. Say a different one.",
                        session_state,
                        "fill_and_listen",
                        target="contactPhone2",
                        val=""
                    )
 
                # Saving is not done here: the frontend JS calls the Node API
                session_state["step"] = "idle"
 
                return reply(
                    "Saving.",
                    session_state,
                    "save_emergency_contacts",
                    contacts=[
                        {"name": contact1_name, "phone": contact1_phone},
                        {"name": contact2_name, "phone": contact2_phone}
                    ]
                )
 
            return reply("Say Done to save.", session_state)
 
    # =================================================
    # 6. DESTINATION FLOW
    # =================================================
 
    if step == "awaiting_destination" and is_active:
 
        session_state["step"] = "idle"
 
        if contains_any(cmd, ["cancel", "never mind", "nevermind"]):
 
            return jsonify({
                "success": True,
                "action": "speak_only",
                "message": "Canceled.",
                "session_state": session_state,
                "is_active": True
            })
 
        destination = cmd.strip()
 
        maps_url = (
            "https://www.google.com/maps/dir/?api=1"
            f"&destination={quote(destination)}"
            "&travelmode=walking"
            "&dir_action=navigate"
        )
 
        return jsonify({
            "success": True,
            "action": "open_maps",
            "url": maps_url,
            "message": f"Walking to {destination}.",
            "session_state": session_state,
            "is_active": True
        })
 
    # =================================================
    # 7. CALL TARGET FLOW
    # =================================================
 
    if step == "awaiting_call_target" and is_active:
 
        session_state["step"] = "idle"
 
        if contains_any(cmd, ["cancel", "never mind", "nevermind"]):
 
            return jsonify({
                "success": True,
                "action": "speak_only",
                "message": "Canceled.",
                "session_state": session_state,
                "is_active": True
            })
 
        return phone_call_response(
            extract_call_target(cmd),
            session_state
        )
 
    # =================================================
    # 7B. HOME MENU (numbers 1-5)
    # NOTE: this block must be at the same indent as the
    # "if step == ..." blocks above (4 spaces), not inside them.
    # =================================================
 
    if current_page.rstrip("/").startswith("/home") and is_active:
 
        print("MENU CHECK ->", repr(cmd), "| step:", repr(step), "| choice:", menu_choice(cmd))
 
        if contains_any(cmd, ["menu", "options"]):
 
            return jsonify({
                "success": True,
                "action": "speak_only",
                "message": HOME_MENU_TEXT,
                "session_state": session_state,
                "is_active": True
            })
 
        choice = menu_choice(cmd)
 
        if choice:
 
            session_state["step"] = "idle"
 
            url, msg = HOME_MENU[choice]
 
            return jsonify({
                "success": True,
                "action": "navigate",
                "url": url,
                "message": msg,
                "session_state": session_state,
                "is_active": True
            })
 
    # =================================================
    # 8. CALL COMMAND
    # =================================================
 
    if contains_any(cmd, ["call", "dial", "make a call"]):
 
        target = extract_call_target(cmd)
 
        if is_mobile:
 
            if target == "":
 
                session_state["step"] = "awaiting_call_target"
 
                return jsonify({
                    "success": True,
                    "action": "speak_and_listen",
                    "message": "Who to call?",
                    "session_state": session_state,
                    "is_active": True
                })
 
            return phone_call_response(target, session_state)
 
        url = "/call" + (f"?to={quote(target)}" if target else "")
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": url,
            "message": "Calling.",
            "is_active": True
        })
 
    # =================================================
    # 9. SOS COMMAND
    # "emergency" / "sos" triggers SOS directly (the frontend opens
    # the SOS page if needed and presses the button).
    # =================================================
 
    if contains_any(cmd, SOS_WORDS):
 
        return jsonify({
            "success": True,
            "action": "trigger_sos",
            "message": "SOS on.",
            "is_active": True
        })
 
    # =================================================
    # 10. HELP COMMAND
    # =================================================
 
    if contains_any(cmd, help_words):
 
        return jsonify({
            "success": True,
            "action": "speak_only",
            "message": HOME_MENU_TEXT,
            "is_active": True
        })
 
    # =================================================
    # 11. GO BACK
    # =================================================
 
    if (
        contains_any(
            cmd,
            [
                "cancel", "go back", "back", "never mind", "nevermind",
                "go home", "take me home", "go to home", "wapas"
            ]
        )
        or cmd.strip() == "home"
    ):

        session_state["step"] = "idle"
        session_state["digits"] = ""
        session_state["temp_phone"] = ""

        return reply(
            "Home.",
            session_state,
            "navigate",
            url="/home"
        )
 
    # =================================================
    # 12. HOME
    # =================================================
 
    if contains_any(cmd, ["home", "dashboard", "main menu"]):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/home",
            "message": "Home.",
            "is_active": True
        })
 
    # =================================================
    # 13A. CAMERA COMMANDS (navigation and document are separate)
    # Must stay above "13. SMART NAVIGATION" and "14. DOCUMENT READER",
    # otherwise "navigation camera" / "document camera" only open the
    # page and never turn the camera on.
    # =================================================
 
    # "/Snavigation/", "/snavigation", "/documentR?x=1" all look the same
    page = current_page.split("?")[0].rstrip("/").lower()
 
    # --- Document reader camera ---
    # "document camera" works from any page.
    # "open camera" / "start camera" works only on the document page.
    if (
        contains_any(cmd, DOC_CAMERA_NAMED)
        or (page == "/documentr" and contains_any(cmd, GENERIC_CAMERA))
    ):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/documentR?camera=true",
            "message": "Document camera.",
            "is_active": True
        })
 
    # --- Navigation camera ---
    # "navigation camera" works from any page.
    # "open camera" / "start navigation" works only on the navigation page.
    if (
        contains_any(cmd, NAV_CAMERA_NAMED)
        or (
            page == "/snavigation"
            and contains_any(cmd, GENERIC_CAMERA + NAV_PAGE_ONLY)
        )
    ):
 
        # Already on the navigation page: turn the camera on
        if page == "/snavigation":
 
            return jsonify({
                "success": True,
                "action": "start_navigation_camera",
                "message": "Camera on.",
                "is_active": True
            })
 
        # Any other page: open navigation page, camera starts there
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/Snavigation?camera=true",
            "message": "Navigation camera.",
            "is_active": True
        })
 
    # =================================================
    # 13. SMART NAVIGATION
    # =================================================
 
    if contains_any(
        cmd,
        ["navigation", "smart navigation", "start walking", "navigate"]
    ):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/Snavigation",
            "message": "Navigation.",
            "is_active": True
        })
 
    # =================================================
    # 14. DOCUMENT READER
    # =================================================
 
    if contains_any(
        cmd,
        ["document reader", "open document reader", "open document"]
    ):
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/documentR",
            "message": "Document reader.",
            "is_active": True
        })
 
    if (
        page == "/documentr"
        and contains_any(
            cmd,
            [
                "read the document",
                "read document",
                "read aloud",
                "read text",
                "read it"
            ]
        )
    ):
        return jsonify({
            "success": True,
            "action": "page_action",
            "target": "readAloudBtn",
            "message": "Reading.",
            "is_active": True
        })
 
    # =================================================
    # 15. LOCATION
    # =================================================
 
    if contains_any(cmd, ["location", "where am i", "my location", "gps"]):
 
        if is_mobile:
 
            session_state["step"] = "awaiting_destination"
 
            return jsonify({
                "success": True,
                "action": "speak_and_listen",
                "message": "Where to?",
                "session_state": session_state,
                "is_active": True
            })
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/location",
            "message": "Location.",
            "is_active": True
        })
 
    # =================================================
    # 16. SETTINGS
    # =================================================
 
    if contains_any(
        cmd,
        ["settings", "setting", "preferences", "app settings"]
    ):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/setting",
            "message": "Settings.",
            "is_active": True
        })
 
    # =================================================
    # 17. PROFILE
    # =================================================
 
    if contains_any(cmd, ["profile", "my account", "user profile"]):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/profile",
            "message": "Profile.",
            "is_active": True
        })
 
    # =================================================
    # 18. SCAN
    # =================================================
 
    if contains_any(
        cmd,
        ["scan", "take photo", "capture", "scan document"]
    ):
 
        return jsonify({
            "success": True,
            "action": "page_action",
            "target": "scanBtn",
            "message": "Camera.",
            "is_active": True
        })
 
    # =================================================
    # 19. UPLOAD
    # =================================================
 
    if contains_any(
        cmd,
        [
            "upload",
            "gallery",
            "choose file",
            "upload document",
            "upload from gallery"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "page_action",
            "target": "uploadBtn",
            "message": "Gallery.",
            "is_active": True
        })
 
    # =================================================
    # 20. READ ALOUD
    # =================================================
 
    if contains_any(
        cmd,
        ["read aloud", "read text", "play audio", "listen", "read it"]
    ):
 
        return jsonify({
            "success": True,
            "action": "page_action",
            "target": "readAloudBtn",
            "message": "Reading.",
            "is_active": True
        })
 
    # =================================================
    # 21. UNKNOWN COMMAND
    # =================================================
 
    return jsonify({
        "success": True,
        "action": "unknown",
        "message": "Say again.",
        "is_active": True
    })
 
 
# =====================================================
# START FLASK
# =====================================================
 
if __name__ == "__main__":
 
    app.run(
        host="0.0.0.0",
        port=5001,
        debug=False
    )
 