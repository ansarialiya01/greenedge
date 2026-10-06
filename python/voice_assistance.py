import re
from urllib.parse import quote
from flask import Flask, request, jsonify
from flask_cors import CORS
 
app = Flask(__name__)
CORS(app)
 
 
# =====================================================
# BASIC HELPERS
# =====================================================
 
def contains_any(command, phrases):
    clean = f" {re.sub(r'[^\w\s]', ' ', command.lower())} "
    clean = " ".join(clean.split())
 
    for phrase in phrases:
        pattern = r'\b' + re.escape(phrase.lower()) + r'\b'
 
        if re.search(pattern, clean):
            return True
 
    return False
 
 
def extract_call_target(command):
    """
    Examples:
        call mom
        call my guardian
        make a call to dad
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
    Phone par call:
    emergency number -> direct number
    normal contact -> JS contact name handle karega
    """
 
    if target in EMERGENCY_NUMBERS:
 
        return jsonify({
            "success": True,
            "action": "dial",
            "number": EMERGENCY_NUMBERS[target],
            "label": target,
            "message": (
                f"Calling {target}. "
                "Tap the green call button if the call does not start."
            ),
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
# PHONE NUMBER DIGIT HANDLING
# =====================================================
 
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
    Examples:
        9 5 0
        95037
        nine five zero
        double nine
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
    Phone number ek-ek ya multiple digits mein leta hai.
 
    10 digits complete hone par:
    number confirm hota hai.
 
    Contact 2 ke case mein:
    first contact ke number se duplicate check hota hai.
    """
 
    digits = session_state.get("digits", "")
 
    # -------------------------------------------------
    # CLEAR
    # -------------------------------------------------
 
    if contains_any(cmd, [
        "clear",
        "start over",
        "reset"
    ]):
 
        session_state["digits"] = ""
 
        return reply(
            "Cleared. Please say the number again.",
            session_state,
            "fill_and_listen",
            target=field,
            val=""
        )
 
    # -------------------------------------------------
    # DELETE LAST DIGIT
    # -------------------------------------------------
 
    if contains_any(cmd, [
        "delete",
        "undo",
        "remove"
    ]):
 
        digits = digits[:-1]
 
        session_state["digits"] = digits
 
        return reply(
            f"Removed. {len(digits)} digits so far.",
            session_state,
            "fill_and_listen",
            target=field,
            val=digits
        )
 
    # -------------------------------------------------
    # REPEAT
    # -------------------------------------------------
 
    if contains_any(cmd, [
        "repeat",
        "read",
        "what did i say"
    ]):
 
        if not digits:
 
            return reply(
                "No digits yet. Please say the number.",
                session_state
            )
 
        return reply(
            f"So far: {spaced(digits)}.",
            session_state
        )
 
    # -------------------------------------------------
    # NEW DIGITS
    # -------------------------------------------------
 
    new = extract_digits(cmd)
 
    if not new:
        return reply(
            "",
            session_state
        )
 
    combined = digits + new
 
    # Mobile number 0 se start nahi hona chahiye
    combined = combined.lstrip("0")
 
    if not combined:
 
        return reply(
            "Mobile numbers do not start with zero. Please say the next digit.",
            session_state
        )
 
    # -------------------------------------------------
    # 91 + 10 DIGITS SUPPORT
    # -------------------------------------------------
 
    if len(combined) == 12 and combined.startswith("91"):
        combined = combined[2:]
 
    # -------------------------------------------------
    # MORE THAN 10 DIGITS
    # -------------------------------------------------
 
    if len(combined) > 10:
 
        return reply(
            "That is more than ten digits. "
            "Say delete to remove the last digit, or clear to start over.",
            session_state
        )
 
    session_state["digits"] = combined
 
    # -------------------------------------------------
    # 10 DIGITS COMPLETE
    # -------------------------------------------------
 
    if len(combined) == 10:
 
        # Contact 2 ko Contact 1 ke same number se bachana
        if (
            field in ("contact2_phone", "contactPhone2")
            and combined == session_state.get("c1_phone", "")[-10:]
        ):
 
            session_state["digits"] = ""
 
            return reply(
                "That is the same as the first contact. "
                "Please say a different number.",
                session_state,
                "fill_and_listen",
                target=field,
                val=""
            )
 
        # Temporary number
        session_state["temp_phone"] = combined
 
        # Confirmation step
        session_state["step"] = confirm_step
 
        return reply(
            f"You said {spaced(combined)}. Is that correct?",
            session_state,
            "fill_and_listen",
            target=field,
            val=combined
        )
 
    # -------------------------------------------------
    # MORE DIGITS REQUIRED (jo suna wo wapas bolo)
    # -------------------------------------------------
 
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
    Examples:
        my name is Riya
        name is Mom
        her name is Papa
        I am Riya
    """
 
    text = re.sub(r"[^\w\s]", " ", text.lower())
 
    text = re.sub(
        r"^\s*(my name is|name is|his name is|her name is|it is|it's|i am|i m|this is)\s+",
        "",
        text
    )
 
    return " ".join(text.split()).title()
 
 
# =====================================================
# CONFIRMATION WORDS
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
 
 
# =====================================================
# DONE WORDS
# =====================================================
 
# User specifically wants "Done" before saving.
DONE_WORDS = [
    "done",
    "finish",
    "finished",
    "save",
    "save and continue",
    "continue",
    "submit"
]
 
 
# =====================================================
# SOS COMMANDS
# =====================================================
 
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
 
 
# =====================================================
# CHANGE EMERGENCY CONTACTS COMMANDS
# =====================================================
 
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
# RESPONSE HELPER
# =====================================================
 
def reply(message, session_state, action="speak_and_listen", **extra):
 
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
# MAIN VOICE API
# =====================================================
 
@app.route("/voice", methods=["POST"])
def process_voice():
 
    data = request.get_json() or {}
 
    raw_command = data.get(
        "command",
        ""
    ).lower().strip()
 
    is_active = data.get(
        "is_active",
        False
    )
 
    current_page = data.get(
        "current_page",
        ""
    )
 
    is_mobile = bool(
        data.get(
            "is_mobile",
            False
        )
    )
 
    # -------------------------------------------------
    # CONVERSATIONAL MEMORY
    # -------------------------------------------------
 
    session_state = data.get(
        "session_state",
        {}
    )
 
    step = session_state.get(
        "step",
        "idle"
    )
 
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
 
    # =================================================
    # COMMAND LISTS
    # =================================================
 
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
            "message": (
                "Going to sleep. "
                "Say 'Hey GreenEdge' when you need me."
            ),
            "is_active": False
        })
 
    # =================================================
    # 2. WAKE-UP
    # =================================================
 
    woke_up = contains_any(
        raw_command,
        wake_words
    )
 
    cmd = raw_command
 
    if woke_up:
 
        for w in sorted(
            wake_words,
            key=len,
            reverse=True
        ):
 
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
 
            if (
                not cmd
                or not contains_any(cmd, valid_intents)
            ):
 
                return jsonify({
                    "success": True,
                    "action": "activated",
                    "message": (
                        "Hey User, welcome back. "
                        "How may I help you?"
                    ),
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
                "message": (
                    "I am listening. "
                    "What would you like to do?"
                ),
                "is_active": True
            })
 
    # =================================================
    # 4. LOGIN / SIGN-UP FLOW
    # =================================================
 
    if current_page == "/login" and is_active:
 
        login_mode = data.get(
            "login_mode",
            ""
        )
 
        # ---------------------------------------------
        # NEW USER NAME
        # ---------------------------------------------
 
        if step == "ask_name":
 
            name = clean_name(cmd)
 
            if not name:
 
                return reply(
                    "I did not catch that. Please say your name.",
                    session_state
                )
 
            session_state["user_name"] = name
            session_state["step"] = "ask_c1_name"
 
            return reply(
                f"Hello {name}. "
                "Now say the name of your first emergency contact.",
                session_state,
                "fill_and_listen",
                target="name",
                val=name
            )
 
        # ---------------------------------------------
        # CONTACT 1 NAME
        # ---------------------------------------------
 
        if step == "ask_c1_name":
 
            name = clean_name(cmd)
 
            if not name:
 
                return reply(
                    "I did not catch that. "
                    "Please say the name of your first emergency contact.",
                    session_state
                )
 
            session_state["contact1_name"] = name
            session_state["step"] = "ask_c1_phone"
            session_state["digits"] = ""
 
            return reply(
                f"Now say the phone number of {name}. "
                "You can say a few digits at a time.",
                session_state,
                "fill_and_listen",
                target="contact1_name",
                val=name
            )
 
        # ---------------------------------------------
        # CONTACT 1 PHONE
        # ---------------------------------------------
 
        if step == "ask_c1_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contact1_phone",
                "confirm_c1_phone"
            )
 
        # ---------------------------------------------
        # CONTACT 1 PHONE CONFIRM
        # ---------------------------------------------
 
        if step == "confirm_c1_phone":
 
            if contains_any(
                cmd,
                YES_WORDS
            ):
 
                session_state["c1_phone"] = (
                    session_state.get(
                        "temp_phone",
                        ""
                    )
                )
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ask_c2_name"
 
                return reply(
                    "Confirmed. Now say the name of your second emergency contact.",
                    session_state,
                    "fill_and_listen",
                    target="contact1_phone",
                    val=session_state["c1_phone"]
                )
 
            if contains_any(
                cmd,
                NO_WORDS
            ):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ask_c1_phone"
 
                return reply(
                    "Okay, please say the number again.",
                    session_state,
                    "fill_and_listen",
                    target="contact1_phone",
                    val=""
                )
 
            return reply(
                "Please say yes or no.",
                session_state
            )
 
        # ---------------------------------------------
        # CONTACT 2 NAME
        # ---------------------------------------------
 
        if step == "ask_c2_name":
 
            name = clean_name(cmd)
 
            if not name:
 
                return reply(
                    "I did not catch that. "
                    "Please say the name of your second emergency contact.",
                    session_state
                )
 
            session_state["contact2_name"] = name
            session_state["step"] = "ask_c2_phone"
            session_state["digits"] = ""
 
            return reply(
                f"Now say the phone number of {name}. "
                "You can say a few digits at a time.",
                session_state,
                "fill_and_listen",
                target="contact2_name",
                val=name
            )
 
        # ---------------------------------------------
        # CONTACT 2 PHONE
        # ---------------------------------------------
 
        if step == "ask_c2_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contact2_phone",
                "confirm_c2_phone"
            )
 
        # ---------------------------------------------
        # CONTACT 2 PHONE CONFIRM
        # ---------------------------------------------
 
        if step == "confirm_c2_phone":
 
            if contains_any(
                cmd,
                YES_WORDS
            ):
 
                session_state["contact2_phone"] = (
                    session_state.get(
                        "temp_phone",
                        ""
                    )
                )
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
 
                session_state["step"] = "awaiting_contacts_done"
 
                return reply(
                    "Both emergency contacts are ready. "
                    "Say Done to save them.",
                    session_state
                )
 
            if contains_any(
                cmd,
                NO_WORDS
            ):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ask_c2_phone"
 
                return reply(
                    "Okay, please say the number again.",
                    session_state,
                    "fill_and_listen",
                    target="contact2_phone",
                    val=""
                )
 
            return reply(
                "Please say yes or no.",
                session_state
            )
 
        # ---------------------------------------------
        # WAIT FOR DONE
        # ---------------------------------------------
 
        if step == "awaiting_contacts_done":
 
            if contains_any(
                cmd,
                DONE_WORDS
            ):
 
                contact1_name = session_state.get(
                    "contact1_name",
                    ""
                )
 
                contact1_phone = session_state.get(
                    "c1_phone",
                    ""
                )
 
                contact2_name = session_state.get(
                    "contact2_name",
                    ""
                )
 
                contact2_phone = session_state.get(
                    "contact2_phone",
                    ""
                )
 
                if not all([
                    contact1_name,
                    contact1_phone,
                    contact2_name,
                    contact2_phone
                ]):
 
                    return reply(
                        "Some contact details are missing. "
                        "Please start again.",
                        session_state
                    )
 
                if contact1_phone == contact2_phone:
 
                    session_state["step"] = "ask_c2_phone"
                    session_state["digits"] = ""
 
                    return reply(
                        "Both contacts have the same number. "
                        "Please say a different number for the second contact.",
                        session_state,
                        "fill_and_listen",
                        target="contact2_phone",
                        val=""
                    )
 
                session_state["step"] = "idle"
 
                return reply(
                    "Saving your emergency contacts now.",
                    session_state,
                    "save_emergency_contacts",
                    contacts=[
                        {
                            "name": contact1_name,
                            "phone": contact1_phone
                        },
                        {
                            "name": contact2_name,
                            "phone": contact2_phone
                        }
                    ]
                )
 
            return reply(
                "Your contacts are ready. "
                "Please say Done when you want to save them.",
                session_state
            )
 
        # ---------------------------------------------
        # KNOWN USER
        # ---------------------------------------------
 
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
                    "Okay, let's create a new account. "
                    "Please say your name.",
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
                    "Logging you in.",
                    session_state,
                    "page_action",
                    target="continueBtn"
                )
 
            return reply(
                "Please say continue or new account.",
                session_state
            )
 
    # =================================================
    # 5. CHANGE EMERGENCY CONTACTS
    # =================================================
 
    # ---------------------------------------------
    # OPEN EMERGENCY CONTACTS PAGE
    # ---------------------------------------------
 
    if (
        is_active
        and step == "idle"
        and current_page not in (
            "/login",
            "/change-guardian"
        )
        and contains_any(
            cmd,
            CHANGE_NUMBER_PHRASES
        )
    ):
 
        session_state["step"] = "ec_ask_c1_name"
        session_state["digits"] = ""
        session_state["temp_phone"] = ""
 
        return reply(
            "Opening emergency contacts. "
            "Please say the name of your first emergency contact.",
            session_state,
            "navigate",
            url="/change-guardian"
        )
 
    # ---------------------------------------------
    # EMERGENCY CONTACT PAGE
    # ---------------------------------------------
 
    if current_page == "/change-guardian" and is_active:
 
        # -----------------------------------------
        # CANCEL / BACK
        # -----------------------------------------
 
        if contains_any(
            cmd,
            [
                "cancel",
                "go back",
                "back",
                "never mind",
                "nevermind"
            ]
        ):
 
            session_state["step"] = "idle"
            session_state["digits"] = ""
            session_state["temp_phone"] = ""
 
            return reply(
                "Okay, going back to settings.",
                session_state,
                "navigate",
                url="/setting"
            )
 
        # -----------------------------------------
        # CONTACT 1 NAME
        # -----------------------------------------
 
        if step == "ec_ask_c1_name":
 
            name = clean_name(cmd)
 
            if not name:
 
                return reply(
                    "I did not catch that. "
                    "Please say the name of your first emergency contact.",
                    session_state
                )
 
            session_state["contact1_name"] = name
            session_state["step"] = "ec_ask_c1_phone"
            session_state["digits"] = ""
 
            return reply(
                f"Contact 1 is {name}. "
                f"Now say the phone number of {name}.",
                session_state,
                "fill_and_listen",
                target="contactName1",
                val=name
            )
 
        # -----------------------------------------
        # CONTACT 1 PHONE
        # -----------------------------------------
 
        if step == "ec_ask_c1_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contactPhone1",
                "ec_confirm_c1_phone"
            )
 
        # -----------------------------------------
        # CONTACT 1 PHONE CONFIRM
        # -----------------------------------------
 
        if step == "ec_confirm_c1_phone":
 
            if contains_any(
                cmd,
                YES_WORDS
            ):
 
                session_state["c1_phone"] = (
                    session_state.get(
                        "temp_phone",
                        ""
                    )
                )
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ec_ask_c2_name"
 
                return reply(
                    "Contact 1 is confirmed. "
                    "Now say the name of your second emergency contact.",
                    session_state,
                    "fill_and_listen",
                    target="contactPhone1",
                    val=session_state["c1_phone"]
                )
 
            if contains_any(
                cmd,
                NO_WORDS
            ):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ec_ask_c1_phone"
 
                return reply(
                    "Okay, please say Contact 1 phone number again.",
                    session_state,
                    "fill_and_listen",
                    target="contactPhone1",
                    val=""
                )
 
            return reply(
                "Please say yes or no.",
                session_state
            )
 
        # -----------------------------------------
        # CONTACT 2 NAME
        # -----------------------------------------
 
        if step == "ec_ask_c2_name":
 
            name = clean_name(cmd)
 
            if not name:
 
                return reply(
                    "I did not catch that. "
                    "Please say the name of your second emergency contact.",
                    session_state
                )
 
            session_state["contact2_name"] = name
            session_state["step"] = "ec_ask_c2_phone"
            session_state["digits"] = ""
 
            return reply(
                f"Contact 2 is {name}. "
                f"Now say the phone number of {name}.",
                session_state,
                "fill_and_listen",
                target="contactName2",
                val=name
            )
 
        # -----------------------------------------
        # CONTACT 2 PHONE
        # -----------------------------------------
 
        if step == "ec_ask_c2_phone":
 
            return collect_phone(
                cmd,
                session_state,
                "contactPhone2",
                "ec_confirm_c2_phone"
            )
 
        # -----------------------------------------
        # CONTACT 2 PHONE CONFIRM
        # -----------------------------------------
 
        if step == "ec_confirm_c2_phone":
 
            if contains_any(
                cmd,
                YES_WORDS
            ):
 
                session_state["contact2_phone"] = (
                    session_state.get(
                        "temp_phone",
                        ""
                    )
                )
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
 
                session_state["step"] = "ec_awaiting_done"
 
                return reply(
                    "Both emergency contacts are ready. "
                    "Say Done to save them.",
                    session_state
                )
 
            if contains_any(
                cmd,
                NO_WORDS
            ):
 
                session_state["digits"] = ""
                session_state["temp_phone"] = ""
                session_state["step"] = "ec_ask_c2_phone"
 
                return reply(
                    "Okay, please say Contact 2 phone number again.",
                    session_state,
                    "fill_and_listen",
                    target="contactPhone2",
                    val=""
                )
 
            return reply(
                "Please say yes or no.",
                session_state
            )
 
        # -----------------------------------------
        # WAIT FOR DONE
        # -----------------------------------------
 
        if step == "ec_awaiting_done":
 
            if contains_any(
                cmd,
                DONE_WORDS
            ):
 
                contact1_name = session_state.get(
                    "contact1_name",
                    ""
                )
 
                contact1_phone = session_state.get(
                    "c1_phone",
                    ""
                )
 
                contact2_name = session_state.get(
                    "contact2_name",
                    ""
                )
 
                contact2_phone = session_state.get(
                    "contact2_phone",
                    ""
                )
 
                # Validate
                if not all([
                    contact1_name,
                    contact1_phone,
                    contact2_name,
                    contact2_phone
                ]):
 
                    return reply(
                        "Some contact details are missing. "
                        "Please start again.",
                        session_state
                    )
 
                # Same number check
                if contact1_phone == contact2_phone:
 
                    session_state["step"] = "ec_ask_c2_phone"
                    session_state["digits"] = ""
 
                    return reply(
                        "Both contacts have the same number. "
                        "Please say a different number for Contact 2.",
                        session_state,
                        "fill_and_listen",
                        target="contactPhone2",
                        val=""
                    )
 
                # ---------------------------------
                # DO NOT SAVE IN PYTHON.
                # JS will call Node API.
                # ---------------------------------
 
                session_state["step"] = "idle"
 
                return reply(
                    "Saving your emergency contacts now.",
                    session_state,
                    "save_emergency_contacts",
                    contacts=[
                        {
                            "name": contact1_name,
                            "phone": contact1_phone
                        },
                        {
                            "name": contact2_name,
                            "phone": contact2_phone
                        }
                    ]
                )
 
            return reply(
                "Your contacts are ready. "
                "Please say Done when you want to save them.",
                session_state
            )
 
    # =================================================
    # 6. DESTINATION FLOW
    # =================================================
 
    if (
        step == "awaiting_destination"
        and is_active
    ):
 
        session_state["step"] = "idle"
 
        if contains_any(
            cmd,
            [
                "cancel",
                "never mind",
                "nevermind"
            ]
        ):
 
            return jsonify({
                "success": True,
                "action": "speak_only",
                "message": "Okay, canceled.",
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
            "message": (
                f"Opening walking directions to {destination}."
            ),
            "session_state": session_state,
            "is_active": True
        })
 
    # =================================================
    # 7. CALL TARGET FLOW
    # =================================================
 
    if (
        step == "awaiting_call_target"
        and is_active
    ):
 
        session_state["step"] = "idle"
 
        if contains_any(
            cmd,
            [
                "cancel",
                "never mind",
                "nevermind"
            ]
        ):
 
            return jsonify({
                "success": True,
                "action": "speak_only",
                "message": "Okay, canceled.",
                "session_state": session_state,
                "is_active": True
            })
 
        return phone_call_response(
            extract_call_target(cmd),
            session_state
        )
 
    # =================================================
    # 8. CALL COMMAND
    # =================================================
 
    if contains_any(
        cmd,
        [
            "call",
            "dial",
            "make a call"
        ]
    ):
 
        target = extract_call_target(cmd)
 
        if is_mobile:
 
            if target == "":
 
                session_state["step"] = "awaiting_call_target"
 
                return jsonify({
                    "success": True,
                    "action": "speak_and_listen",
                    "message": "Who do you want to call?",
                    "session_state": session_state,
                    "is_active": True
                })
 
            return phone_call_response(
                target,
                session_state
            )
 
        url = (
            "/call"
            + (f"?to={quote(target)}" if target else "")
        )
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": url,
            "message": "Starting voice call.",
            "is_active": True
        })
 
    # =================================================
    # 9. SOS COMMAND
    # =================================================
 
    if contains_any(
        cmd,
        SOS_WORDS
    ):
 
        if current_page == "/sos":
 
            return jsonify({
                "success": True,
                "action": "page_action",
                "target": "sosBtn",
                "message": "Triggering SOS.",
                "is_active": True
            })
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/sos",
            "message": "Opening emergency SOS.",
            "is_active": True
        })
 
    # =================================================
    # 10. HELP COMMAND
    # =================================================
 
    if contains_any(
        cmd,
        help_words
    ):
 
        return jsonify({
            "success": True,
            "action": "speak_only",
            "message": (
                "You can say: open navigation, "
                "read document, summarize document, "
                "where am I, emergency SOS, "
                "call one of your contacts by name, "
                "call police, change emergency contacts, "
                "go home, or go back."
            ),
            "is_active": True
        })
 
    # =================================================
    # 11. GO BACK
    # =================================================
 
    if contains_any(
        cmd,
        [
            "go back",
            "back",
            "previous screen",
            "return"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "history_back",
            "message": "Going back.",
            "is_active": True
        })
 
    # =================================================
    # 12. HOME
    # =================================================
 
    if contains_any(
        cmd,
        [
            "home",
            "dashboard",
            "main menu"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/home",
            "message": "Opening Home dashboard.",
            "is_active": True
        })
 
    # =================================================
    # 13A. NAVIGATION CAMERA
    # IMPORTANT: ye "13. SMART NAVIGATION" se PEHLE hona chahiye.
    # Pehle ye neeche tha, isliye "start navigation camera" / "start walking"
    # jaise commands 13 mein match ho jaate the (jo sirf /Snavigation kholta hai,
    # camera nahi) aur camera on nahi hota tha.
    # =================================================
 
    if (
        current_page == "/Snavigation"
        and contains_any(
            cmd,
            [
                "start camera",
                "open camera",
                "turn on camera",
                "camera on",
                "activate camera",
                "start navigation camera",
                "navigation camera",
                "start detection",
                "start navigation",
                "start walking"
            ]
        )
    ):
        return jsonify({
            "success": True,
            "action": "start_navigation_camera",
            "message": "Starting navigation camera.",
            "is_active": True
        })
 
    # =================================================
    # 13. SMART NAVIGATION
    # =================================================
 
    if contains_any(
        cmd,
        [
            "navigation",
            "smart navigation",
            "start walking",
            "navigate"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/Snavigation",
            "message": "Opening smart navigation.",
            "is_active": True
        })
 
    # =================================================
    # 13B. DOCUMENT CAMERA
    # =================================================
 
    if (
        current_page == "/documentR"
        and contains_any(
            cmd,
            [
                "open camera",
                "start camera",
                "open document camera",
                "document camera",
                "scan document"
            ]
        )
    ):
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/documentR?camera=true",
            "message": "Opening document camera.",
            "is_active": True
        })
 
    # =================================================
    # 14. DOCUMENT READER
    # =================================================
 
    if contains_any(
        cmd,
        [
            "document reader",
            "open document reader",
            "open document"
        ]
    ):
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/documentR",
            "message": "Opening document reader.",
            "is_active": True
        })
 
    if (
        current_page == "/documentR"
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
            "message": "Reading the document.",
            "is_active": True
        })
 
    # =================================================
    # 16. LOCATION
    # =================================================
 
    if contains_any(
        cmd,
        [
            "location",
            "where am i",
            "my location",
            "gps"
        ]
    ):
 
        if is_mobile:
 
            session_state["step"] = "awaiting_destination"
 
            return jsonify({
                "success": True,
                "action": "speak_and_listen",
                "message": "Where do you want to go?",
                "session_state": session_state,
                "is_active": True
            })
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/location",
            "message": "Fetching your walking location.",
            "is_active": True
        })
 
    # =================================================
    # 17. SETTINGS
    # =================================================
 
    if contains_any(
        cmd,
        [
            "settings",
            "setting",
            "preferences",
            "app settings"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/setting",
            "message": "Opening settings.",
            "is_active": True
        })
 
    # =================================================
    # 18. PROFILE
    # =================================================
 
    if contains_any(
        cmd,
        [
            "profile",
            "my account",
            "user profile"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "navigate",
            "url": "/profile",
            "message": "Opening profile.",
            "is_active": True
        })
 
    # =================================================
    # 19. SCAN
    # =================================================
 
    if contains_any(
        cmd,
        [
            "scan",
            "take photo",
            "capture",
            "scan document"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "page_action",
            "target": "scanBtn",
            "message": "Opening camera.",
            "is_active": True
        })
 
    # =================================================
    # 20. UPLOAD
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
            "message": "Opening file browser.",
            "is_active": True
        })
 
    # =================================================
    # 21. READ ALOUD
    # =================================================
 
    if contains_any(
        cmd,
        [
            "read aloud",
            "read text",
            "play audio",
            "listen",
            "read it"
        ]
    ):
 
        return jsonify({
            "success": True,
            "action": "page_action",
            "target": "readAloudBtn",
            "message": "Reading extracted text.",
            "is_active": True
        })
 
    # =================================================
    # 22. UNKNOWN COMMAND
    # =================================================
 
    return jsonify({
        "success": True,
        "action": "unknown",
        "message": (
            "Sorry, I didn't recognize that command."
        ),
        "is_active": True
    })
 
 
# =====================================================
# START FLASK
# =====================================================
 
if __name__ == "__main__":

    cert = r"C:\mkcert\172.22.55.165+2.pem"
    key = r"C:\mkcert\172.22.55.165+2-key.pem"

    ssl = (cert, key) if os.path.exists(cert) and os.path.exists(key) else None

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False,
        threaded=True,
        ssl_context=ssl
    )
 