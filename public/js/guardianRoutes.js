// guardianRoutes.js
// Isse apne Node/Express project mein rakho (jaise routes/ folder mein) aur server.js mein:
//     const guardianRoutes = require("./routes/guardianRoutes");
//     app.use(guardianRoutes);
//
// Jahan "CHANGE" likha hai wahan apne project ke hisaab se badlo.
 
const path = require("path");
const express = require("express");
const { users } = require("../../database/db"); // CHANGE: tumhari db.js ka sahi path
 
const router = express.Router();
 
// Page: "change number" bolne par yahi khulta hai
router.get("/guardianRoutes", (req, res) => {
    res.render("change_contact");
});
 
// API: voice_assistance.js yahan naam aur number bhejta hai
router.post("/api/update-guardian", express.json(), async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const phone = String(req.body.phone || "").replace(/\D/g, "");
 
        if (!name) {
            return res.json({ success: false, message: "Contact name is missing." });
        }
        if (phone.length !== 10) {
            return res.json({ success: false, message: "The number must be ten digits." });
        }
 
        // CHANGE: logged-in user ki id, jaise tumhare baaki routes mein milti hai
        const userId = req.session && req.session.userId;
        if (!userId) {
            return res.json({ success: false, message: "Please log in first." });
        }
 
        // CHANGE: field names wahi rakho jo /api/emergency-contact padhta hai
        const result = await users().updateOne(
            { userId: userId },
            { $set: { guardianName: name, guardianPhone: phone } }
        );
 
        if (result.matchedCount === 0) {
            return res.json({ success: false, message: "User not found." });
        }
 
        res.json({ success: true });
    } catch (err) {
        console.error("update-guardian error:", err);
        res.json({ success: false, message: "Could not save the guardian number." });
    }
});
 
module.exports = router;