import os
import re
import json
import subprocess
import difflib
 
# navigation.py se wahi speak() aur listen_once() reuse kar rahe hain
# (calling.py aur navigation.py ek hi folder mein rakho)
from navigation import speak, listen_once
 
 
# =====================================================
# SETTINGS
# =====================================================
 
# "phonelink" -> Windows Phone Link / default tel: app mein number khulta hai
# "adb"       -> Android phone USB se juda ho to seedha call laga deta hai
CALL_METHOD = "phonelink"
 
# Is user ke 2 contacts Node (server.js) MongoDB se bhejta hai:
# CONTACTS_JSON = [{"name": "Mom", "phone": "919XXXXXXXXX"}, {"name": "Dad", "phone": "..."}]
CONTACTS = {}
 
try:
    _items = json.loads(os.environ.get("CONTACTS_JSON", "") or "[]")
except ValueError:
    _items = []
 
_ALIASES = [
    ["guardian", "emergency contact", "contact one", "contact 1", "first contact"],
    ["contact two", "contact 2", "second contact"],
]
 
for _i, _item in enumerate(_items[:2]):
    _phone = str(_item.get("phone", "")).strip().lstrip("+")
    if not _phone:
        continue
    _phone = "+" + _phone
    _name = str(_item.get("name", "")).lower().strip()
    if _name:
        CONTACTS[_name] = _phone
    for _alias in _ALIASES[_i]:
        CONTACTS.setdefault(_alias, _phone)
 
# Emergency numbers: inko bina confirmation ke turant call hota hai
EMERGENCY = {
    "police": "100",
    "ambulance": "102",
    "emergency": "112",
    "women helpline": "1091",
}
 
 
# =====================================================
# NAME MATCHING
# =====================================================
 
def find_contact(spoken_name):
    """Bola hua naam contacts ya emergency list se match karta hai."""
    spoken_name = spoken_name.lower().strip()
 
    # 1) Pehle exact match
    if spoken_name in CONTACTS:
        return spoken_name, CONTACTS[spoken_name], False
    if spoken_name in EMERGENCY:
        return spoken_name, EMERGENCY[spoken_name], True
 
    # 2) Phir thoda galat bola ho to fuzzy match.
    #    Emergency numbers par cutoff zyada hai, taaki
    #    "emergency contact" galti se 112 na ban jaye.
    match = difflib.get_close_matches(
        spoken_name, CONTACTS.keys(), n=1, cutoff=0.6
    )
    if match:
        return match[0], CONTACTS[match[0]], False
 
    match = difflib.get_close_matches(
        spoken_name, EMERGENCY.keys(), n=1, cutoff=0.8
    )
    if match:
        return match[0], EMERGENCY[match[0]], True
 
    return None, None, False
 
 
def extract_name(command):
    """'call mom' / 'phone mom ko' / 'mom ko call karo' se naam nikalta hai."""
    command = command.lower()
    command = re.sub(r"\b(please|ko|karo|kar do|now|to)\b", " ", command)
    command = re.sub(r"\b(call|phone|dial|ring)\b", " ", command)
    return " ".join(command.split())
 
 
# =====================================================
# PLACE THE CALL
# =====================================================
 
def place_call(number):
    number = number.replace(" ", "")
 
    if CALL_METHOD == "adb":
        try:
            subprocess.run(
                ["adb", "shell", "am", "start",
                 "-a", "android.intent.action.CALL",
                 "-d", f"tel:{number}"],
                check=True,
            )
            return True
        except Exception as error:
            print("❌ ADB call failed:", error)
            return False
 
    # phonelink
    try:
        os.startfile(f"tel:{number}")
        return True
    except Exception as error:
        print("❌ tel: launch failed:", error)
        return False
 
 
# =====================================================
# VOICE CALL FLOW
# =====================================================
 
def confirm(question):
    speak(question)
    answer = listen_once()
    if answer in (None, "MIC_ERROR", "NET_ERROR"):
        return False
    answer = answer.lower()
    return any(
        word in answer
        for word in ("yes", "yeah", "haan", "ha", "confirm", "ok")
    )
 
 
def start_voice_call():
 
    print("================================")
    print("📞 VOICE CALL STARTED")
    print("================================")
 
    # Agar user ne pehle hi bol diya ("call mom"), to wahi naam use karo
    target = os.environ.get("CALL_TARGET", "").strip()
 
    if target:
        name_text = extract_name(target)
    else:
        speak("Who do you want to call?")
        heard = listen_once()
 
        if heard in (None, "MIC_ERROR", "NET_ERROR"):
            speak("I did not catch that. Call canceled.")
            return
 
        name_text = extract_name(heard)
 
    name, number, is_emergency = find_contact(name_text)
 
    if not name:
        speak(f"I could not find {name_text} in your contacts.")
        return
 
    # Normal contact par confirm, emergency par turant call
    if not is_emergency:
        if not confirm(f"Calling {name}. Say yes to confirm."):
            speak("Call canceled.")
            return
    else:
        speak(f"Calling {name} now.")
 
    print(f"📞 Calling {name}: {number}")
 
    if not place_call(number):
        speak("I could not place the call.")
        print("❌ Dial manually:", number)
 
 
# =====================================================
# START PROGRAM
# =====================================================
 
if __name__ == "__main__":
    start_voice_call()
 