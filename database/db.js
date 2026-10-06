const express = require("express");
const https = require("https");
const fs = require("fs");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { connectDB, users } = require("./database/db");
const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config();
 
 
console.log("WHATSAPP_PHONE_NUMBER_ID:", process.env.WHATSAPP_PHONE_NUMBER_ID);
console.log("WHATSAPP_ACCESS_TOKEN exists:", !!process.env.WHATSAPP_ACCESS_TOKEN);
 
const app = express();
 
// Host (Render etc.) ke proxy ke peeche HTTPS/cookies sahi chalein
app.set("trust proxy", 1);
 
// Host PORT env deta hai; laptop par 3000
const PORT = process.env.PORT || 3000;
 
// WhatsApp template settings (Meta mein jo naam aur language banayi thi)
const SOS_TEMPLATE_NAME = "emergency_sos_alert";
const SOS_TEMPLATE_LANGUAGE = "en_US";
 
// Live tracking: contacts ko jo link jayega uska public base URL.
// .env mein likho, jaise: PUBLIC_BASE_URL=https://abc123.trycloudflare.com
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
 
// Tracking link itne ghante baad apne aap band ho jata hai
const TRACKING_MAX_HOURS = 6;
 
// =====================================================
// HTTPS SSL CERTIFICATE
// Laptop par mkcert files mil jayein to HTTPS server chalega.
// Server (host) par ye files nahi hoti: tab normal HTTP server chalega
// aur host khud HTTPS lagata hai.
// =====================================================
 
let sslOptions = null;
 
try {
    sslOptions = {
        key: fs.readFileSync("C:\\mkcert\\172.22.55.165+2-key.pem"),
        cert: fs.readFileSync("C:\\mkcert\\172.22.55.165+2.pem")
    };
}
catch (error) {
    console.log("mkcert files nahi mili: normal HTTP server chalega (host HTTPS khud lagata hai).");
}
 
 
// =====================================================
// MIDDLEWARE
// =====================================================
 
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
 
app.use(
    session({
        secret: process.env.SESSION_SECRET || "greenedge-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60
        }
    })
);
 
app.use(cookieParser(process.env.SESSION_SECRET || "greenedge-secret"));
 
app.set("view engine", "ejs");
app.use(express.static("public"));
 
// =====================================================
// DEVICE YAAD RAKHNA (bina ID / password ke)
// Naya user banne par browser mein ek signed cookie lagti hai.
// Agli baar server cookie se user pehchan leta hai.
// =====================================================
 
const COOKIE_NAME = "ge_user";
 
const COOKIE_OPTIONS = {
    signed: true,
    httpOnly: true,
    secure: true,
    sameSite: "lax"
};
 
function setUserCookie(res, userId) {
    res.cookie(COOKIE_NAME, userId, {
        ...COOKIE_OPTIONS,
        maxAge: 1000 * 60 * 60 * 24 * 365
    });
}
 
// Session khatam ho gaya par cookie hai to session wapas bana do
app.use(async (req, res, next) => {
 
    if (!req.session.userId && req.signedCookies && req.signedCookies[COOKIE_NAME]) {
 
        try {
 
            const user = await users().findOne(
                { userId: req.signedCookies[COOKIE_NAME] },
                { projection: { userId: 1, name: 1 } }
            );
 
            if (user) {
                req.session.userId = user.userId;
                req.session.userName = user.name;
            }
 
        }
        catch (error) {
            console.error("Cookie login error:", error.message);
        }
    }
 
    next();
});
 
// =====================================================
// CHANGE EMERGENCY CONTACTS PAGE
// (cookie wale middleware ke BAAD rakha hai, taaki session
//  khatam hone par bhi cookie se user pehchana jaye)
// =====================================================
 
app.get(["/change-contact", "/change-guardian"], (req, res) => {
    if (!req.session.userId) return res.redirect("/login");
    res.render("change_contact");
});
 
// =====================================================
// VOICE ASSISTANT PROXY (Browser -> Node -> Flask)
// voice_assistance.py port 5001 par chalti hai
// (5000 par object_detection.py hai, dono ek port par nahi chal sakte)
// =====================================================
 
const VOICE_PY_URL = process.env.VOICE_PY_URL || "http://127.0.0.1:5001/voice";
 
console.log("Voice service URL:", VOICE_PY_URL);
 
app.post("/api/voice-command", async (req, res) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
 
    try {
        const response = await fetch(VOICE_PY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
            signal: controller.signal
        });
 
        const data = await response.json();
        return res.status(response.status).json(data);
    }
    catch (error) {
        // error.cause mein asli wajah hoti hai (jaise ECONNREFUSED)
        console.error(
            "❌ Voice service error:",
            error.message,
            "| URL:", VOICE_PY_URL,
            "| Cause:", error.cause ? (error.cause.code || error.cause.message) : "none"
        );
        return res.status(502).json({
            success: false,
            action: "none",
            message: "Voice service is not running.",
            is_active: false
        });
    }
    finally {
        clearTimeout(timer);
    }
});
 
// =====================================================
// HELPERS
// =====================================================
 
// 9503791496 -> 919503791496
function normalizeIndianNumber(phone) {
 
    const cleanPhone = String(phone || "").replace(/\D/g, "");
 
    if (cleanPhone.length === 10) {
        return "91" + cleanPhone;
    }
 
    if (cleanPhone.length === 11 && cleanPhone.startsWith("0")) {
        return "91" + cleanPhone.substring(1);
    }
 
    return cleanPhone;
}
 
// User ke 2 contacts: [{ name, phone }] (sirf valid numbers wale)
function getContacts(user) {
    return (user.contacts || [])
        .map(c => ({
            name: String(c.name || "").trim(),
            phone: normalizeIndianNumber(c.phone)
        }))
        .filter(c => c.phone.length >= 11);
}
 
// =====================================================
// WHATSAPP CLOUD API: TEMPLATE MESSAGE
// =====================================================
 
async function sendWhatsAppMessage(
    to,
    templateName,
    languageCode = "en_US",
    parameters = []
) {
 
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
 
    if (!phoneNumberId) {
        throw new Error("WHATSAPP_PHONE_NUMBER_ID is missing in .env");
    }
 
    if (!accessToken) {
        throw new Error("WHATSAPP_ACCESS_TOKEN is missing in .env");
    }
 
    const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;
 
    const requestBody = {
        messaging_product: "whatsapp",
        to: String(to).replace(/\D/g, ""),
        type: "template",
        template: {
            name: templateName,
            language: { code: languageCode }
        }
    };
 
    // Template parameters ({{1}}, {{2}}, {{3}} ...)
    if (parameters.length > 0) {
        requestBody.template.components = [
            {
                type: "body",
                parameters: parameters.map(value => ({
                    type: "text",
                    text: String(value)
                }))
            }
        ];
    }
 
    console.log("📤 WhatsApp Message Request:", JSON.stringify(requestBody, null, 2));
 
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });
 
    const data = await response.json();
 
    console.log("📩 WhatsApp Message Response:", JSON.stringify(data, null, 2));
 
    if (!response.ok) {
        throw new Error(data?.error?.message || "WhatsApp message failed.");
    }
 
    return data;
}
 
// =====================================================
// WHATSAPP CLOUD API: LOCATION PIN
// (sirf tab jata hai jab contact ne pichle 24 ghante
//  mein reply kiya ho, warna fail hona normal hai)
// =====================================================
 
async function sendWhatsAppLocation(to, latitude, longitude) {
 
    const url =
        `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
 
    const requestBody = {
        messaging_product: "whatsapp",
        to: normalizeIndianNumber(to),
        type: "location",
        location: {
            latitude: Number(latitude),
            longitude: Number(longitude)
        }
    };
 
    console.log("📍 WHATSAPP LOCATION REQUEST:", JSON.stringify(requestBody, null, 2));
 
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });
 
    const data = await response.json();
 
    console.log("📍 WHATSAPP LOCATION RESPONSE:", JSON.stringify(data, null, 2));
 
    if (!response.ok) {
        throw new Error(data?.error?.message || "WhatsApp location failed.");
    }
 
    return data;
}
 
// =====================================================
// TEST WHATSAPP (emergency_sos_alert template)
// =====================================================
 
app.get("/test-whatsapp", async (req, res) => {
 
    try {
 
        const result = await sendWhatsAppMessage(
            "919503791496",
            SOS_TEMPLATE_NAME,
            SOS_TEMPLATE_LANGUAGE,
            [
                "Test User",
                "+919999999999",
                "https://www.google.com/maps?q=21.1458,79.0882"
            ]
        );
 
        return res.json({
            success: true,
            message: "WhatsApp message sent successfully.",
            result: result
        });
 
    }
    catch (error) {
 
        console.error("❌ Test WhatsApp failed:", error);
 
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});
 
// =====================================================
// HOME / PUBLIC ROUTES
// =====================================================
 
app.get("/", (req, res) => {
    res.render("splash");
});
 
// 8 digit ka unique ID database khud banata hai (user ko dikhta nahi).
// Unique index ki wajah se duplicate kabhi insert nahi hota; takra jaye to nayi ID try hoti hai.
async function createUser(name, contacts) {
 
    for (let attempt = 0; attempt < 10; attempt++) {
 
        const userId = String(crypto.randomInt(10000000, 100000000));
 
        try {
 
            await users().insertOne({
                userId: userId,
                name: name,
                contacts: contacts,
                createdAt: new Date()
            });
 
            return userId;
 
        }
        catch (error) {
 
            if (error.code !== 11000) throw error;
        }
    }
 
    throw new Error("Could not generate a unique user ID.");
}
 
// Form se aaye 2 contacts check karta hai
function readContacts(body) {
 
    const raw = [
        body.contact1_name,
        body.contact1_phone,
        body.contact2_name,
        body.contact2_phone
    ].map(v => String(v || "").trim());
 
    const provided = raw.some(v => v !== "");
 
    const contacts = [
        { name: raw[0], phone: normalizeIndianNumber(raw[1]) },
        { name: raw[2], phone: normalizeIndianNumber(raw[3]) }
    ];
 
    let error = null;
 
    if (contacts.some(c => !c.name || c.phone.length < 11)) {
        error = "Please enter name and a valid number for both contacts.";
    }
    else if (contacts[0].phone === contacts[1].phone) {
        error = "The two contacts must have different numbers.";
    }
 
    return { provided, contacts, error };
}
 
// Login page: pehchana hua user ho to "Welcome back", warna naye user ka form
async function renderLogin(req, res, error) {
 
    let knownUser = null;
 
    if (req.session.userId) {
 
        try {
 
            const user = await users().findOne(
                { userId: req.session.userId },
                { projection: { name: 1 } }
            );
 
            if (user) knownUser = { name: user.name };
 
        }
        catch (err) {
            console.error("Login page DB error:", err.message);
        }
    }
 
    return res.render("login", { error: error || null, knownUser: knownUser });
}
 
app.get("/login", (req, res) => {
    renderLogin(req, res);
});
 
// "Not you?" - is device ko bhool jao, naya user banao
app.get("/switch-user", (req, res) => {
 
    res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
 
    req.session.destroy(() => {
        res.redirect("/login");
    });
});
 
// =====================================================
// LOGIN / SIGN-UP (ek hi page, bina password, bina ID)
// - Naya user: name + dono contacts compulsory, account ban jata hai
// - Pehchana hua user: bas CONTINUE; contacts bhare hon to update ho jate hain
// Form fields: name, contact1_name, contact1_phone,
//              contact2_name, contact2_phone
// =====================================================
 
app.post("/login", async (req, res) => {
 
    const { provided, contacts, error } = readContacts(req.body);
 
    try {
 
        // new_account=1: pehchana hua device hone par bhi bilkul naya account banao
        const forceNew = String(req.body.new_account || "") === "1";
 
        const known = (!forceNew && req.session.userId)
            ? await users().findOne({ userId: req.session.userId })
            : null;
 
        // ---------- pehchana hua user ----------
        if (known) {
 
            if (provided) {
 
                if (error) return renderLogin(req, res, error);
 
                const update = { contacts: contacts };
                const newName = String(req.body.name || "").trim();
                if (newName) update.name = newName;
 
                await users().updateOne({ userId: known.userId }, { $set: update });
            }
 
            setUserCookie(res, known.userId);
            return res.redirect("/home");
        }
 
        // ---------- naya user ----------
        const name = String(req.body.name || "").trim().slice(0, 60);
 
        if (!name) {
            return renderLogin(req, res, "Please enter your name.");
        }
 
        if (error) {
            return renderLogin(req, res, error);
        }
 
        const userId = await createUser(name, contacts);
 
        req.session.userId = userId;
        req.session.userName = name;
        setUserCookie(res, userId);
 
        console.log("🆕 New user created:", userId, name);
 
        return res.redirect("/home");
 
    }
    catch (err) {
 
        console.error("Login error:", err);
        return res.status(500).send("Server error");
    }
});
 
// =====================================================
// HOME
// =====================================================
 
app.get("/home", (req, res) => {
 
    if (!req.session.userId) {
        return res.redirect("/login");
    }
 
    res.render("home");
});
 
// =====================================================
// PASSWORD NAHI HAI, isliye forgot/reset pages band
// (purane links /login par bhej diye jaate hain)
// =====================================================
 
app.all(
    ["/forgot-password", "/verify-otp", "/reset-password"],
    (req, res) => {
        res.redirect("/login");
    }
);
 
// =====================================================
// REGISTER ab alag page nahi hai (login page par hi account ban jata hai)
// =====================================================
 
app.all("/register", (req, res) => {
    res.redirect("/login");
});
 
// =====================================================
// NAVIGATION & UI PAGES
// =====================================================
 
app.get("/setting", (req, res) => res.render("setting"));
app.get("/navigate", (req, res) => res.render("navigate"));
app.get("/profile", (req, res) => res.render("profile"));
app.get("/Snavigation", (req, res) => res.render("Snavigation"));
app.get("/documentR", (req, res) => res.render("documentR"));
app.get("/documentS", (req, res) => res.render("documentS"));
app.get("/navigate6", (req, res) => res.render("navigate6"));
 
// =====================================================
// SOS PAGE
// =====================================================
 
app.get("/sos", (req, res) => {
 
    if (!req.session.userId) {
        return res.redirect("/login");
    }
 
    res.render("sos");
});
 
// =====================================================
// UPDATE EMERGENCY CONTACTS
// =====================================================
 
app.post("/api/update-emergency-contacts", async (req, res) => {
 
    // Login check
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }
 
    const contacts = req.body.contacts;
 
    // Exactly 2 contacts required
    if (!Array.isArray(contacts) || contacts.length !== 2) {
        return res.status(400).json({
            success: false,
            message: "Please provide exactly 2 emergency contacts."
        });
    }
 
    // Validate contacts
    const cleanContacts = [];
 
    for (const contact of contacts) {
 
        const name = String(contact.name || "").trim();
 
        const phone = String(contact.phone || "")
            .replace(/\D/g, "");
 
        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Contact name is required."
            });
        }
 
        if (!/^\d{10}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Phone number must contain exactly 10 digits."
            });
        }
 
        cleanContacts.push({
            name: name,
            phone: phone
        });
    }
 
    // Prevent same number for both contacts
    if (cleanContacts[0].phone === cleanContacts[1].phone) {
        return res.status(400).json({
            success: false,
            message: "Both contacts must have different phone numbers."
        });
    }
 
    try {
 
        const result = await users().updateOne(
            {
                userId: req.session.userId
            },
            {
                $set: {
                    contacts: cleanContacts
                }
            }
        );
 
        if (!result.matchedCount) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }
 
        return res.json({
            success: true,
            message: "Emergency contacts updated successfully."
        });
 
    } catch (error) {
 
        console.error(
            "Update emergency contacts error:",
            error
        );
 
        return res.status(500).json({
            success: false,
            message: "Could not update emergency contacts."
        });
    }
});
 
// =====================================================
// GET EMERGENCY CONTACTS
// guardianName / guardianPhone = pehla contact
// (purana frontend code na toote isliye)
// =====================================================
 
app.get("/api/emergency-contact", async (req, res) => {
 
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }
 
    try {
 
        const user = await users().findOne({ userId: req.session.userId });
 
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }
 
        const contacts = getContacts(user);
 
        if (contacts.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Emergency contact not found."
            });
        }
 
        return res.json({
            success: true,
            guardianName: contacts[0].name,
            guardianPhone: contacts[0].phone,
            contacts: contacts
        });
 
    }
    catch (error) {
 
        console.error("Emergency contact DB error:", error);
 
        return res.status(500).json({
            success: false,
            message: "Database error."
        });
    }
});
 
// =====================================================
// LIVE TRACKING (guardian ko live map link)
// Sessions memory mein rehte hain (server restart par reset ho jaate hain)
// =====================================================
 
const sosSessions = new Map();
 
function isValidToken(token) {
    return /^[a-f0-9]{32}$/.test(String(token || ""));
}
 
function parseCoords(body) {
 
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
 
    const valid =
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180;
 
    return { lat, lng, valid };
}
 
// Purane sessions saaf karo (har 10 minute mein)
setInterval(() => {
 
    const limit = (TRACKING_MAX_HOURS + 1) * 3600 * 1000;
 
    for (const [token, s] of sosSessions) {
        if (Date.now() - s.createdAt > limit) {
            sosSessions.delete(token);
        }
    }
 
}, 10 * 60 * 1000).unref();
 
if (!PUBLIC_BASE_URL) {
    console.warn(
        "⚠️ PUBLIC_BASE_URL .env mein set nahi hai: live tracking band hai, " +
        "contacts ko Google Maps ka fixed link jayega."
    );
}
 
// =====================================================
// SOS API (dono contacts ko WhatsApp)
// =====================================================
 
app.post("/api/sos", async (req, res) => {
 
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }
 
    // ---------------------------------------------
    // VALIDATE GPS
    // ---------------------------------------------
 
    const { lat, lng, valid } = parseCoords(req.body);
 
    if (!valid) {
        return res.status(400).json({
            success: false,
            message: "Invalid GPS coordinates."
        });
    }
 
    try {
 
        const user = await users().findOne({ userId: req.session.userId });
 
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }
 
        const contacts = getContacts(user);
 
        if (contacts.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Emergency contact numbers are missing or invalid."
            });
        }
 
        // Apna phone/naam ab zaroori nahi: na ho to userId aur "Not available"
        const userNumber = normalizeIndianNumber(user.phone);
        const userPhone = userNumber.length >= 11 ? "+" + userNumber : "Not available";
        const userName = user.name || user.userId;
        const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
 
        // -----------------------------------------
        // Live tracking session (agar PUBLIC_BASE_URL set hai)
        // -----------------------------------------
 
        let token = null;
        let trackingEnabled = false;
        let contactLink = mapLink;
 
        if (PUBLIC_BASE_URL) {
 
            token = crypto.randomBytes(16).toString("hex");
 
            sosSessions.set(token, {
                userId: req.session.userId,
                name: userName,
                phone: userNumber.length >= 11 ? userPhone : null,
                latitude: lat,
                longitude: lng,
                active: true,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
 
            contactLink = `${PUBLIC_BASE_URL}/track/${token}`;
            trackingEnabled = true;
        }
 
        console.log("\n========================================");
        console.log("🚨 SOS TRIGGERED");
        console.log("User:", userName);
        console.log("User phone:", userPhone);
        console.log("Contacts:", contacts.map(c => c.phone).join(", "));
        console.log("Link sent to contacts:", contactLink);
        console.log("Live tracking:", trackingEnabled);
        console.log("========================================\n");
 
        // -----------------------------------------
        // Dono contacts ko ek saath bhejo.
        // Ek fail ho to dusre ko phir bhi jayega.
        // -----------------------------------------
 
        const results = await Promise.all(
            contacts.map(async (contact) => {
 
                const result = {
                    name: contact.name,
                    phone: contact.phone,
                    messageSent: false,
                    locationPinSent: false,
                    error: null
                };
 
                try {
 
                    await sendWhatsAppMessage(
                        contact.phone,
                        SOS_TEMPLATE_NAME,
                        SOS_TEMPLATE_LANGUAGE,
                        [userName, userPhone, contactLink]
                    );
 
                    result.messageSent = true;
 
                }
                catch (error) {
 
                    console.error(`❌ WhatsApp SOS Error (${contact.phone}):`, error.message);
                    result.error = error.message;
                    return result;
                }
 
                // Location pin bonus hai, fail ho to SOS phir bhi success
                try {
 
                    await sendWhatsAppLocation(contact.phone, lat, lng);
                    result.locationPinSent = true;
 
                }
                catch (error) {
 
                    console.warn(
                        `Location pin not sent (${contact.phone}):`,
                        error.message
                    );
                }
 
                return result;
            })
        );
 
        const delivered = results.filter(r => r.messageSent);
 
        if (delivered.length === 0) {
 
            // Kisi ko nahi gaya, to tracking session bekaar hai
            if (token) sosSessions.delete(token);
 
            return res.status(500).json({
                success: false,
                message: "WhatsApp alert failed: " + (results[0].error || "unknown error"),
                mapLink: mapLink,
                contacts: results
            });
        }
 
        return res.json({
            success: true,
            message: `SOS sent to ${delivered.length} of ${results.length} contacts.`,
            guardianPhone: contacts[0].phone,
            latitude: lat,
            longitude: lng,
            mapLink: mapLink,
            trackingEnabled: trackingEnabled,
            token: token,
            trackLink: contactLink,
            locationPinSent: results.some(r => r.locationPinSent),
            contacts: results
        });
 
    }
    catch (error) {
 
        console.error("❌ SOS Error:", error);
 
        return res.status(500).json({
            success: false,
            message: "Database error."
        });
    }
});
 
// =====================================================
// SOS LIVE LOCATION UPDATE (user ka phone har 5 second mein bhejta hai)
// =====================================================
 
app.post("/api/sos/update", (req, res) => {
 
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: "Please login first." });
    }
 
    const { lat, lng, valid } = parseCoords(req.body);
    const token = String(req.body.token || "");
 
    if (!isValidToken(token) || !valid) {
        return res.status(400).json({ success: false, message: "Invalid request." });
    }
 
    const session = sosSessions.get(token);
 
    if (!session || session.userId !== req.session.userId || !session.active) {
        return res.json({ success: false });
    }
 
    session.latitude = lat;
    session.longitude = lng;
    session.updatedAt = Date.now();
 
    return res.json({ success: true });
});
 
// =====================================================
// SOS STOP (user ne SOS cancel kiya)
// =====================================================
 
app.post("/api/sos/stop", (req, res) => {
 
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: "Please login first." });
    }
 
    const token = String(req.body.token || "");
 
    if (!isValidToken(token)) {
        return res.status(400).json({ success: false, message: "Invalid request." });
    }
 
    const session = sosSessions.get(token);
 
    if (session && session.userId === req.session.userId) {
        session.active = false;
    }
 
    return res.json({ success: true });
});
 
// =====================================================
// PUBLIC TRACKING PAGE (contacts ke liye, login nahi chahiye)
// Token 32 random hex characters ka hai, andaza nahi lag sakta
// =====================================================
 
app.get("/track/:token", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "track.html"));
});
 
app.get("/api/track/:token", (req, res) => {
 
    res.set("Cache-Control", "no-store");
 
    const token = String(req.params.token || "");
    const session = isValidToken(token) ? sosSessions.get(token) : null;
 
    if (!session) {
        return res.status(404).json({
            success: false,
            message: "Tracking link not found or expired."
        });
    }
 
    const expired =
        Date.now() - session.createdAt > TRACKING_MAX_HOURS * 3600 * 1000;
 
    return res.json({
        success: true,
        name: session.name,
        phone: session.phone,
        latitude: session.latitude,
        longitude: session.longitude,
        active: session.active && !expired,
        secondsSinceUpdate: Math.floor((Date.now() - session.updatedAt) / 1000)
    });
});
 
// =====================================================
// PYTHON VOICE SCRIPTS (laptop ka mic/speaker use karte hain)
// navigation.py aur calling.py dono ek hi mic use karte hain,
// isliye ek time par sirf ek script chalegi
// =====================================================
 
let pyProcess = null;
let pyProcessName = "";
 
function runPythonScript(scriptName, label, res, startedMessage, extraEnv = {}) {
 
    if (pyProcess) {
        return res.send(
            `Voice ${pyProcessName} is already running. Please speak now.`
        );
    }
 
    const pythonDir = path.join(__dirname, "python");
    const pythonScriptPath = path.join(pythonDir, scriptName);
 
    pyProcessName = label;
 
    pyProcess = spawn(
        "py",
        ["-3.13", "-X", "utf8", pythonScriptPath],
        {
            cwd: pythonDir,
            env: { ...process.env, PYTHONIOENCODING: "utf-8", ...extraEnv }
        }
    );
 
    pyProcess.stdout.on("data", (data) => console.log(`Python Output: ${data}`));
    pyProcess.stderr.on("data", (data) => console.error(`Python Error: ${data}`));
 
    pyProcess.on("error", (err) => {
        console.error(`Could not start ${scriptName}:`, err.message);
        pyProcess = null;
    });
 
    pyProcess.on("close", (code) => {
        console.log(`${scriptName} exited with code ${code}`);
        pyProcess = null;
    });
 
    return res.send(startedMessage);
}
 
// Phone se aayi request par laptop ka mic/speaker nahi chalna chahiye
function isPhoneRequest(req) {
    return /Android|iPhone|iPad|iPod/i.test(req.headers["user-agent"] || "");
}
 
app.get("/location", (req, res) => {
 
    if (isPhoneRequest(req)) {
        return res.send(
            "This opens the laptop's voice navigation and cannot run from a phone. " +
            "Please refresh the assistant page and try again."
        );
    }
 
    return runPythonScript(
        "navigation.py",
        "navigation",
        res,
        "Voice navigation started. Please speak your destination."
    );
});
 
app.get("/call", async (req, res) => {
 
    // Call route par login zaroori, taaki koi bhi URL kholke call na laga sake
    if (!req.session.userId) {
        return res.status(401).send("Please login first.");
    }
 
    if (isPhoneRequest(req)) {
        return res.send(
            "This opens the laptop's voice calling and cannot run from a phone. " +
            "Please refresh the assistant page and try again."
        );
    }
 
    try {
 
        const user = await users().findOne({ userId: req.session.userId });
 
        if (!user) {
            return res.status(404).send("User not found.");
        }
 
        // Is user ke 2 contacts calling.py ko do
        const contacts = getContacts(user);
 
        // Voice command se naam aaya ho to (/call?to=mom)
        const callTarget = String(req.query.to || "").trim().slice(0, 50);
 
        return runPythonScript(
            "calling.py",
            "calling",
            res,
            "Voice calling started.",
            {
                CONTACTS_JSON: JSON.stringify(contacts),
                CALL_TARGET: callTarget
            }
        );
 
    }
    catch (error) {
 
        console.error("❌ /call DB error:", error);
        return res.status(500).send("Database error.");
    }
});
 
// =====================================================
// START: pehle MongoDB, phir server
// - mkcert files mile (laptop): HTTPS server
// - na mile (deploy): normal HTTP server, host HTTPS lagata hai
// =====================================================
 
connectDB()
    .then(() => {
 
        if (sslOptions) {
 
            https.createServer(sslOptions, app).listen(
                PORT,
                "0.0.0.0",
                () => {
                    console.log(`🚀 HTTPS Server running at https://172.22.55.165:${PORT}`);
                }
            );
 
        } else {
 
            app.listen(
                PORT,
                "0.0.0.0",
                () => {
                    console.log(`🚀 Server running on port ${PORT}`);
                }
            );
        }
    })
    .catch((error) => {
        console.error("❌ MongoDB connection failed:", error.message);
        process.exit(1);
    });
 