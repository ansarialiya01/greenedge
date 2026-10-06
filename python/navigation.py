import os
import subprocess
import webbrowser
import urllib.parse
import speech_recognition as sr
import pyttsx3
 
 
# =====================================================
# SETTINGS
# =====================================================
 
MIC_INDEX = 1          # Microphone Array (AMD Audio Device)
MAX_ATTEMPTS = 3       # kitni baar destination poochni hai
LISTEN_TIMEOUT = 10    # bolna shuru karne ke liye kitne second wait kare
PHRASE_LIMIT = 8       # ek baar mein max kitni der bol sakte ho
 
 
# =====================================================
# TEXT TO SPEECH
# =====================================================
 
def speak(text):
    print(f"System: {text}")
 
    # Har baar naya engine: pyttsx3 ka runAndWait() dobara
    # use karne par kabhi kabhi chup ho jata hai
    try:
        engine = pyttsx3.init()
        engine.say(text)
        engine.runAndWait()
        engine.stop()
    except Exception as error:
        print("❌ Speech error:", error)
 
 
# =====================================================
# LISTEN ONCE
# =====================================================
 
def listen_once():
    """
    Ek baar sunta hai. Text return karta hai, ya None.
    Mic tabhi khulta hai jab speaker bolna khatam kar chuka ho.
    """
 
    recognizer = sr.Recognizer()
 
    # Dynamic threshold on rakho taaki halki awaaz bhi pakdi jaye
    recognizer.dynamic_energy_threshold = True
    recognizer.pause_threshold = 1.0
 
    try:
        with sr.Microphone(device_index=MIC_INDEX) as source:
 
            print("🎤 Microphone opened")
 
            print("🎤 Adjusting for background noise...")
            recognizer.adjust_for_ambient_noise(source, duration=1)
 
            # Threshold bahut upar chala gaya ho to neeche laao
            print("🎤 Energy threshold:", recognizer.energy_threshold)
            if recognizer.energy_threshold > 600:
                recognizer.energy_threshold = 400
                print("🎤 Threshold reset to 400")
 
            print("🎤 Listening... (ab bolo)")
 
            audio = recognizer.listen(
                source,
                timeout=LISTEN_TIMEOUT,
                phrase_time_limit=PHRASE_LIMIT
            )
 
    except sr.WaitTimeoutError:
        print("⚠️ Nothing heard (timeout)")
        return None
 
    except OSError as error:
        print("❌ Microphone error:", error)
        speak("I cannot access the microphone.")
        return "MIC_ERROR"
 
    print("🎤 Audio captured, recognizing...")
 
    try:
        text = recognizer.recognize_google(audio)
        print("DESTINATION HEARD:", text)
        return text
 
    except sr.UnknownValueError:
        print("⚠️ Could not understand audio")
        return None
 
    except sr.RequestError as error:
        print("❌ Speech service error:", error)
        speak(
            "My speech recognition service is unavailable. "
            "Please check your internet connection."
        )
        return "NET_ERROR"
 
 
# =====================================================
# LISTEN FOR DESTINATION (with retries)
# =====================================================
 
def listen_for_destination():
 
    for attempt in range(1, MAX_ATTEMPTS + 1):
 
        if attempt == 1:
            speak("Please state your destination clearly.")
        else:
            speak("I did not catch that. Please say your destination again.")
 
        result = listen_once()
 
        if result in ("MIC_ERROR", "NET_ERROR"):
            return None
 
        if result:
            speak(f"Setting destination to {result}.")
            return result
 
    speak("I could not hear a destination. Navigation canceled.")
    return None
 
 
# =====================================================
# OPEN URL IN BROWSER (3 methods, one after another)
# =====================================================
 
def open_url(url):
 
    # Method 1: Windows default browser (sabse reliable)
    try:
        os.startfile(url)
        print("✅ Opened using os.startfile")
        return True
    except Exception as error:
        print("⚠️ os.startfile failed:", error)
 
    # Method 2: webbrowser module
    try:
        result = webbrowser.open(url)
        print("webbrowser.open returned:", result)
        if result:
            return True
    except Exception as error:
        print("⚠️ webbrowser failed:", error)
 
    # Method 3: Chrome directly via cmd
    try:
        subprocess.Popen(
            ["cmd", "/c", "start", "", "chrome", url],
            shell=False
        )
        print("✅ Opened using Chrome via cmd")
        return True
    except Exception as error:
        print("⚠️ Chrome launch failed:", error)
 
    return False
 
 
# =====================================================
# START NAVIGATION
# =====================================================
 
def start_voice_navigation():
 
    print("================================")
    print("🚗 VOICE NAVIGATION STARTED")
    print("================================")
 
    destination = listen_for_destination()
 
    if not destination:
        return
 
    speak(
        "Calculating the best walking route "
        "from your current location."
    )
 
    encoded_destination = urllib.parse.quote(destination)
 
    google_maps_url = (
        "https://www.google.com/maps/dir/?api=1"
        f"&destination={encoded_destination}"
        "&travelmode=walking"
        "&dir_action=navigate"
    )
 
    print("🌍 Opening Google Maps...")
    print("Destination:", destination)
    print("URL:", google_maps_url)
 
    speak("Opening Google Maps.")
 
    if not open_url(google_maps_url):
        speak("I could not open the browser.")
        print("❌ Open this link manually:", google_maps_url)
 
 
# =====================================================
# START PROGRAM
# =====================================================
 
if __name__ == "__main__":
 
    print("================================")
    print("🚗 Navigation Assistant")
    print("================================")
 
    start_voice_navigation()
 