GreenEdge

Voice-guided navigation, document reader aur emergency SOS app.

Backend: Node.js (Express) + MongoDB
Voice assistant: Flask (python/voice_assistance.py), Node ke andar chalta hai
Object detection: alag service (YOLOv8s), alag host par
Project structure
server.js
database/db.js
python/voice_assistance.py
public/        (css, js, track.html)
views/         (EJS pages)
Dockerfile
.dockerignore
Laptop par chalana
npm install
.env file banao (neeche variables dekho)
Voice service: py -3.13 python/voice_assistance.py (port 5001)
Server: node server.js

mkcert certificate mile to HTTPS chalta hai, warna normal HTTP.

Environment variables
Naam	Kaam
MONGODB_URI	MongoDB Atlas ka connection string
MONGODB_DB	Database ka naam (default greenedge)
SESSION_SECRET	Lambi random string
WHATSAPP_PHONE_NUMBER_ID	WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN	WhatsApp Cloud API (permanent token)
PUBLIC_BASE_URL	Deploy ke baad ka URL, jaise https://greenedge.onrender.com (aakhir mein / nahi). Iske bina live tracking link nahi banta

.env ko GitHub par kabhi mat daalo. Host ke dashboard mein variables daalo.

Deploy (Render, Docker)
Code GitHub par daalo (.env nahi).
Render par New Web Service banao, repo chuno, Runtime: Docker.
Environment variables daalo.
Deploy karo. Pehli baar kuch minute lagte hain.

Deploy se pehle in baaton ka dhyan rakho:

python/voice_assistance.py ke last mein app.run(host="0.0.0.0", port=5001, debug=False) hona chahiye.
Deploy wali copy mein is_mobile = True wali line jodo (is_mobile = bool(...) ke turant baad), kyunki server par laptop ka mic nahi hota. Laptop wali copy mein ye line mat rakhna.
package-lock.json project mein hona chahiye (npm ci ke liye).
/location aur /call ke laptop-mic wale scripts server par nahi chalenge. is_mobile = True ke baad assistant unhe use nahi karta.
Dhyan rakhne wali baatein
Render free service 15 minute bina traffic ke so jati hai, jagne mein lagbhag ek minute lagta hai. Demo se pehle site khol lo.
Login sessions aur live tracking sessions server ki memory mein hain, restart par reset hote hain. Signed cookie se user phir bhi pehchana jata hai.
Camera, mic aur GPS ke liye HTTPS chahiye. Render ye khud deta hai.
Object detection ka URL (/api/process_frame) Snavigation ke JS mein detection service ke URL par set karna hai.